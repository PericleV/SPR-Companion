// The Simulation of a project, as pure functions: the sweep job (the swept exposed parameters, then the scanned
// quantities: λ or θ, or θ and λ for a dispersion map), the dataset of its results with the computed quantities, the
// context of the metrics on each curve, and the whole computation in one call (scripts, the optimization's
// evaluations; the page runs the job in workers).
import type { Library } from '../physics/library.ts';
import type { Models } from '../physics/materials.ts';
import type { Axis } from '../engine/types.ts';
import { LAMBDA_AXIS, linspace, THETA_AXIS } from './compute.ts';
import { interrogationOf, metricContext, scanAxisOf, type Interrogation } from './analysis.ts';
import { computeDerived, type Derived } from './derived.ts';
import { sweepValues, type Exposed } from './exposed.ts';
import { phaseShiftKey, shiftKey, usesPhaseShift, usesShift, type Metric, type MetricContext, type MetricResult } from './metrics.ts';
import { applyParams, listParams, paramKey, refValid, type ParamInfo, type ParamRef, type ParamValue } from './params.ts';
import type { Project, SimSettings } from './project.ts';
import { expand, type Expanded, type Structure } from './structure.ts';
import { FIELDS, placeBlock, runSweepChunk, sizeOf, layout, type FieldKey, type SweepJob } from './sweep.ts';
import { analyzeSweep, firstResult, type AnalysisGroup, type SweepData } from './sweepAnalysis.ts';

const itOf = interrogationOf;

export const paramInfos = (p: Pick<Project, 'structure' | 'sim'>, lib: Library): Map<string, ParamInfo> =>
  new Map(listParams(p.structure, itOf(p.sim), lib, true).map((x) => [x.key, x]));

// The exposed parameters that can be swept (structural: λ and θ are the scan's) and the chosen ones.
export function sweptOf(p: Pick<Project, 'params' | 'structure' | 'sweep'>, infos: Map<string, ParamInfo>) {
  const usable = p.params.filter((x) => x.ref.kind !== 'scan' && refValid(p.structure, x.ref) && infos.has(paramKey(x.ref)));
  const axes = p.sweep.axes.map((id) => usable.find((x) => x.id === id)).filter((x): x is Exposed => !!x);
  return { usable, axes };
}

// The scanned axes: λ or θ, or θ then λ (a map: the curves along λ, one per θ).
export function scanAxes(s: Interrogation): { id: 'lambda' | 'theta'; ref: ParamRef; values: number[] }[] {
  const th = { id: 'theta' as const, ref: { kind: 'scan' as const, prop: 'theta' as const }, values: linspace(s.tFrom ?? 0, s.tTo ?? 40, Math.max(1, Math.round(s.tPoints ?? 81))) };
  const lam = (values: number[]) => ({ id: 'lambda' as const, ref: { kind: 'scan' as const, prop: 'lambda' as const }, values });
  if (s.mode === 'map') return [th, lam(linspace(s.from, s.to, s.points))];
  if (s.mode === 'theta') return [{ ...th, values: linspace(s.from, s.to, s.points) }];
  return [lam(linspace(s.from, s.to, s.points))];
}

export function jobOf(structure: Structure, sim: Interrogation, metrics: Metric[], swept: { id: string; ref: ParamRef; values: ParamValue[] }[], fields: FieldKey[] | 'all'): SweepJob {
  // R with n + Δn (the sensitivities), and the phase of r with n + Δn (the phase and GH metrics)
  const shifts = [
    ...new Map(metrics.filter(usesShift).map((m) => [shiftKey(m), { key: shiftKey(m), target: m.target, dn: m.dn }])).values(),
    ...new Map(metrics.filter(usesPhaseShift).map((m) => [phaseShiftKey(m), { key: phaseShiftKey(m), target: m.target, dn: m.dn, phase: true }])).values(),
  ];
  return {
    structure,
    base: { lambda: sim.lambda, theta: sim.theta, pol: sim.pol },
    axes: [...swept, ...scanAxes(sim)],
    fields: fields === 'all' ? [...FIELDS] : [...new Set<FieldKey>(['R', ...fields])],
    shifts,
  };
}

export function sweepJobOf(p: Project, infos: Map<string, ParamInfo>): SweepJob {
  const { axes } = sweptOf(p, infos);
  // one scan or a map: every quantity; a sweep: those chosen (memory)
  return jobOf(p.structure, p.sim, p.metrics, axes.map((x) => ({ id: x.id, ref: x.ref, values: sweepValues(x, infos.get(paramKey(x.ref))) })), axes.length ? p.sweep.fields : 'all');
}

// The dataset axis of an exposed parameter (a material parameter: its candidates as labelled indices).
function axisOf(x: Exposed, info: ParamInfo, values: (number | string)[], name: (id: string) => string): Axis {
  if (info.material) return { id: x.id, label: x.name, unit: '', values: values.map((_, i) => i), labels: values.map((v) => name(String(v))) };
  return { id: x.id, label: x.name, unit: info.unit, values: values as number[], ...(info.ref.kind === 'rough' && info.ref.prop === 'seed' ? { seed: true } : {}) };
}

// The results of a job as a dataset, with the computed quantities (formulas).
export function sweepDataOf(p: Pick<Project, 'params' | 'derived'>, job: SweepJob, fields: Record<string, Float64Array>, shifts: Float64Array[], infos: Map<string, ParamInfo>, lib: Library): { data: SweepData; errors: Record<string, string> } {
  const name = (id: string) => lib.get(id)?.name ?? id;
  const ax: Axis[] = job.axes.map((a) => {
    if (a.ref.kind === 'scan') return { ...(a.ref.prop === 'theta' ? THETA_AXIS : LAMBDA_AXIS), values: a.values as number[] };
    const x = p.params.find((q) => q.id === a.id) ?? ({ id: a.id, name: a.id } as Exposed);
    const info = infos.get(paramKey(a.ref)) ?? ({ material: typeof a.values[0] === 'string', unit: '' } as ParamInfo);
    return axisOf(x, info, a.values, name);
  });
  const size = sizeOf(job);
  const d = computeDerived(p.derived, ax, fields, size);
  return { data: { axes: ax, fields: { ...fields, ...d.fields }, shifts: job.shifts.map((x, j) => ({ key: x.key, R: shifts[j] })), size }, errors: d.errors };
}

// The structure and interrogation of a point of the job (every axis but `skip` at its index).
export function pointOf(structure: Structure, sim: Interrogation, job: SweepJob, idx: number[], skip = -1) {
  return applyParams(structure, itOf(sim), job.axes.flatMap((a, i) => (i === skip ? [] : [[a.ref, a.values[idx[i]]] as [ParamRef, ParamValue]])));
}

// The context of the metrics on a curve along axis `along` (its indices on the others): its structure and the fixed λ
// or θ of the curve.
export function contextsOf(structure: Structure, sim: Interrogation, job: SweepJob, lib: Library, models: Models): (idx: number[], along: number) => MetricContext | undefined {
  const cache = new Map<string, Expanded & { it: Interrogation }>();
  return (idx, along) => {
    const k = `${along}:${idx.map((v, i) => (i === along ? '' : v)).join(',')}`;
    let c = cache.get(k);
    if (!c) {
      const r = pointOf(structure, sim, job, idx, along);
      c = { ...expand(r.structure, lib, models), it: r.it };
      cache.set(k, c);
    }
    if (c.errors.length) return undefined;
    const a = job.axes[along];
    const mode = a?.ref.kind === 'scan' ? a.ref.prop : scanAxisOf(sim);
    return metricContext(c, models, { ...c.it, mode });
  };
}

export type Simulated = { job: SweepJob; data: SweepData; groups: AnalysisGroup[]; errors: string };

// The computation of a structure with its interrogation, the metrics on it (scripts, the optimization).
export function simulateCore(structure: Structure, sim: SimSettings | Interrogation, metrics: Metric[], derived: Derived[], lib: Library, models: Models, swept: { id: string; ref: ParamRef; values: ParamValue[] }[] = [], params: Exposed[] = [], fields: FieldKey[] | 'all' = 'all', infos?: Map<string, ParamInfo>): Simulated {
  const job = jobOf(structure, sim, metrics, swept, fields);
  const n = sizeOf(job);
  const fs = Object.fromEntries(job.fields.map((f) => [f, new Float64Array(n).fill(NaN)])) as Record<FieldKey, Float64Array>;
  const sh = job.shifts.map(() => new Float64Array(n).fill(NaN));
  const blocks = runSweepChunk(job, lib, models, Array.from({ length: layout(job).outerCount }, (_, i) => i));
  blocks.forEach((b) => placeBlock(job, b, fs, sh));
  const { data, errors } = sweepDataOf({ params, derived }, job, fs, sh, infos ?? new Map(), lib);
  const groups = analyzeSweep(data, metrics, scanAxisOf(sim), contextsOf(structure, sim, job, lib, models));
  return { job, data, groups, errors: blocks.find((b) => b.error)?.error ?? (Object.values(errors)[0] || '') };
}

// The whole Simulation of a project at once (its sweep included).
export function simulate(p: Project, lib: Library, models: Models): Simulated {
  const infos = paramInfos(p, lib);
  const { axes } = sweptOf(p, infos);
  const swept = axes.map((x) => ({ id: x.id, ref: x.ref, values: sweepValues(x, infos.get(paramKey(x.ref))) }));
  return simulateCore(p.structure, p.sim, p.metrics, p.derived, lib, models, swept, p.params, axes.length ? p.sweep.fields : 'all', infos);
}

// The samples of the tolerances: each structure's response (the fields asked: computed ones and the computed
// quantities) and the values of its metrics, over one scan. (The metrics on the whole scan; the curves kept at most
// `maxPoints` points, evenly picked: the memory of hundreds of samples.)
export function toleranceRows(structures: Structure[], it: Interrogation, metrics: Metric[], derived: Derived[], fields: string[], lib: Library, models: Models, maxPoints = 2000): { xs: number[]; rows: { fields: Record<string, Float64Array>; values: (Record<string, number> | null)[]; error?: string }[] } {
  // every computed quantity (the computed quantities may use any); the GH shift and the phase slope when asked or used
  const keys = FIELDS.filter((f) => (f !== 'gh' && f !== 'dphiR') || fields.includes(f) || derived.some((d) => d.expr.includes(f)));
  let xs: number[] = [];
  const rows = structures.map((s) => {
    const ex = expand(s, lib, models);
    if (ex.errors.length) return { fields: {}, values: metrics.map(() => null), error: ex.errors[0] };
    const r = simulateCore(s, it, metrics, derived, lib, models, [], [], keys);
    const all = r.data.axes[r.data.axes.length - 1].values;
    const n = all.length;
    const pick = n > maxPoints ? Array.from({ length: maxPoints }, (_, i) => Math.round((i * (n - 1)) / (maxPoints - 1))) : null;
    xs = pick ? pick.map((i) => all[i]) : all;
    const out: Record<string, Float64Array> = {};
    for (const f of fields) {
      const v = r.data.fields[f];
      if (v) out[f] = pick ? Float64Array.from(pick, (i) => v[i]) : v;
    }
    // (an error of a computed quantity leaves the sample valid: its curve is missing)
    return { fields: out, values: metricValues(r.groups, metrics).map((x) => x?.values ?? null) };
  });
  return { xs, rows };
}

// The value of every metric for the objectives: its result on the first curve of its data (one scan: the only one; a
// map: the first θ — reduce the map with a metric of metrics for one value over all of it).
export const metricValues = (groups: AnalysisGroup[], metrics: Metric[]): (MetricResult | undefined)[] => metrics.map((m) => firstResult(groups, m));
