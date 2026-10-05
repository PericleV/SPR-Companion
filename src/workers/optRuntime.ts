// Runs of the Optimization page. The algorithm (spr-forge's optimize.ts, cheap) runs here between batches; every batch
// of candidates is split between the workers of a pool. One run at a time; its state outlives the page (a run goes
// on while another page is shown). Also the layer-sequence GA in its own worker.
import { useSyncExternalStore } from 'react';
import type { MaterialDef } from '../physics/materials.ts';
import { adam, differentialEvolution, genetic, levenbergMarquardtBatch, mergeParams, nelderMead, nsga2, particleSwarm, simulatedAnnealing, Tracker, type Control, type FrontPoint, type Progress } from '../engine/optimize.ts';
import { boxOf, isConstraint, type EvalJob, type Evaluation, type Objective, type OptSettings, type OptVar } from '../model/optimization.ts';
import type { SprProblem, SprProgress, SprSettings } from '../engine/sprDesign.ts';
import { Pool, persistentPool } from './client.ts';
import type { SprMsg, SprOut } from './spr.worker.ts';

export type RunStatus = 'running' | 'paused' | 'done' | 'stopped' | 'error';
export type OptRunState = {
  status: RunStatus;
  phase: string;
  iteration: number;
  evaluations: number;
  best: number;
  bestX: number[];
  bestParts: number[];
  bestValues: number[];
  history: number[];
  front?: (FrontPoint & { values?: number[] })[];
  vars: OptVar[];
  objectives: Objective[]; // as used (automatic scales resolved)
  start: Evaluation | null;
  started: number;
  elapsed: number;
  message?: string;
  config?: string; // the configuration it was started in (its structure)
  algorithm?: string; // (its id, for the record of an applied result)
};

let opt: OptRunState | null = null;
let spr: SprRunState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useOptRun = () => useSyncExternalStore(subscribe, () => opt);
export const useSprRun = () => useSyncExternalStore(subscribe, () => spr);

const set = (patch: Partial<OptRunState>) => {
  if (opt) opt = { ...opt, ...patch };
  emit();
};

type Ctl = { stop: boolean; paused: boolean; resume?: () => void; pool: Pool };
let ctl: Ctl | null = null;
const optPool = persistentPool();
export const warmOpt = () => optPool.warm();

// A batch evaluated by the pool: split evenly between the workers.
async function evaluateBatch(pool: Pool, materials: MaterialDef[], job: EvalJob, xs: number[][]): Promise<Evaluation[]> {
  const n = pool.size;
  const chunk = Math.ceil(xs.length / n);
  const parts = await Promise.all(
    Array.from({ length: n }, (_, i) => xs.slice(i * chunk, (i + 1) * chunk)).filter((p) => p.length).map((p) => pool.run<Evaluation[]>({ type: 'evaluate', materials, job, xs: p })),
  );
  return parts.flat();
}

export function startOpt(materials: MaterialDef[], job: EvalJob, s: OptSettings, config?: string) {
  if (ctl) return;
  const pool = optPool.get();
  const c: Ctl = { stop: false, paused: false, pool };
  ctl = c;
  const started = Date.now();
  const box = boxOf(job.vars);
  const x0 = job.vars.map((v) => v.start);
  opt = { status: 'running', phase: 'starting', iteration: 0, evaluations: 0, best: Infinity, bestX: x0, bestParts: [], bestValues: [], history: [], vars: job.vars, objectives: job.objectives.filter((o) => o.on), start: null, started, elapsed: 0, config, algorithm: s.algorithm };
  emit();

  (async () => {
    try {
      // the start, and the automatic scales (scale ≤ 0: the start value, so every objective counts about 1)
      const probe = (await evaluateBatch(pool, materials, job, [x0]))[0];
      const on = job.objectives.filter((o) => o.on);
      // (a constraint: its limit's size)
      const objectives = on.map((o, i) => (o.scale > 0 ? o : { ...o, scale: (isConstraint(o) ? Math.abs(o.target) : Math.abs(probe.values[i])) || 1 }));
      const constrained = objectives.some(isConstraint);
      const runJob: EvalJob = { ...job, objectives };
      const start = (await evaluateBatch(pool, materials, runJob, [x0]))[0];
      set({ objectives, start });
      let lastValues: Map<string, number[]> = new Map();
      const tracker = new Tracker(async (xs, residuals) => {
        const ev = await evaluateBatch(pool, materials, runJob, xs);
        // the quantities of the points (the best's are shown)
        lastValues = new Map(xs.map((x, i) => [x.join(','), ev[i].values]));
        return { merits: ev.map((e) => e.merit), parts: ev.map((e) => e.parts), residuals: residuals ? ev.map((e) => e.residuals) : undefined, ...(constrained ? { violations: ev.map((e) => e.violation) } : {}) };
      }, box);
      let last = 0;
      const control: Control = {
        stopped: () => c.stop,
        waitIfPaused: () => (c.paused ? new Promise<void>((resolve) => (c.resume = resolve)) : Promise.resolve()),
        report: (p: Progress) => {
          const now = Date.now();
          const values = lastValues.get(p.bestX.join(','));
          if (now - last < 120 && p.iteration > 1) {
            if (values && opt) opt.bestValues = values;
            return;
          }
          last = now;
          set({ phase: p.phase, iteration: p.iteration, evaluations: p.evaluations, best: p.best, bestX: p.bestX, bestParts: p.bestParts, history: p.history.slice(), ...(values ? { bestValues: values } : {}), ...(p.front ? { front: p.front } : {}), elapsed: (now - started) / 1000 });
        },
      };
      const P = mergeParams(s.params);
      const pop = { iterations: s.iterations, population: s.population, seed: s.seed };
      let front: FrontPoint[] | undefined;
      switch (s.algorithm) {
        case 'adam': {
          // two stages: the objectives ticked for stage 1 first (their own lr), then those of stage 2 (none: all)
          const { stage1Iter, stage1Lr, stage1Obj, stage2Obj, ...rest } = P.adam;
          const goals = objectives.filter((o) => !isConstraint(o));
          const mask1 = goals.map((o) => stage1Obj.includes(o.id));
          const mask2 = goals.map((o) => stage2Obj.includes(o.id));
          await adam(
            tracker,
            box,
            x0,
            { iterations: s.iterations, seed: s.seed, ...rest, ...(mask1.some(Boolean) ? { stage1: { iterations: stage1Iter, lr: stage1Lr, mask: mask1 } } : {}), ...(mask2.some(Boolean) ? { stage2Mask: mask2 } : {}) },
            control,
          );
          break;
        }
        case 'de':
          await differentialEvolution(tracker, box, x0, { ...pop, ...P.de }, control);
          break;
        case 'ga':
          await genetic(tracker, box, x0, { ...pop, ...P.ga }, control);
          break;
        case 'pso':
          await particleSwarm(tracker, box, x0, { ...pop, ...P.pso }, control);
          break;
        case 'nsga2':
          front = await nsga2(tracker, box, x0, { ...pop, ...P.nsga2 }, control);
          break;
        case 'lm':
          await levenbergMarquardtBatch(tracker, box, x0, { iterations: s.iterations, ...P.lm }, control);
          break;
        case 'sa':
          await simulatedAnnealing(tracker, box, x0, { iterations: s.iterations, seed: s.seed, ...P.sa }, control);
          break;
        default:
          await nelderMead(tracker, box, x0, { iterations: s.iterations, ...P.nm }, control);
      }
      if (s.polish && !['nm', 'lm', 'nsga2'].includes(s.algorithm) && !c.stop && tracker.bestX.length)
        await nelderMead(tracker, box, tracker.bestX, { iterations: Math.max(50, 20 * box.lo.length), step: 0.02 }, control, 'Polish (Nelder-Mead)');
      // the best (and the front) evaluated once more for their quantities
      const best = tracker.bestX.length ? (await evaluateBatch(pool, materials, runJob, [tracker.bestX]))[0] : null;
      const fr = front?.length ? await evaluateBatch(pool, materials, runJob, front.map((p) => p.x)) : null;
      finish(c.stop ? 'stopped' : 'done', undefined, {
        best: tracker.best,
        bestX: tracker.bestX,
        bestParts: tracker.bestParts,
        bestValues: best?.values ?? [],
        history: tracker.history.slice(),
        evaluations: tracker.evaluations,
        ...(front ? { front: front.map((p, i) => ({ ...p, values: fr?.[i].values })) } : {}),
      });
    } catch (err) {
      finish('error', err instanceof Error ? err.message : String(err));
    }
  })();

  function finish(status: RunStatus, message?: string, patch: Partial<OptRunState> = {}) {
    // (the pool is kept for the next run; after an error a fresh one)
    if (status === 'error') optPool.reset();
    ctl = null;
    set({ ...patch, status, message, elapsed: (Date.now() - started) / 1000 });
  }
}

export function pauseOpt() {
  if (!ctl) return;
  ctl.paused = true;
  set({ status: 'paused' });
}
export function resumeOpt() {
  if (!ctl) return;
  ctl.paused = false;
  ctl.resume?.();
  ctl.resume = undefined;
  set({ status: 'running' });
}
export function stopOpt() {
  if (!ctl) return;
  ctl.stop = true;
  if (ctl.paused) resumeOpt();
}
export const clearOpt = () => {
  if (ctl) return;
  opt = null;
  emit();
};

// ---- the layer-sequence GA ----

export type SprRunState = { status: RunStatus; progress: SprProgress | null; problem: SprProblem; medium: string; started: number; elapsed: number; message?: string };
let sprWorker: Worker | null = null;
let sprStopping = false;

export function startSpr(problem: SprProblem, settings: SprSettings, medium: string) {
  if (sprWorker) return;
  const w = new Worker(new URL('./spr.worker.ts', import.meta.url), { type: 'module' });
  sprWorker = w;
  sprStopping = false;
  const started = Date.now();
  spr = { status: 'running', progress: null, problem, medium, started, elapsed: 0 };
  emit();
  const end = (patch: Partial<SprRunState>) => {
    w.terminate();
    sprWorker = null;
    spr = spr && { ...spr, ...patch, elapsed: (Date.now() - started) / 1000 };
    emit();
  };
  w.onerror = (e) => {
    e.preventDefault();
    end({ status: 'error', message: e.message || 'The worker stopped unexpectedly.' });
  };
  w.onmessage = (e: MessageEvent<SprOut>) => {
    const m = e.data;
    if (m.type === 'progress') {
      spr = spr && { ...spr, progress: m.progress, elapsed: (Date.now() - started) / 1000 };
      emit();
      return;
    }
    if (m.error) end({ status: 'error', message: m.error });
    else end({ status: sprStopping ? 'stopped' : 'done', progress: m.progress ?? spr?.progress ?? null });
  };
  w.postMessage({ type: 'start', problem, settings } satisfies SprMsg);
}

export function stopSpr() {
  if (!sprWorker) return;
  sprStopping = true;
  sprWorker.postMessage({ type: 'stop' } satisfies SprMsg);
}
export const sprRunning = () => !!sprWorker;
