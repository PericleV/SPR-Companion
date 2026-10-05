// Optimization of the project: the variables are the exposed parameters with “optimize” on (continuous, integer, or a
// material among candidates), the objectives are exposed quantities of the metrics (minimize, maximize, reach a
// target, stay ≤ / ≥ a limit; weights and scales). A candidate is evaluated by applying its values, computing the
// Simulation's interrogation and the metrics (pure: runs in the workers); spr-forge's optimizers search the box.
import type { Library } from '../physics/library.ts';
import type { Models } from '../physics/materials.ts';
import { metricCost, type MetricGoal } from '../engine/objectives.ts';
import type { AlgoParamsPatch, Box } from '../engine/optimize.ts';
import type { Interrogation } from './analysis.ts';
import { optInteger, type Exposed } from './exposed.ts';
import type { Metric } from './metrics.ts';
import type { Derived } from './derived.ts';
import { applyParams, paramKey, refValid, type ParamInfo, type ParamRef, type ParamValue } from './params.ts';
import { expand, hasRandomRough, realization, type Structure } from './structure.ts';
import { metricValues, simulateCore } from './run.ts';

export type Algorithm = 'adam' | 'de' | 'nm' | 'ga' | 'pso' | 'nsga2' | 'lm' | 'sa';
export const ALGORITHMS: { id: Algorithm; label: string; note: string; population: boolean }[] = [
  { id: 'de', label: 'Differential evolution', note: 'global, robust; integer and material variables', population: true },
  { id: 'ga', label: 'Genetic algorithm', note: 'global; tournament, SBX crossover, polynomial mutation, elites', population: true },
  { id: 'pso', label: 'Particle swarm', note: 'global; fast on smooth problems', population: true },
  { id: 'sa', label: 'Simulated annealing', note: 'global; parallel chains', population: false },
  { id: 'nsga2', label: 'NSGA-II (Pareto front)', note: 'several objectives at once: the front of the best compromises', population: true },
  { id: 'adam', label: 'Adam (gradient)', note: 'local, from the current structure; continuous variables only', population: false },
  { id: 'nm', label: 'Nelder-Mead', note: 'local simplex, from the current structure', population: false },
  { id: 'lm', label: 'Levenberg-Marquardt', note: 'local least squares: objectives with a target or a limit', population: false },
];

// role: an objective (minimize, maximize, reach a target, a soft limit), or a constraint (≤ / ≥ / = a limit) that a
// solution must satisfy — NSGA-II ranks feasible solutions first (Deb's constrained domination), the other algorithms
// add a large penalty
export type Objective = { id: string; on: boolean; metric: string; key: string; goal: MetricGoal; target: number; weight: number; scale: number; role?: 'objective' | 'constraint' };

export type OptSettings = {
  algorithm: Algorithm;
  iterations: number;
  population: number;
  seed: number;
  polish: boolean; // a Nelder-Mead from the best at the end
  params: AlgoParamsPatch;
  objectives: Objective[];
  respMarks?: boolean; // the metrics' overlays on the response of the run (all on / off)
  respHidden?: string[]; // and those not drawn (a metric id, or 'id:part')
  // rough structures: every candidate evaluated on n realizations of its random profiles (seeds seed … seed + n − 1),
  // each quantity their mean or median
  samples?: Samples;
};
export type Samples = { stat: 'one' | 'mean' | 'median'; n: number };

export const defaultOpt = (): OptSettings => ({ algorithm: 'de', iterations: 60, population: 24, seed: 1, polish: false, params: {}, objectives: [] });

// A variable of the search: an exposed parameter with optimize on (a material: the index of its candidate).
export type OptVar = { id: string; name: string; ref: ParamRef; lo: number; hi: number; integer: boolean; mats?: string[]; start: number; unit: string };

export function variablesOf(params: Exposed[], structure: Structure, infos: Map<string, ParamInfo>): OptVar[] {
  return params.flatMap((x) => {
    const info = infos.get(paramKey(x.ref));
    if (!x.opt.on || !info || !refValid(structure, x.ref)) return [];
    if (info.material) {
      const mats = x.mats.length ? x.mats : [String(info.value)];
      return [{ id: x.id, name: x.name, ref: x.ref, lo: 0, hi: mats.length - 1, integer: true, mats, start: Math.max(0, mats.indexOf(String(info.value))), unit: '' }];
    }
    const [lo, hi] = [Math.min(x.opt.min, x.opt.max), Math.max(x.opt.min, x.opt.max)];
    const v = typeof info.value === 'number' ? info.value : lo;
    return [{ id: x.id, name: x.name, ref: x.ref, lo, hi, integer: optInteger(x, info), start: Math.min(hi, Math.max(lo, v)), unit: info.unit }];
  });
}

export const boxOf = (vars: OptVar[]): Box => ({ lo: vars.map((v) => v.lo), hi: vars.map((v) => v.hi), integer: vars.map((v) => v.integer) });

// The parameter values of a point of the box.
export const valuesAt = (vars: OptVar[], x: number[]): [ParamRef, ParamValue][] =>
  vars.map((v, i) => [v.ref, v.mats ? v.mats[Math.min(v.mats.length - 1, Math.max(0, Math.round(x[i])))] : v.integer ? Math.round(x[i]) : x[i]]);

export type EvalJob = { structure: Structure; it: Interrogation; metrics: Metric[]; derived?: Derived[]; vars: OptVar[]; objectives: Objective[]; samples?: Samples };
// merit: the total cost (constraints as penalties); parts: the cost of each objective (not the constraints); values:
// the quantities of every row; residuals (least squares); violation: how far the constraints are broken (0: feasible)
export type Evaluation = { merit: number; parts: number[]; values: number[]; residuals: number[]; violation: number };

export const PENALTY = 1e6; // the cost of an objective whose quantity cannot be computed (no dip in the ROI…)
export const CONSTRAINT_WEIGHT = 1e3; // a broken constraint in the merit of the single-objective algorithms

export const isConstraint = (o: Objective) => o.role === 'constraint';

export function costOf(o: Objective, v: number): number {
  if (!Number.isFinite(v)) return PENALTY;
  return o.weight * metricCost(v, o.goal, o.target, o.scale);
}

// How far a constraint (≤ / ≥ a limit, or = a target) is broken, in units of its scale.
export function violationOf(o: Objective, v: number): number {
  if (!Number.isFinite(v)) return PENALTY;
  const s = o.scale > 0 ? o.scale : 1;
  if (o.goal === 'le') return Math.max(0, (v - o.target) / s);
  if (o.goal === 'ge') return Math.max(0, (o.target - v) / s);
  if (o.goal === 'target') return Math.abs(v - o.target) / s;
  return 0;
}

// The residual of an objective for least squares (√cost with its sign), NaN for minimize / maximize.
function residualOf(o: Objective, v: number): number {
  if (!Number.isFinite(v)) return 1e3;
  const s = o.scale > 0 ? o.scale : 1;
  if (o.goal === 'target') return (Math.sqrt(o.weight) * (v - o.target)) / s;
  if (o.goal === 'le' || o.goal === 'ge') return Math.sqrt(o.weight * metricCost(v, o.goal, o.target, o.scale));
  return NaN;
}

// The quantities of the objectives' rows for one structure: the Simulation's computation (a scan or a map) and its
// metrics, each metric's value on its first curve.
export function rowValues(structure: Structure, it: Interrogation, metrics: Metric[], derived: Derived[], rows: Objective[], lib: Library, models: Models): number[] {
  const ex = expand(structure, lib, models);
  if (ex.errors.length) return rows.map(() => NaN);
  const used = metrics.filter((m) => m.on);
  const r = simulateCore(structure, it, used, derived, lib, models);
  const res = metricValues(r.groups, used);
  return rows.map((o) => {
    const k = used.findIndex((m) => m.id === o.metric);
    return k >= 0 ? (res[k]?.values[o.key] ?? NaN) : NaN;
  });
}

// The mean or the median of each quantity over the realizations (NaN left out; none finite: NaN).
export function aggregate(rows: number[][], stat: 'mean' | 'median'): number[] {
  return (rows[0] ?? []).map((_, q) => {
    const v = rows.map((r) => r[q]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    if (stat === 'mean') return v.reduce((a, b) => a + b, 0) / v.length;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  });
}

// The quantities of a structure: one computation, or the mean / median over n realizations of its random profiles.
export function sampledValues(structure: Structure, it: Interrogation, metrics: Metric[], derived: Derived[], rows: Objective[], lib: Library, models: Models, samples?: Samples): number[] {
  const n = Math.max(1, Math.round(samples?.n ?? 1));
  if (!samples || samples.stat === 'one' || n < 2 || !hasRandomRough(structure)) return rowValues(structure, it, metrics, derived, rows, lib, models);
  return aggregate(Array.from({ length: n }, (_, k) => rowValues(realization(structure, k), it, metrics, derived, rows, lib, models)), samples.stat);
}

export function evaluateCandidates(job: EvalJob, lib: Library, models: Models, xs: number[][]): Evaluation[] {
  const rows = job.objectives.filter((o) => o.on);
  return xs.map((x) => {
    const { structure, it } = applyParams(job.structure, job.it, valuesAt(job.vars, x));
    const values = sampledValues(structure, it, job.metrics, job.derived ?? [], rows, lib, models, job.samples);
    const parts: number[] = [];
    const residuals: number[] = [];
    let violation = 0;
    let penalty = 0;
    rows.forEach((o, i) => {
      if (isConstraint(o)) {
        const v = violationOf(o, values[i]);
        violation += v;
        penalty += CONSTRAINT_WEIGHT * o.weight * v * v;
        if (o.goal !== 'min' && o.goal !== 'max') residuals.push(Math.sqrt(CONSTRAINT_WEIGHT * o.weight) * v);
      } else {
        parts.push(costOf(o, values[i]));
        residuals.push(residualOf(o, values[i]));
      }
    });
    return { merit: parts.reduce((s, v) => s + v, 0) + penalty, parts, values, residuals, violation };
  });
}

let counter = 0;
export const newObjective = (metric: string, key: string, over: Partial<Objective> = {}): Objective => ({ id: `o${Date.now().toString(36)}${counter++}`, on: true, metric, key, goal: 'max', target: 0, weight: 1, scale: 1, ...over });

// An optimization applied to a configuration: when, how, each variable before and after, each goal at the start and
// at the applied point (the Compare page shows them; the structure's optimized layers are marked).
export type OptRecord = {
  id: string;
  date: string; // ISO
  algorithm: string;
  vars: { name: string; ref: ParamRef; unit: string; from: number | string; to: number | string }[];
  goals: { label: string; unit: string; role: 'objective' | 'constraint'; goal: MetricGoal; target: number; start: number; end: number; met?: boolean }[];
};
let recordCounter = 0;
// The record of applying the point x of a run (names: a material id's name).
export function optRecordOf(
  algorithm: string,
  vars: OptVar[],
  x: number[],
  goals: { o: Objective; label: string; unit: string; start: number; end: number }[],
  name: (id: string) => string = (id) => id,
): OptRecord {
  const valueOf = (v: OptVar, t: number): number | string => (v.mats ? name(v.mats[Math.min(v.mats.length - 1, Math.max(0, Math.round(t)))]) : v.integer ? Math.round(t) : +t.toPrecision(6));
  return {
    id: `or${Date.now().toString(36)}${recordCounter++}`,
    date: new Date().toISOString(),
    algorithm,
    vars: vars.map((v, i) => ({ name: v.name, ref: v.ref, unit: v.unit, from: valueOf(v, v.start), to: valueOf(v, x[i]) })),
    goals: goals.map((g) => ({ label: g.label, unit: g.unit, role: isConstraint(g.o) ? 'constraint' : 'objective', goal: g.o.goal, target: g.o.target, start: g.start, end: g.end, ...(isConstraint(g.o) ? { met: violationOf(g.o, g.end) <= 0 } : {}) })),
  };
}

// Choosing among solutions (a Pareto front) by several criteria: each criterion a quantity (its index in a solution's
// values) to maximize or minimize with a weight; filters keep the solutions within limits. Each criterion is
// normalized over the kept solutions (0: the best of them, 1: the worst). Methods: the distance to the ideal point
// (all criteria at their best; the usual compromise), the weighted sum, or lexicographic (the first criterion, then
// the next on ties). Returns the kept solutions best first, and the score of each (NaN: filtered out).
export type RankCriterion = { q: number; goal: 'max' | 'min'; weight: number };
export type RankFilter = { q: number; op: 'le' | 'ge'; value: number };
export type RankMethod = 'ideal' | 'sum' | 'lex';
export const RANK_METHODS: { id: RankMethod; label: string; title: string }[] = [
  { id: 'ideal', label: 'Ideal point', title: 'The distance to the ideal point (every criterion at its best), weighted' },
  { id: 'sum', label: 'Weighted sum', title: 'The weighted sum of the normalized criteria' },
  { id: 'lex', label: 'Lexicographic', title: 'By the first criterion, then the next on ties' },
];

export function rankSolutions(values: number[][], criteria: RankCriterion[], filters: RankFilter[], method: RankMethod): { order: number[]; score: number[] } {
  const keep = values.map((v) => filters.every((f) => Number.isFinite(v[f.q]) && (f.op === 'le' ? v[f.q] <= f.value : v[f.q] >= f.value)));
  const kept = values.map((_, i) => i).filter((i) => keep[i]);
  const score = values.map(() => NaN);
  if (!criteria.length) {
    kept.forEach((i) => (score[i] = 0));
    return { order: kept, score };
  }
  // normalized criteria of each kept solution (0 best, 1 worst; a missing value: the worst)
  const norm = new Map<number, number[]>();
  const ranges = criteria.map((c) => {
    const vs = kept.map((i) => values[i][c.q]).filter(Number.isFinite);
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 0];
  });
  for (const i of kept)
    norm.set(
      i,
      criteria.map((c, k) => {
        const v = values[i][c.q];
        const [lo, hi] = ranges[k];
        if (!Number.isFinite(v)) return 1;
        if (hi - lo < 1e-300) return 0;
        return c.goal === 'max' ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
      }),
    );
  const w = criteria.map((c) => Math.max(0, c.weight));
  const W = w.reduce((s, x) => s + x, 0) || 1;
  const order = kept.slice();
  if (method === 'lex') {
    order.sort((a, b) => {
      const na = norm.get(a)!;
      const nb = norm.get(b)!;
      for (let k = 0; k < criteria.length; k++) if (Math.abs(na[k] - nb[k]) > 1e-12) return na[k] - nb[k];
      return 0;
    });
    order.forEach((i, r) => (score[i] = r));
  } else {
    for (const i of kept) {
      const n = norm.get(i)!;
      score[i] = method === 'ideal' ? Math.sqrt(n.reduce((s, x, k) => s + w[k] * x * x, 0) / W) : n.reduce((s, x, k) => s + w[k] * x, 0) / W;
    }
    order.sort((a, b) => score[a] - score[b]);
  }
  return { order, score };
}