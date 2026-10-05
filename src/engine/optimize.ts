// Optimization algorithms. They minimize a merit over a box, evaluating candidates in batches (so a
// worker pool can score them in parallel) and checking a controller between iterations (pause/stop).

import { solve } from './lm.ts';

export type Box = { lo: number[]; hi: number[]; integer: boolean[] };
// Scores of a batch: total merit, the cost of each objective, (on request) residual vectors, and how far each point
// breaks the constraints (0: feasible; absent: no constraints).
export type EvalResult = { merits: number[]; parts: number[][]; residuals?: number[][]; violations?: number[] };
export type Evaluate = (xs: number[][], residuals?: boolean) => Promise<EvalResult>;
export type FrontPoint = { x: number[]; f: number[]; v?: number }; // v: the constraint violation (0: feasible)
export type Progress = {
  iteration: number;
  evaluations: number;
  best: number;
  bestX: number[];
  bestParts: number[];
  history: number[];
  phase: string;
  front?: FrontPoint[];
};
export type Control = { stopped: () => boolean; waitIfPaused: () => Promise<void>; report: (p: Progress) => void };

// Evaluator for a plain function of x (one objective).
export const fromScalar =
  (f: (x: number[]) => number): Evaluate =>
  async (xs) => {
    const merits = xs.map(f);
    return { merits, parts: merits.map((m) => [m]) };
  };

// Seeded uniform random numbers in [0, 1) (mulberry32).
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Keeps x inside the box; integer variables are rounded.
export const project = (x: number[], b: Box) =>
  x.map((v, i) => {
    const c = Math.min(b.hi[i], Math.max(b.lo[i], v));
    return b.integer[i] ? Math.round(c) : c;
  });

// Tracks the best point seen and the evaluation count; wraps the batch evaluator.
export class Tracker {
  best = Infinity;
  bestX: number[] = [];
  bestParts: number[] = [];
  evaluations = 0;
  history: number[] = [];
  private evaluate: Evaluate;
  private box: Box;
  constructor(evaluate: Evaluate, box: Box) {
    this.evaluate = evaluate;
    this.box = box;
  }
  async full(xs: number[][], residuals = false): Promise<EvalResult & { points: number[][] }> {
    const points = xs.map((x) => project(x, this.box));
    const r = await this.evaluate(points, residuals);
    this.evaluations += points.length;
    r.merits.forEach((v, i) => {
      if (v < this.best) {
        this.best = v;
        this.bestX = points[i];
        this.bestParts = r.parts[i];
      }
    });
    return { ...r, points };
  }
  async eval(xs: number[][]): Promise<number[]> {
    return (await this.full(xs)).merits;
  }
  progress(iteration: number, phase: string, front?: FrontPoint[]): Progress {
    this.history.push(this.best);
    return { iteration, evaluations: this.evaluations, best: this.best, bestX: this.bestX, bestParts: this.bestParts, history: this.history, phase, front };
  }
}

// ---- Algorithm settings (defaults = the classic choices; every value can be changed in the Optimizer node) ----

export type DeStrategy = 'rand/1/bin' | 'best/1/bin' | 'current-to-best/1/bin' | 'rand/2/bin' | 'rand/1/exp';
export type CrossoverType = 'sbx' | 'blx' | 'uniform' | 'arithmetic';
export type Crossover = { type: CrossoverType; prob: number; eta: number; alpha: number };
export type MutationType = 'polynomial' | 'gaussian' | 'uniform';
export type Mutation = { type: MutationType; prob: number; eta: number; sigma: number }; // prob ≤ 0 or NaN = 1/(number of variables)

export type AlgoParams = {
  adam: { lr: number; starts: number; beta1: number; beta2: number; h: number; stall: number; decay: number; decaySteps: number; stage1Iter: number; stage1Lr: number; stage1Obj: string[]; stage2Obj: string[] };
  de: { strategy: DeStrategy; F: number; Fmax: number; CR: number };
  nm: { step: number; tol: number };
  ga: { tournament: number; elites: number; crossover: Crossover; mutation: Mutation };
  pso: { w: number; wEnd: number; c1: number; c2: number; vmax: number; topology: 'global' | 'ring'; neighbours: number };
  nsga2: { crossover: Crossover; mutation: Mutation };
  lm: { lambda0: number; h: number };
  sa: { t0: number; cooling: number; perTemp: number; step: number; chains: number };
};
export type AlgoParamsPatch = { [K in keyof AlgoParams]?: Partial<AlgoParams[K]> };

export const CROSSOVER_DEFAULT: Crossover = { type: 'sbx', prob: 1, eta: 15, alpha: 0.5 };
export const MUTATION_DEFAULT: Mutation = { type: 'polynomial', prob: NaN, eta: 20, sigma: 0.1 };
export const DEFAULT_PARAMS: AlgoParams = {
  // the settings of the reference code of M. He et al., Nat. Mater. 20, 1663 (2021): lr 0.05 × 0.7 every 100 steps, a first
  // stage of 200 steps at lr 0.01 on the objectives ticked for it (none ticked: one stage), 4 starts, no early stop
  adam: { lr: 0.05, starts: 4, beta1: 0.9, beta2: 0.999, h: 1e-4, stall: 0, decay: 0.7, decaySteps: 100, stage1Iter: 200, stage1Lr: 0.01, stage1Obj: [], stage2Obj: [] },
  de: { strategy: 'rand/1/bin', F: 0.5, Fmax: 1, CR: 0.9 },
  nm: { step: 0.1, tol: 1e-7 },
  ga: { tournament: 2, elites: 2, crossover: CROSSOVER_DEFAULT, mutation: MUTATION_DEFAULT },
  pso: { w: 0.72, wEnd: 0.72, c1: 1.49, c2: 1.49, vmax: 0.2, topology: 'global', neighbours: 1 },
  nsga2: { crossover: CROSSOVER_DEFAULT, mutation: MUTATION_DEFAULT },
  lm: { lambda0: 1e-3, h: 1e-5 },
  sa: { t0: 0, cooling: 0.95, perTemp: 50, step: 0.1, chains: 4 },
};

// Stored settings over the defaults (missing values keep the default).
export function mergeParams(p?: AlgoParamsPatch): AlgoParams {
  const out = structuredClone(DEFAULT_PARAMS);
  for (const k of Object.keys(out) as (keyof AlgoParams)[]) {
    const patch = p?.[k] as Record<string, unknown> | undefined;
    if (!patch) continue;
    const target = out[k] as Record<string, unknown>;
    for (const [key, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      target[key] = Array.isArray(v) ? [...v] : typeof v === 'object' ? { ...(target[key] as object), ...(v as object) } : v;
    }
  }
  return out;
}

const sigmoid = (u: number) => 1 / (1 + Math.exp(-u));
const logit = (t: number) => {
  const c = Math.min(1 - 1e-4, Math.max(1e-4, t));
  return Math.log(c / (1 - c));
};

export type AdamOptions = {
  iterations: number;
  lr: number;
  starts: number;
  seed: number;
  beta1?: number;
  beta2?: number;
  h?: number;
  stall?: number;
  // learning-rate schedule: lr·decay^⌊step / decaySteps⌋ (staircase exponential decay; decay 1 = constant)
  decay?: number;
  decaySteps?: number;
  // two stages (M. He et al., Nat. Mater. 20, 1663 (2021)): the first `stage1.iterations` minimize only the objectives in
  // stage1.mask with their own learning rate; then a fresh Adam minimizes the objectives in stage2Mask (all when absent)
  stage1?: { iterations: number; lr: number; mask: boolean[] };
  stage2Mask?: boolean[];
};

// Adam on u, with x = lo + (hi − lo)·σ(u) so the box is respected smoothly; forward-difference gradients.
// Several starts run side by side (the first from x0, the others random); integer variables stay fixed.
export async function adam(t: Tracker, box: Box, x0: number[], o: AdamOptions, ctl: Control) {
  const d = x0.length;
  const rand = rng(o.seed);
  const span = box.lo.map((lo, i) => box.hi[i] - lo);
  const toX = (u: number[]) => u.map((v, i) => box.lo[i] + span[i] * sigmoid(v));
  const starts = Array.from({ length: Math.max(1, o.starts) }, (_, s) =>
    x0.map((v, i) => logit(s === 0 ? (v - box.lo[i]) / span[i] : rand())),
  );
  const [b1, b2, eps, h] = [o.beta1 ?? 0.9, o.beta2 ?? 0.999, 1e-8, o.h ?? 1e-4];
  const stallMax = o.stall ?? 80; // iterations without improvement before stopping (0 = never)
  const free = box.integer.map((isInt) => !isInt);
  const decay = o.decay ?? 1;
  const decaySteps = Math.max(1, o.decaySteps ?? 100);
  const stage1 = o.stage1 && o.stage1.iterations > 0 && o.stage1.mask.some(Boolean) ? o.stage1 : undefined;
  // merit of a candidate for the current stage: the sum of the selected objectives, or the total
  const meritOf = (merit: number, parts: number[], mask?: boolean[]) => (mask && mask.some(Boolean) ? parts.reduce((s, p, k) => (mask[k] ? s + p : s), 0) : merit);
  let m = starts.map(() => new Array<number>(d).fill(0));
  let v = starts.map(() => new Array<number>(d).fill(0));
  let step = 0; // steps of the current stage's Adam
  let lastBest = Infinity;
  let stall = 0;
  for (let it = 1; it <= o.iterations; it++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const inStage1 = !!stage1 && it <= stage1.iterations;
    if (stage1 && it === stage1.iterations + 1) {
      // a fresh optimizer for the second stage (as the two optimizers of the reference code)
      m = starts.map(() => new Array<number>(d).fill(0));
      v = starts.map(() => new Array<number>(d).fill(0));
      step = 0;
      lastBest = Infinity;
      stall = 0;
    }
    step++;
    const lr = (inStage1 ? stage1!.lr : o.lr) * decay ** Math.floor((step - 1) / decaySteps);
    const mask = inStage1 ? stage1!.mask : o.stage2Mask;
    const batch: number[][] = [];
    for (const u of starts) {
      batch.push(toX(u));
      for (let i = 0; i < d; i++) if (free[i]) batch.push(toX(u.map((w, j) => (j === i ? w + h : w))));
    }
    const r = await t.full(batch);
    const f = r.merits.map((mt, k) => meritOf(mt, r.parts[k], mask));
    let k = 0;
    let stageBest = Infinity;
    starts.forEach((u, s) => {
      const f0 = f[k++];
      stageBest = Math.min(stageBest, f0);
      for (let i = 0; i < d; i++) {
        const g = free[i] ? (f[k++] - f0) / h : 0;
        if (!Number.isFinite(g)) continue;
        m[s][i] = b1 * m[s][i] + (1 - b1) * g;
        v[s][i] = b2 * v[s][i] + (1 - b2) * g * g;
        const mh = m[s][i] / (1 - b1 ** step);
        const vh = v[s][i] / (1 - b2 ** step);
        u[i] -= (lr * mh) / (Math.sqrt(vh) + eps);
      }
    });
    ctl.report(t.progress(it, stage1 ? (inStage1 ? `Adam, stage 1 (lr ${lr.toPrecision(2)})` : `Adam, stage 2 (lr ${lr.toPrecision(2)})`) : decay !== 1 ? `Adam (lr ${lr.toPrecision(2)})` : 'Adam'));
    // stop when the merit of the current stage no longer improves
    stall = stageBest < lastBest - 1e-10 * Math.abs(lastBest) ? 0 : stall + 1;
    lastBest = Math.min(lastBest, stageBest);
    if (stallMax > 0 && stall >= stallMax && !inStage1) break;
  }
}

export type DeOptions = { iterations: number; population: number; seed: number; strategy?: DeStrategy; F?: number; Fmax?: number; CR?: number };

// Differential evolution. Mutation strategies rand/1, best/1, current-to-best/1, rand/2 with binomial crossover,
// or rand/1 with exponential crossover. F is drawn per generation in [F, Fmax) (dither) or fixed when Fmax ≤ F.
// The first individual is x0.
export async function differentialEvolution(t: Tracker, box: Box, x0: number[], o: DeOptions, ctl: Control) {
  const d = x0.length;
  const rand = rng(o.seed);
  const NP = Math.max(8, o.population);
  const CR = o.CR ?? 0.9;
  const [Fmin, Fmax] = [o.F ?? 0.5, o.Fmax ?? 1];
  const strategy = o.strategy ?? 'rand/1/bin';
  let pop = Array.from({ length: NP }, (_, p) => (p === 0 ? x0.slice() : box.lo.map((lo, i) => lo + rand() * (box.hi[i] - lo))));
  let fit = await t.eval(pop);
  for (let g = 1; g <= o.iterations; g++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const F = Fmax > Fmin ? Fmin + (Fmax - Fmin) * rand() : Fmin;
    const best = fit.reduce((k, f, i) => (f < fit[k] ? i : k), 0);
    const trials = pop.map((x, i) => {
      // distinct random indices, all different from i
      const used = new Set([i]);
      const pick = () => {
        let r = i;
        while (used.has(r)) r = Math.floor(rand() * NP);
        used.add(r);
        return r;
      };
      const [a, b, c] = [pick(), pick(), pick()];
      const [e1, e2] = strategy === 'rand/2/bin' ? [pick(), pick()] : [0, 0];
      const mutant = (j: number) => {
        switch (strategy) {
          case 'best/1/bin':
            return pop[best][j] + F * (pop[a][j] - pop[b][j]);
          case 'current-to-best/1/bin':
            return x[j] + F * (pop[best][j] - x[j]) + F * (pop[a][j] - pop[b][j]);
          case 'rand/2/bin':
            return pop[a][j] + F * (pop[b][j] - pop[c][j]) + F * (pop[e1][j] - pop[e2][j]);
          default:
            return pop[a][j] + F * (pop[b][j] - pop[c][j]);
        }
      };
      const jr = Math.floor(rand() * d);
      // exponential crossover: a run of consecutive variables starting at jr
      const take = new Array<boolean>(d).fill(false);
      if (strategy === 'rand/1/exp') {
        let j = jr;
        let n = 0;
        do {
          take[j] = true;
          j = (j + 1) % d;
          n++;
        } while (n < d && rand() < CR);
      }
      return x.map((xi, j) => {
        if (strategy === 'rand/1/exp' ? !take[j] : j !== jr && rand() >= CR) return xi;
        let v = mutant(j);
        // reflect into the box
        if (v < box.lo[j]) v = box.lo[j] + rand() * (xi - box.lo[j]);
        if (v > box.hi[j]) v = box.hi[j] - rand() * (box.hi[j] - xi);
        return v;
      });
    });
    const ft = await t.eval(trials);
    pop = pop.map((x, i) => (ft[i] <= fit[i] ? trials[i] : x));
    fit = fit.map((f, i) => Math.min(f, ft[i]));
    ctl.report(t.progress(g, 'Differential evolution'));
  }
}

export type NmOptions = { iterations: number; step: number; tol?: number };

// Nelder–Mead in the normalized box [0, 1]^d; stops when the simplex is smaller than tol.
export async function nelderMead(t: Tracker, box: Box, x0: number[], o: NmOptions, ctl: Control, phase = 'Nelder-Mead') {
  const d = x0.length;
  const span = box.lo.map((lo, i) => box.hi[i] - lo || 1);
  const toX = (u: number[]) => u.map((v, i) => box.lo[i] + span[i] * Math.min(1, Math.max(0, v)));
  const u0 = x0.map((v, i) => (v - box.lo[i]) / span[i]);
  let simplex = [u0, ...u0.map((_, i) => u0.map((v, j) => (j === i ? (v + o.step <= 1 ? v + o.step : v - o.step) : v)))];
  let f = await t.eval(simplex.map(toX));
  for (let it = 1; it <= o.iterations; it++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const order = f.map((_, i) => i).sort((a, b) => f[a] - f[b]);
    simplex = order.map((i) => simplex[i]);
    f = order.map((i) => f[i]);
    const size = Math.max(...simplex.slice(1).map((p) => Math.max(...p.map((v, j) => Math.abs(v - simplex[0][j])))));
    if (size < (o.tol ?? 1e-7)) break;
    const c = u0.map((_, j) => simplex.slice(0, d).reduce((s, p) => s + p[j], 0) / d);
    const along = (a: number) => c.map((v, j) => v + a * (v - simplex[d][j]));
    const xr = along(1);
    const [fr] = await t.eval([toX(xr)]);
    if (fr < f[0]) {
      const xe = along(2);
      const [fe] = await t.eval([toX(xe)]);
      [simplex[d], f[d]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < f[d - 1]) [simplex[d], f[d]] = [xr, fr];
    else {
      const xc = fr < f[d] ? along(0.5) : along(-0.5);
      const [fc] = await t.eval([toX(xc)]);
      if (fc < Math.min(fr, f[d])) [simplex[d], f[d]] = [xc, fc];
      else {
        // shrink towards the best vertex
        simplex = simplex.map((p, i) => (i === 0 ? p : p.map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))));
        const fs = await t.eval(simplex.slice(1).map(toX));
        f = [f[0], ...fs];
      }
    }
    ctl.report(t.progress(it, phase));
  }
}

// ---- Real-coded genetic operators ----

const inBox = (x: number[], box: Box) => project(x, { ...box, integer: box.integer.map(() => false) });

// Crossover of two parents. SBX (distribution index η), BLX-α, uniform (swap each variable), arithmetic (one random
// weight for the whole vector). With probability 1 − prob the parents are copied unchanged.
export function crossover(a: number[], b: number[], box: Box, rand: () => number, c: Crossover = CROSSOVER_DEFAULT): [number[], number[]] {
  if (c.prob < 1 && rand() >= c.prob) return [a.slice(), b.slice()];
  const c1 = a.slice();
  const c2 = b.slice();
  if (c.type === 'arithmetic') {
    const l = rand();
    for (let i = 0; i < a.length; i++) {
      c1[i] = l * a[i] + (1 - l) * b[i];
      c2[i] = (1 - l) * a[i] + l * b[i];
    }
  } else
    for (let i = 0; i < a.length; i++) {
      if (c.type === 'uniform') {
        if (rand() < 0.5) [c1[i], c2[i]] = [b[i], a[i]];
      } else if (c.type === 'blx') {
        const lo = Math.min(a[i], b[i]);
        const d = Math.abs(a[i] - b[i]);
        const [l, h] = [lo - c.alpha * d, lo + d + c.alpha * d];
        c1[i] = l + rand() * (h - l);
        c2[i] = l + rand() * (h - l);
      } else {
        if (rand() > 0.5 || Math.abs(a[i] - b[i]) < 1e-14) continue;
        const u = rand();
        const beta = u <= 0.5 ? (2 * u) ** (1 / (c.eta + 1)) : (1 / (2 * (1 - u))) ** (1 / (c.eta + 1));
        c1[i] = 0.5 * ((1 + beta) * a[i] + (1 - beta) * b[i]);
        c2[i] = 0.5 * ((1 - beta) * a[i] + (1 + beta) * b[i]);
      }
    }
  return [inBox(c1, box), inBox(c2, box)];
}

// Mutation of each variable with probability prob (≤ 0 = 1/n): polynomial (η), Gaussian (σ as a fraction of the
// range) or uniform (a new random value).
export function mutate(x: number[], box: Box, rand: () => number, m: Mutation = MUTATION_DEFAULT): number[] {
  const p = m.prob > 0 ? m.prob : 1 / x.length;
  return x.map((v, i) => {
    if (rand() >= p) return v;
    const span = box.hi[i] - box.lo[i];
    let nv: number;
    if (m.type === 'uniform') nv = box.lo[i] + rand() * span;
    else if (m.type === 'gaussian') {
      const g = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
      nv = v + g * m.sigma * span;
    } else {
      const u = rand();
      const delta = u < 0.5 ? (2 * u) ** (1 / (m.eta + 1)) - 1 : 1 - (2 * (1 - u)) ** (1 / (m.eta + 1));
      nv = v + delta * span;
    }
    return Math.min(box.hi[i], Math.max(box.lo[i], nv));
  });
}

const randomPoint = (box: Box, rand: () => number) => box.lo.map((lo, i) => lo + rand() * (box.hi[i] - lo));

export type PopOptions = { iterations: number; population: number; seed: number };
export type GaOptions = PopOptions & { tournament?: number; elites?: number; crossover?: Crossover; mutation?: Mutation };

// Genetic algorithm: tournament selection (size k), crossover, mutation, elites kept unchanged.
export async function genetic(t: Tracker, box: Box, x0: number[], o: GaOptions, ctl: Control) {
  const rand = rng(o.seed);
  const N = Math.max(8, o.population + (o.population % 2));
  const k = Math.max(1, Math.round(o.tournament ?? 2));
  const E = Math.min(N - 2, Math.max(0, Math.round(o.elites ?? 2)));
  let pop = Array.from({ length: N }, (_, i) => (i === 0 ? x0.slice() : randomPoint(box, rand)));
  let fit = await t.eval(pop);
  const tournament = () => {
    let best = Math.floor(rand() * N);
    for (let j = 1; j < k; j++) {
      const c = Math.floor(rand() * N);
      if (fit[c] < fit[best]) best = c;
    }
    return pop[best];
  };
  for (let g = 1; g <= o.iterations; g++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const order = fit.map((_, i) => i).sort((a, b) => fit[a] - fit[b]);
    const elites = order.slice(0, E).map((i) => pop[i]);
    const eliteFit = order.slice(0, E).map((i) => fit[i]);
    const kids: number[][] = [];
    while (kids.length < N - E) {
      const [c1, c2] = crossover(tournament(), tournament(), box, rand, o.crossover);
      kids.push(mutate(c1, box, rand, o.mutation), mutate(c2, box, rand, o.mutation));
    }
    kids.length = N - E;
    const kf = await t.eval(kids);
    pop = [...elites, ...kids];
    fit = [...eliteFit, ...kf];
    ctl.report(t.progress(g, 'Genetic algorithm'));
  }
}

export type PsoOptions = PopOptions & { w?: number; wEnd?: number; c1?: number; c2?: number; vmax?: number; topology?: 'global' | 'ring'; neighbours?: number };

// Particle swarm: inertia w (linearly from w to wEnd over the run), cognitive c1 and social c2 coefficients,
// velocities limited to vmax × box. Global best, or a ring topology (each particle sees ± neighbours).
export async function particleSwarm(t: Tracker, box: Box, x0: number[], o: PsoOptions, ctl: Control) {
  const rand = rng(o.seed);
  const N = Math.max(8, o.population);
  const [w0, w1, c1, c2] = [o.w ?? 0.72, o.wEnd ?? o.w ?? 0.72, o.c1 ?? 1.49, o.c2 ?? 1.49];
  const ring = o.topology === 'ring';
  const K = Math.max(1, Math.round(o.neighbours ?? 1));
  const span = box.lo.map((lo, i) => box.hi[i] - lo);
  const vmax = span.map((s) => (o.vmax ?? 0.2) * s);
  let x = Array.from({ length: N }, (_, i) => (i === 0 ? x0.slice() : randomPoint(box, rand)));
  const v = Array.from({ length: N }, () => span.map((s) => (rand() - 0.5) * 0.1 * s));
  let f = await t.eval(x);
  const pbest = x.map((p) => p.slice());
  const pf = f.slice();
  const leader = (i: number) => {
    if (!ring) return pf.reduce((k, val, j) => (val < pf[k] ? j : k), 0);
    let best = i;
    for (let s = -K; s <= K; s++) {
      const j = (i + s + N) % N;
      if (pf[j] < pf[best]) best = j;
    }
    return best;
  };
  for (let it = 1; it <= o.iterations; it++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const w = w0 + (w1 - w0) * ((it - 1) / Math.max(1, o.iterations - 1));
    const leaders = x.map((_, i) => leader(i));
    x = x.map((p, i) =>
      p.map((xi, j) => {
        let vj = w * v[i][j] + c1 * rand() * (pbest[i][j] - xi) + c2 * rand() * (pbest[leaders[i]][j] - xi);
        vj = Math.max(-vmax[j], Math.min(vmax[j], vj));
        let nx = xi + vj;
        if (nx < box.lo[j] || nx > box.hi[j]) {
          nx = Math.min(box.hi[j], Math.max(box.lo[j], nx));
          vj = 0;
        }
        v[i][j] = vj;
        return nx;
      }),
    );
    f = await t.eval(x);
    f.forEach((val, i) => {
      if (val < pf[i]) {
        pf[i] = val;
        pbest[i] = x[i].slice();
      }
    });
    ctl.report(t.progress(it, 'Particle swarm'));
  }
}

// ---- NSGA-II: every objective minimized separately; the result is the Pareto front ----

const dominatesF = (a: number[], b: number[]) => a.every((v, i) => v <= b[i]) && a.some((v, i) => v < b[i]);

// Fast non-dominated sorting: front index of every point (0 = non-dominated). With violations V (Deb's constrained
// domination): a feasible point dominates an infeasible one, of two infeasible ones the smaller violation dominates.
// Fast non-dominated sorting: front index of every point (0 = non-dominated). With violations V (Deb's constrained
// domination): a feasible point dominates an infeasible one, of two infeasible ones the smaller violation dominates.
export function paretoRanks(F: number[][], V?: number[]): number[] {
  const n = F.length;
  const dominates = (p: number, q: number) => {
    if (V && (V[p] > 0 || V[q] > 0)) return V[p] < V[q];
    return dominatesF(F[p], F[q]);
  };
  const rank = new Array<number>(n).fill(-1);
  const dominated: number[][] = F.map(() => []);
  const count = new Array<number>(n).fill(0);
  let front: number[] = [];
  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(p, q)) dominated[p].push(q);
      else if (dominates(q, p)) count[p]++;
    }
    if (count[p] === 0) {
      rank[p] = 0;
      front.push(p);
    }
  }
  let r = 0;
  while (front.length) {
    const next: number[] = [];
    for (const p of front)
      for (const q of dominated[p])
        if (--count[q] === 0) {
          rank[q] = r + 1;
          next.push(q);
        }
    r++;
    front = next;
  }
  return rank;
}

function crowding(F: number[][], idx: number[]): Map<number, number> {
  const dist = new Map(idx.map((i) => [i, 0]));
  const m = F[0]?.length ?? 0;
  for (let k = 0; k < m; k++) {
    const s = [...idx].sort((a, b) => F[a][k] - F[b][k]);
    const span = F[s[s.length - 1]][k] - F[s[0]][k] || 1;
    dist.set(s[0], Infinity);
    dist.set(s[s.length - 1], Infinity);
    for (let i = 1; i < s.length - 1; i++) dist.set(s[i], dist.get(s[i])! + (F[s[i + 1]][k] - F[s[i - 1]][k]) / span);
  }
  return dist;
}

export type Nsga2Options = PopOptions & { crossover?: Crossover; mutation?: Mutation };

// NSGA-II (Deb 2002) with constrained domination when the evaluator reports violations: the front is made of feasible
// points as soon as there are any.
export async function nsga2(t: Tracker, box: Box, x0: number[], o: Nsga2Options, ctl: Control) {
  const rand = rng(o.seed);
  const N = Math.max(8, o.population + (o.population % 2));
  let pop = Array.from({ length: N }, (_, i) => (i === 0 ? x0.slice() : randomPoint(box, rand)));
  const first = await t.full(pop);
  let F = first.parts;
  let V = first.violations;
  const select = (P: number[][], FF: number[][], VV?: number[]) => {
    // environmental selection of N from P by rank, then crowding distance
    const rank = paretoRanks(FF, VV);
    const out: number[] = [];
    for (let r = 0; out.length < N; r++) {
      const front = rank.map((v, i) => (v === r ? i : -1)).filter((i) => i >= 0);
      if (!front.length) break;
      if (out.length + front.length <= N) out.push(...front);
      else {
        const cd = crowding(FF, front);
        out.push(...front.sort((a, b) => cd.get(b)! - cd.get(a)!).slice(0, N - out.length));
      }
    }
    return { P: out.map((i) => P[i]), F: out.map((i) => FF[i]), V: VV && out.map((i) => VV[i]) };
  };
  const frontOf = (P: number[][], FF: number[][], VV?: number[]) => {
    const rank = paretoRanks(FF, VV);
    return P.flatMap((x, i) => (rank[i] === 0 ? [{ x, f: FF[i], ...(VV ? { v: VV[i] } : {}) }] : []));
  };
  for (let g = 1; g <= o.iterations; g++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const rank = paretoRanks(F, V);
    const cd = crowding(F, F.map((_, i) => i));
    // binary crowded tournament
    const pick = () => {
      const [a, b] = [Math.floor(rand() * N), Math.floor(rand() * N)];
      return rank[a] < rank[b] || (rank[a] === rank[b] && cd.get(a)! > cd.get(b)!) ? pop[a] : pop[b];
    };
    const kids: number[][] = [];
    while (kids.length < N) {
      const [c1, c2] = crossover(pick(), pick(), box, rand, o.crossover);
      kids.push(mutate(c1, box, rand, o.mutation), mutate(c2, box, rand, o.mutation));
    }
    const kr = await t.full(kids);
    const all = select([...pop, ...kr.points], [...F, ...kr.parts], V && kr.violations ? [...V, ...kr.violations] : undefined);
    pop = all.P;
    F = all.F;
    V = all.V;
    ctl.report(t.progress(g, 'NSGA-II', frontOf(pop, F, V)));
  }
  return frontOf(pop, F, V);
}

// ---- Levenberg–Marquardt on the objectives' residuals (curve matching) ----

export type LmOptions = { iterations: number; lambda0?: number; h?: number };

export async function levenbergMarquardtBatch(t: Tracker, box: Box, x0: number[], o: LmOptions, ctl: Control) {
  const span = box.lo.map((lo, i) => box.hi[i] - lo || 1);
  const toX = (u: number[]) => u.map((v, i) => box.lo[i] + span[i] * Math.min(1, Math.max(0, v)));
  let u = x0.map((v, i) => (v - box.lo[i]) / span[i]);
  const ssq = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  let r = (await t.full([toX(u)], true)).residuals![0];
  if (r.some((v) => !Number.isFinite(v))) throw new Error('Levenberg-Marquardt needs objectives with residuals (Curve match, or costs ≥ 0).');
  let cost = ssq(r);
  let lambda = o.lambda0 ?? 1e-3;
  const h = o.h ?? 1e-5;
  const free = box.integer.map((isInt) => !isInt);
  for (let it = 1; it <= o.iterations; it++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const probes = u.map((_, j) => toX(u.map((v, k) => (k === j ? v + h : v))));
    const rr = (await t.full(probes, true)).residuals!;
    const J = rr.map((rj, j) => (free[j] ? rj.map((v, i) => (v - r[i]) / h) : r.map(() => 0)));
    const JtJ = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const Jtr = J.map((a) => a.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 10 && !improved; tries++) {
      const A = JtJ.map((row, i) => row.map((v, k) => (i === k ? v + lambda * (v || 1e-12) : v)));
      const step = solve(A, Jtr.map((v) => -v));
      if (step) {
        const un = u.map((v, i) => Math.min(1, Math.max(0, v + (free[i] ? step[i] : 0))));
        const rn = (await t.full([toX(un)], true)).residuals![0];
        const cn = ssq(rn);
        if (cn < cost) {
          [u, r, cost] = [un, rn, cn];
          lambda = Math.max(lambda / 3, 1e-12);
          improved = true;
          break;
        }
      }
      lambda *= 4;
    }
    ctl.report(t.progress(it, 'Levenberg-Marquardt'));
    if (!improved) break;
  }
}

export type SaOptions = { iterations: number; seed: number; t0?: number; cooling?: number; perTemp?: number; step?: number; chains?: number };

// Simulated annealing (S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, Science 220, 671 (1983); as used for thin-film
// emitters by H. Pan et al., Opt. Express 32, 47154 (2024): T₀ = 100, cooling 0.95, 1000 moves per temperature).
// Each chain moves to a random neighbour (every variable perturbed by a Gaussian of σ = step·range·√(T/T₀), at least
// 0.1 % of the range): a better point is always accepted, a worse one with probability exp(−Δ/T) (Metropolis); after
// `perTemp` moves T ← cooling·T. Independent chains run side by side (one candidate per chain in each batch). t0 ≤ 0:
// automatic, from the merit changes of random neighbours of the start (an initial acceptance of ~80 % of the worse moves).
export async function simulatedAnnealing(t: Tracker, box: Box, x0: number[], o: SaOptions, ctl: Control) {
  const rand = rng(o.seed);
  const span = box.lo.map((lo, i) => box.hi[i] - lo);
  const chains = Math.max(1, Math.round(o.chains ?? 4));
  const cooling = Math.min(0.9999, Math.max(0.01, o.cooling ?? 0.95));
  const perTemp = Math.max(1, Math.round(o.perTemp ?? 50));
  const step = o.step ?? 0.1;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const neighbour = (x: number[], scale: number) => x.map((v, i) => v + Math.max(1e-3, step * scale) * span[i] * gauss());
  // the chains start at x0 (the first) and at random points
  let cur = Array.from({ length: chains }, (_, c) => (c === 0 ? x0.slice() : box.lo.map((lo, i) => lo + rand() * span[i])));
  const start = await t.full(cur);
  cur = start.points;
  let f = start.merits.slice();
  let T0 = o.t0 ?? 0;
  if (!(T0 > 0)) {
    // automatic: mean increase over random neighbours of the chains, T₀ = −mean(Δ⁺)/ln 0.8
    const probe = await t.full(cur.flatMap((x) => [neighbour(x, 1), neighbour(x, 1)]));
    const ups = probe.merits.map((m, k) => m - f[Math.floor(k / 2)]).filter((v) => v > 0 && Number.isFinite(v));
    const finite = f.filter(Number.isFinite);
    const mean = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : finite.length ? Math.abs(finite[0]) * 0.1 || 1 : 1;
    T0 = -mean / Math.log(0.8);
    if (!(T0 > 0 && Number.isFinite(T0))) T0 = 1;
  }
  let T = T0;
  let accepted = 0;
  let moves = 0;
  for (let it = 1; it <= o.iterations; it++) {
    await ctl.waitIfPaused();
    if (ctl.stopped()) break;
    const cand = cur.map((x) => neighbour(x, Math.sqrt(T / T0)));
    const r = await t.full(cand);
    r.merits.forEach((m, c) => {
      moves++;
      const delta = m - f[c];
      if (Number.isFinite(m) && (delta <= 0 || rand() < Math.exp(-delta / T))) {
        cur[c] = r.points[c];
        f[c] = m;
        accepted++;
      }
    });
    if (it % perTemp === 0) T *= cooling;
    ctl.report(t.progress(it, `Simulated annealing (T = ${T.toPrecision(3)}, accepted ${((100 * accepted) / Math.max(1, moves)).toFixed(0)} %)`));
  }
}