// Runs of the sensorgrams (the Sensorgram page; the Compare page for other configurations): the kinetics and the optical
// plan on the page, the reflectance of the (series, time) pairs split between the workers of a pool in chunks
// (progress, Stop), then the read-out. One run per key (a configuration id, or 'cmp:' + id for Compare); its state
// outlives the page.
import { useSyncExternalStore } from 'react';
import type { MaterialDef, Models } from '../physics/materials.ts';
import type { Library } from '../physics/library.ts';
import type { Interrogation } from '../model/analysis.ts';
import { withoutRough, type Structure } from '../model/structure.ts';
import { kineticsOf, sgFinish, sgPlan, type SgCal, type SgChunk, type SgKinetics, type SgResult, type SgSettings } from '../model/sensorgram.ts';
import { persistentPool } from './client.ts';

export type SgRun = {
  status: 'running' | 'done' | 'stopped' | 'error';
  done: number; // pairs computed
  total: number;
  started: number;
  elapsed: number;
  key: string; // what it was run on (a change: the results are out of date)
  kin: SgKinetics;
  settings: SgSettings;
  warnings: string[];
  layer?: string;
  result?: SgResult;
  message?: string;
};

const runs = new Map<string, SgRun>();
let snapshot: Record<string, SgRun> = {};
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = Object.fromEntries(runs);
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useSgRuns = () => useSyncExternalStore(subscribe, () => snapshot);

const shared = persistentPool();
// the pool's workers started (the page calls it when it opens, so that the first Run does not wait for them)
export const warmSg = () => shared.warm();
// the run of each key: a token (a newer run or a Stop makes the results of the older one ignored)
const tokens = new Map<string, number>();
let tokenCount = 0;
const set = (id: string, patch: Partial<SgRun>) => {
  const r = runs.get(id);
  if (r) runs.set(id, { ...r, ...patch, elapsed: Date.now() - r.started });
  emit();
};

// What a run depends on: the structure, the scan, the settings that change the computation, the materials.
export function sgKey(structure: Structure, it: Interrogation, sg: SgSettings, materials: MaterialDef[]) {
  const { show: _a, kinShow: _b, mapSeries: _c, mapSeed: _d, times: _e, cards: _f, showMap: _g, plan: _h, ...calc } = sg;
  void [_a, _b, _c, _d, _e, _f, _g, _h];
  return JSON.stringify({ structure, it: it.mode === 'map' ? 'map' : { mode: it.mode, lambda: it.lambda, theta: it.theta, from: it.from, to: it.to, points: it.points, pol: it.pol }, calc, materials });
}

export function startSg(id: string, materials: MaterialDef[], structure: Structure, it: Interrogation, sg: SgSettings, lib: Library, models: Models, key: string) {
  tokens.delete(id); // (a run of this key still going: its results ignored; the pool keeps working)
  const kin = kineticsOf(sg);
  const pr = sgPlan(structure, it, sg, kin, lib, models);
  const base: SgRun = { status: 'running', done: 0, total: 0, started: Date.now(), elapsed: 0, key, kin, settings: sg, warnings: [...kin.warnings, ...pr.warnings], layer: pr.layer };
  if (!pr.plan) {
    runs.set(id, { ...base, status: 'error', message: pr.errors.join(' ') });
    emit();
    return;
  }
  const plan = pr.plan;
  const smooth = withoutRough(structure); // (the sensorgram ignores the roughness)
  const nPairs = plan.nK * plan.nT;
  const nX = plan.win.W;
  const pool = shared.get();
  const token = ++tokenCount;
  tokens.set(id, token);
  const live = () => tokens.get(id) === token;
  runs.set(id, { ...base, total: nPairs });
  emit();
  const exact = new Float64Array(nPairs * nX);
  const ex = { i0: new Int32Array(nPairs), edge: new Uint8Array(nPairs), pos: new Float64Array(nPairs).fill(NaN), rmin: new Float64Array(nPairs).fill(NaN), val: new Float64Array(nPairs).fill(NaN), nL: new Float64Array(nPairs) };
  // chunks: a few per worker (progress), each at most ~200 000 points
  const chunk = Math.max(1, Math.min(Math.ceil(nPairs / (pool.size * 4)), Math.floor(200_000 / nX) || 1));
  let done = 0;
  const jobs: Promise<unknown>[] = [];
  for (let from = 0; from < nPairs; from += chunk) {
    const pairs = Array.from({ length: Math.min(chunk, nPairs - from) }, (_, i) => from + i);
    jobs.push(
      pool.run<SgChunk>({ type: 'sensorgram', materials, structure: smooth, plan, pairs }).then((r) => {
        if (!live()) return;
        r.pairs.forEach((q, i) => {
          exact.set(r.R.subarray(i * nX, (i + 1) * nX), q * nX);
          ex.i0[q] = r.i0[i];
          ex.edge[q] = r.edge[i];
          ex.pos[q] = r.pos[i];
          ex.rmin[q] = r.rmin[i];
          ex.val[q] = r.val[i];
          ex.nL[q] = r.nL[i];
        });
        done += pairs.length;
        set(id, { done });
      }),
    );
  }
  const calJob = pool.run<SgCal | null>({ type: 'sgcal', materials, structure: smooth, plan });
  Promise.all([calJob, ...jobs])
    .then(([cal]) => {
      if (!live()) return;
      tokens.delete(id);
      const warnings = [...base.warnings];
      const result = sgFinish(sg, kin, plan, pr.tIdx, exact, ex, cal as SgCal | null, warnings);
      set(id, { status: 'done', result, warnings });
    })
    .catch((e: Error) => {
      if (!live()) return;
      tokens.delete(id);
      // (a worker failed: a fresh pool for the next run)
      if (!tokens.size) shared.reset();
      set(id, { status: 'error', message: e.message });
    });
}

export function stopSg(id: string) {
  if (!tokens.has(id)) return;
  tokens.delete(id);
  // nothing else running: the work still queued dropped with the pool (a new one for the next run)
  if (!tokens.size) shared.reset();
  set(id, { status: 'stopped' });
}

export function clearSg(id: string) {
  tokens.delete(id); // (a run of this key still going: its results ignored; the pool keeps working)
  runs.delete(id);
  emit();
}
