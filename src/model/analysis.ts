// Analysis of an interrogation scan: every computed quantity, the perturbed scans the sensitivity metrics need, the
// computed quantities (formulas), the metrics, and the field inside the stack. Pure: runs in the workers.
import { fieldProfile, profileGrid, type Complexes, type Component } from '../physics/field.ts';
import type { Models } from '../physics/materials.ts';
import { ghOfSlope, indexOf, linspace, phaseSlope, pointOf, POINT_KEYS, stackAt, type Perturb, type Pol, type PointKey } from './compute.ts';
import { computeDerived, type Derived } from './derived.ts';
import { evalMetrics, phaseShiftKey, shiftKey, usesPhaseShift, usesShift, type Metric, type MetricContext, type MetricResult, type SensTarget } from './metrics.ts';
import type { Expanded, MixPart } from './structure.ts';

export type { SensTarget } from './metrics.ts';

// mode: an angular scan (from … to in °), a spectral one (in nm), or a dispersion map: λ from … to and θ tFrom … tTo
export type Interrogation = { mode: 'theta' | 'lambda' | 'map'; lambda: number; theta: number; from: number; to: number; points: number; pol: Pol; tFrom?: number; tTo?: number; tPoints?: number };
// The interrogation part of the Simulation's settings.
export const interrogationOf = (s: Interrogation): Interrogation => ({ mode: s.mode, lambda: s.lambda, theta: s.theta, from: s.from, to: s.to, points: s.points, pol: s.pol, tFrom: s.tFrom, tTo: s.tTo, tPoints: s.tPoints });
// The axis a scan runs along (a map: λ, the curves at each θ).
export const scanAxisOf = (it: Pick<Interrogation, 'mode'>): 'theta' | 'lambda' => (it.mode === 'theta' ? 'theta' : 'lambda');

// The field at the position of a metric (its resonance / extremum / band centre), or at a given value of the scan.
export type FieldSettings = { on: boolean; at: 'metric' | 'value'; metric: string; value: number; zIn: number; zOut: number; show: string; part: 'abs2' | 'abs' | 're' | 'im'; medium: SensTarget };

export type Profile = {
  z: Float64Array;
  layer: Int32Array;
  E2: Float64Array;
  H2: Float64Array;
  absorption: Float64Array;
  comps: Record<Component, Complexes> | null; // (unpolarized: none)
  boundaries: number[];
  layerAbs: number[]; // fraction of the incident power absorbed in [incident, ...layers, exit] (exit: transmitted)
  decay: number; // 1/e depth of |E|² in the exit medium (nm), Infinity if it propagates
  at: number;
  lambda: number;
  theta: number;
};

// A perturbed scan: R with n + Δn of a target.
export type Shift = { key: string; target: SensTarget; dn: number; R: Float64Array };

export type Analysis = {
  xs: number[];
  curves: Record<string, Float64Array>; // R, T, A, phiR, phiT, rRe, rIm, tRe, tIm and the computed quantities
  derivedErrors: Record<string, string>;
  shifts: Shift[];
  metrics: MetricResult[]; // in the order of the metrics (off ones: empty)
  field?: Profile;
};

// Indices into [incident, ...layers, exit] of a sensitivity target.
export function targetIndices(e: Expanded, t: SensTarget): number[] {
  if (t.kind === 'incident') return [0];
  if (t.kind === 'exit') return [e.layers.length + 1];
  if (t.kind === 'cavity') return e.layers.flatMap((L, i) => (L.block === t.block && L.role === 'cavity' && L.index === t.index ? [i + 1] : []));
  return e.layers.flatMap((L, i) => (L.block === t.block ? [i + 1] : []));
}

// A change of the index of a target: its layers / media, and the parts of the rough slices made of them.
export function perturbOf(e: Expanded, t: SensTarget, dn: number): Perturb {
  const hit = (p: MixPart) =>
    t.kind === 'incident' ? p.medium === 'incident' : t.kind === 'exit' ? p.medium === 'exit' : t.kind === 'cavity' ? p.block === t.block && p.role === 'cavity' && p.index === t.index : !p.medium && p.block === t.block;
  return { targets: targetIndices(e, t), dn, hit };
}

// Every quantity over the interrogation, optionally with the index of a target changed by dn.
export function scanAll(e: Expanded, models: Models, it: Interrogation, xs: number[], perturb?: { target: SensTarget; dn: number }): Record<PointKey, Float64Array> {
  const p = perturb ? perturbOf(e, perturb.target, perturb.dn) : undefined;
  const out = Object.fromEntries(POINT_KEYS.map((k) => [k, new Float64Array(xs.length)])) as Record<PointKey, Float64Array>;
  const put = (i: number, r: Record<PointKey, number>) => POINT_KEYS.forEach((k) => (out[k][i] = r[k]));
  if (it.mode === 'theta') {
    const stack = stackAt(e, models, it.lambda, p);
    xs.forEach((th, i) => put(i, pointOf(stack, it.lambda, th, it.pol)));
  } else xs.forEach((lam, i) => put(i, pointOf(stackAt(e, models, lam, p), lam, it.theta, it.pol)));
  // the phase slope along the scan; the GH shift: along θ, or (spectral) dφ/dθ by a central difference (±1 m°)
  xs.forEach((_, i) => {
    out.dphiR[i] = phaseSlope(xs, out.phiR, i);
    if (it.mode === 'theta') out.gh[i] = ghOfSlope(out.dphiR[i]);
    else {
      const st = stackAt(e, models, xs[i], p);
      let d = pointOf(st, xs[i], it.theta + 1e-3, it.pol).phiR - pointOf(st, xs[i], it.theta - 1e-3, it.pol).phiR;
      d -= 360 * Math.round(d / 360);
      out.gh[i] = ghOfSlope(d / 2e-3);
    }
  });
  return out;
}

// The perturbed R of the metrics (one per target and Δn).
export function shiftsFor(e: Expanded, models: Models, it: Interrogation, xs: number[], metrics: Metric[]): Shift[] {
  const out = new Map<string, Shift>();
  for (const m of metrics) {
    if (!usesShift(m) || (out.has(shiftKey(m)) && (!usesPhaseShift(m) || out.has(phaseShiftKey(m))))) continue;
    const s = scanAll(e, models, it, xs, m);
    out.set(shiftKey(m), { key: shiftKey(m), target: m.target, dn: m.dn, R: s.R });
    if (usesPhaseShift(m)) out.set(phaseShiftKey(m), { key: phaseShiftKey(m), target: m.target, dn: m.dn, R: s.phiR });
  }
  return [...out.values()];
}

// The context of the metrics that need the structure: the incident index, the field's penetration depth.
export function metricContext(e: Expanded, models: Models, it: Interrogation): MetricContext {
  return {
    scan: scanAxisOf(it),
    lambda: it.lambda,
    theta: it.theta,
    np: (lam) => indexOf(e.incident, models, lam).re,
    depth: (x, target) => {
      if (!targetIndices(e, target).length) return null;
      const p = penetration(e, models, it, x, target);
      return { depth: p?.depth ?? NaN, peak: p?.peak ?? NaN, ...fieldStats(e, models, it, x, target) };
    },
  };
}

export const metricsOn = (xs: ArrayLike<number>, curves: Record<string, ArrayLike<number>> | ArrayLike<number>, shifts: { key: string; R: ArrayLike<number> }[], metrics: Metric[], spectral: boolean, at?: Record<string, number>, ctx?: MetricContext): MetricResult[] =>
  evalMetrics(metrics, xs, curves, shifts, spectral, at, ctx);

export function analyze(e: Expanded, models: Models, it: Interrogation, metrics: Metric[], field?: FieldSettings, derived: Derived[] = []): Analysis {
  const xs = linspace(it.from, it.to, it.points);
  const base = scanAll(e, models, it, xs);
  const d = computeDerived(derived, [{ id: scanAxisOf(it), label: '', unit: '', values: xs }], base, xs.length);
  const curves: Record<string, Float64Array> = { ...base, ...d.fields };
  const shifts = shiftsFor(e, models, it, xs, metrics);
  const results = metricsOn(xs, curves, shifts, metrics, it.mode !== 'theta', undefined, metricContext(e, models, it));
  const out: Analysis = { xs, curves, derivedErrors: d.errors, shifts, metrics: results };
  if (field?.on) {
    const k = metrics.findIndex((m) => m.id === field.metric);
    const at = field.at === 'metric' ? (results[k]?.marks.x ?? NaN) : field.value;
    if (Number.isFinite(at)) out.field = profileAt(e, models, it, at, field.zIn, field.zOut);
  }
  return out;
}

// The field through the stack at one point of the interrogation (unpolarized: the mean |E|², |H|², absorption of s and
// p, no components).
export function profileAt(e: Expanded, models: Models, it: Pick<Interrogation, 'mode' | 'lambda' | 'theta' | 'pol'>, at: number, zIn: number, zOut: number, points = 3000): Profile {
  const [lambda, theta] = it.mode === 'theta' ? [it.lambda, at] : [at, it.theta];
  const stack = stackAt(e, models, lambda);
  const g = profileGrid(stack.map((L) => L.d), zIn, zOut, points);
  const pols = it.pol === 'u' ? (['s', 'p'] as const) : [it.pol];
  const ps = pols.map((p) => fieldProfile(stack, lambda, theta, p, g.z, g.layer));
  const mean = (f: (q: (typeof ps)[number]) => Float64Array) => (ps.length > 1 ? f(ps[0]).map((v, i) => (v + f(ps[1])[i]) / 2) : f(ps[0]));
  return {
    z: ps[0].z,
    layer: ps[0].layer,
    E2: mean((q) => q.E2),
    H2: mean((q) => q.H2),
    absorption: mean((q) => q.absorption),
    comps: ps.length > 1 ? null : ps[0].fields,
    boundaries: ps[0].boundaries,
    layerAbs: ps[0].layerAbs.map((v, j) => (ps.length > 1 ? (v + ps[1].layerAbs[j]) / 2 : v)),
    decay: Math.min(...ps.map((q) => q.decay)),
    at,
    lambda,
    theta,
  };
}

// The largest |E|² in the layers and the fraction of the incident power absorbed in a medium / block (the exit
// medium: the transmitted fraction), at a point of the interrogation.
export function fieldStats(e: Expanded, models: Models, it: Pick<Interrogation, 'mode' | 'lambda' | 'theta' | 'pol'>, at: number, target: SensTarget): { E2max: number; absorbed: number } {
  const total = e.layers.reduce((s, L) => s + L.d, 0);
  const p = profileAt(e, models, it, at, 0, 0, Math.max(2000, Math.round(total / 0.5)));
  let E2max = 0;
  for (let i = 0; i < p.E2.length; i++) if (p.layer[i] >= 1 && p.layer[i] <= e.layers.length && p.E2[i] > E2max) E2max = p.E2[i];
  if (!e.layers.length) E2max = p.E2[0];
  const absorbed = targetIndices(e, target).reduce((s, j) => s + (p.layerAbs[j] ?? 0), 0);
  return { E2max, absorbed };
}

// The 1/e depth of |E|² into a medium from its first interface (the side the light reaches first), at a point of the
// interrogation: the exit medium analytically (evanescent wave), a layer / block or the incident medium on the profile.
export function penetration(e: Expanded, models: Models, it: Pick<Interrogation, 'mode' | 'lambda' | 'theta' | 'pol'>, at: number, target: SensTarget): { depth: number; peak: number } | null {
  const idx = targetIndices(e, target);
  if (!idx.length) return null;
  const total = e.layers.reduce((s, L) => s + L.d, 0);
  if (target.kind === 'exit') {
    const p = profileAt(e, models, it, at, 0, 1, 400);
    const k = p.z.findIndex((_, i) => p.layer[i] === e.layers.length + 1);
    return Number.isFinite(p.decay) ? { depth: p.decay, peak: k >= 0 ? p.E2[k] : NaN } : null;
  }
  // a region of the stack: from its first sample, the first fall below 1/e of the value there
  const zIn = target.kind === 'incident' ? 2000 : 0;
  const p = profileAt(e, models, it, at, zIn, 0, Math.max(3000, Math.round(total / 0.5)));
  const inRegion = (i: number) => idx.includes(p.layer[i]);
  // the incident medium: from the first interface backwards (decreasing z)
  const order = Array.from(p.z, (_, i) => i).filter(inRegion);
  if (target.kind === 'incident') order.reverse();
  if (order.length < 2) return null;
  const z0 = p.z[order[0]];
  const peak = p.E2[order[0]];
  for (const i of order) if (p.E2[i] <= peak / Math.E) return { depth: Math.abs(p.z[i] - z0), peak };
  return null;
}
