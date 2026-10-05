// The computation of the Simulation page: the interrogation scan (λ or θ), for every combination of any number of
// swept (exposed) parameters. The result is a dataset over all the axes (row-major, the last axis fastest; the scanned
// quantity last) with every computed quantity and the perturbed R of the sensitivity metrics. The structural parameters
// make the outer combinations (split between workers; each structure expanded once); λ and θ are inner loops.
import type { Library } from '../physics/library.ts';
import type { Models } from '../physics/materials.ts';
import { ghOfSlope, phaseSlope, pointOf, POINT_KEYS, stackAt, type Pol, type PointKey } from './compute.ts';
import { perturbOf, targetIndices, type FieldSettings } from './analysis.ts';
import type { SensTarget } from './metrics.ts';
import { applyParams, type ParamRef, type ParamValue } from './params.ts';
import { expand, type Structure } from './structure.ts';

export const FIELDS = POINT_KEYS;
export type FieldKey = PointKey;

export type Lim = [number, number]; // NaN bound = automatic
// A plot: X an axis; curves (one per value of `series`, or the chosen slice) with fields on the left and right Y axes,
// or a map over (X, Y) coloured by a field; every other axis at a chosen index. Source: the response (and the computed
// quantities), or the metrics computed along an axis (a group's key: 'metrics:<axis>', '<source>/<axis>').
export type PlotSpec = {
  id: string;
  title?: string; // its name
  source: string;
  x: string;
  mode: 'curves' | 'map';
  y: string;
  left: string[];
  right: string[];
  color: string; // the map's field
  series: string;
  slices: Record<string, number>;
  marks: boolean; // the overlays of the metrics, all on / off
  hidden?: string[]; // the overlays not drawn: a metric id, or 'id:part'
  lim: { x?: Lim; y?: Lim; y2?: Lim; z?: Lim };
  field?: FieldSettings; // source 'field': the field inside the stack at a point of the scan
  curves?: CompareCurve[]; // source 'compare': curves of any configuration (X: the axis `x`)
  config?: string; // a view of the Compare page: the configuration it shows
  // a swept seed of a rough profile (an axis of realizations): one at a time, all of them, their mean or median
  seedStat?: 'one' | 'all' | 'mean' | 'median';
};

// A curve of a compare plot: a quantity of a configuration's data (its response, or its metrics' values along an
// axis) along the plot's X; its other axes at chosen indices; on the left or the right Y axis; with that
// configuration's metrics drawn over it (marks).
// (hidden: the overlays not drawn, as on a plot: a metric id, or 'id:part')
export type CompareCurve = { id: string; config: string; source: string; y: string; side: 'left' | 'right'; color: string; at: Record<string, number>; marks?: boolean; hidden?: string[] };

// axes: ids of the swept exposed parameters (the scanned quantity is always the last axis); fields: kept besides R
export type SweepSettings = { axes: string[]; fields: FieldKey[]; plots: PlotSpec[] };

export const MAX_POINTS = 6_000_000;

export type SweepJob = {
  structure: Structure;
  base: { lambda: number; theta: number; pol: Pol };
  axes: { id: string; ref: ParamRef; values: ParamValue[] }[];
  fields: FieldKey[];
  // the perturbed scans of the sensitivities: R with n + Δn (phase: the phase of r with n + Δn, for the phase and GH metrics)
  shifts: { key: string; target: SensTarget; dn: number; phase?: boolean }[];
};

export const sizeOf = (job: Pick<SweepJob, 'axes'>) => job.axes.reduce((p, a) => p * a.values.length, 1);
const isScan = (r: ParamRef, prop: 'lambda' | 'theta') => r.kind === 'scan' && r.prop === prop;

// Outer (structural) axes and their number of combinations; the λ and θ axes (absent = the base value).
export function layout(job: Pick<SweepJob, 'axes'>) {
  const outer = job.axes.map((_, i) => i).filter((i) => job.axes[i].ref.kind !== 'scan');
  const iL = job.axes.findIndex((a) => isScan(a.ref, 'lambda'));
  const iT = job.axes.findIndex((a) => isScan(a.ref, 'theta'));
  const outerCount = outer.reduce((p, i) => p * job.axes[i].values.length, 1);
  return { outer, iL, iT, outerCount };
}

// Per-axis indices of a flat index (row-major: the last axis fastest).
export function indicesOf(sizes: number[], k: number): number[] {
  const out = new Array<number>(sizes.length);
  for (let i = sizes.length - 1; i >= 0; i--) {
    out[i] = k % sizes[i];
    k = Math.floor(k / sizes[i]);
  }
  return out;
}

// One block per outer combination: every field (and perturbed R) over λ × θ (λ-major).
export type SweepBlock = { outer: number; fields: Partial<Record<FieldKey, Float64Array>>; shifts: Float64Array[]; error?: string };

export function runSweepChunk(job: SweepJob, lib: Library, models: Models, outers: number[]): SweepBlock[] {
  const { outer, iL, iT } = layout(job);
  const lambdas = iL >= 0 ? (job.axes[iL].values as number[]) : [job.base.lambda];
  const thetas = iT >= 0 ? (job.axes[iT].values as number[]) : [job.base.theta];
  const n = lambdas.length * thetas.length;
  const out: SweepBlock[] = [];
  for (const o of outers) {
    const oi = indicesOf(outer.map((i) => job.axes[i].values.length), o);
    const { structure } = applyParams(job.structure, { mode: 'theta', lambda: 0, theta: 0, from: 0, to: 0, points: 1, pol: job.base.pol }, outer.map((ax, j) => [job.axes[ax].ref, job.axes[ax].values[oi[j]]]));
    const ex = expand(structure, lib, models);
    const fields: Partial<Record<FieldKey, Float64Array>> = {};
    for (const f of job.fields) fields[f] = new Float64Array(n).fill(NaN);
    const shifts = job.shifts.map(() => new Float64Array(n).fill(NaN));
    if (!ex.errors.length) {
      const targets = job.shifts.map((s) => targetIndices(ex, s.target));
      // the phase slope and the GH shift: along θ when it is scanned, else dφ/dθ by a central difference (±1 m°)
      const wantSlope = job.fields.includes('dphiR') || job.fields.includes('gh');
      const phi = wantSlope ? new Float64Array(n) : null;
      const ghFd = wantSlope && thetas.length < 3 ? new Float64Array(n) : null;
      const H = 1e-3;
      lambdas.forEach((lam, a) => {
        const stack = stackAt(ex, models, lam);
        // (one perturbed stack per target and Δn: the R and the phase entries share it)
        const memo = new Map<string, ReturnType<typeof stackAt>>();
        const pert = job.shifts.map((s, j) => {
          const key = `${JSON.stringify(s.target)}|${s.dn}`;
          if (!memo.has(key)) memo.set(key, stackAt(ex, models, lam, { ...perturbOf(ex, s.target, s.dn), targets: targets[j] }));
          return memo.get(key)!;
        });
        thetas.forEach((th, b) => {
          const k = a * thetas.length + b;
          const r = pointOf(stack, lam, th, job.base.pol);
          for (const f of job.fields) fields[f]![k] = r[f];
          if (phi) phi[k] = r.phiR;
          if (ghFd) {
            let d = pointOf(stack, lam, th + H, job.base.pol).phiR - pointOf(stack, lam, th - H, job.base.pol).phiR;
            d -= 360 * Math.round(d / 360);
            ghFd[k] = ghOfSlope(d / (2 * H));
          }
          pert.forEach((st, j) => {
            const q = pointOf(st, lam, th, job.base.pol);
            shifts[j][k] = job.shifts[j].phase ? q.phiR : q.R;
          });
        });
      });
      if (phi) {
        const nT = thetas.length;
        // (a spectral scan: the phase of each column along λ, once)
        const cols = nT >= 3 || lambdas.length < 3 ? [] : Array.from({ length: nT }, (_, b) => Array.from({ length: lambdas.length }, (_, i) => phi[i * nT + b]));
        for (let a = 0; a < lambdas.length; a++)
          for (let b = 0; b < nT; b++) {
            const k = a * nT + b;
            // along θ (the scan, or the θ axis of a map); a spectral scan: the slope along λ, GH by the difference
            const slope = nT >= 3 ? phaseSlope(thetas, phi.subarray(a * nT, a * nT + nT), b) : cols.length ? phaseSlope(lambdas, cols[b], a) : NaN;
            if (fields.dphiR) fields.dphiR[k] = slope;
            if (fields.gh) fields.gh[k] = ghFd ? ghFd[k] : ghOfSlope(slope);
          }
      }
    }
    out.push({ outer: o, fields, shifts, ...(ex.errors.length ? { error: ex.errors[0] } : {}) });
  }
  return out;
}

// Places a block into the full arrays (row-major over all the axes).
export function placeBlock(job: Pick<SweepJob, 'axes'>, b: SweepBlock, full: Partial<Record<FieldKey, Float64Array>>, shifts: Float64Array[]) {
  const { outer, iL, iT } = layout(job);
  const sizes = job.axes.map((a) => a.values.length);
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((p, n) => p * n, 1));
  const oi = indicesOf(outer.map((i) => sizes[i]), b.outer);
  const base = outer.reduce((s, ax, j) => s + oi[j] * strides[ax], 0);
  const nT = iT >= 0 ? sizes[iT] : 1;
  const nL = iL >= 0 ? sizes[iL] : 1;
  for (let a = 0; a < nL; a++)
    for (let c = 0; c < nT; c++) {
      const k = base + (iL >= 0 ? a * strides[iL] : 0) + (iT >= 0 ? c * strides[iT] : 0);
      const src = a * nT + c;
      for (const [f, arr] of Object.entries(b.fields)) full[f as FieldKey]![k] = arr![src];
      b.shifts.forEach((arr, j) => (shifts[j][k] = arr[src]));
    }
}

let plotCounter = 0;
export const newPlot = (over: Partial<PlotSpec>): PlotSpec => ({ id: `pl${Date.now().toString(36)}${plotCounter++}`, source: 'response', x: '', mode: 'curves', y: '', left: ['R'], right: [], color: 'R', series: '', slices: {}, marks: true, lim: {}, ...over });

const CURVE_COLORS = ['#2563eb', '#e07b39', '#7b5bd6', '#d9534f', '#4e79a7', '#e0a000', '#9c755f', '#b07aa1'];
let curveCounter = 0;
// A curve of a compare plot (the n-th: its colour).
export const newCurve = (config: string, over: Partial<CompareCurve> = {}, n = 0): CompareCurve => ({ id: `cv${Date.now().toString(36)}${curveCounter++}`, config, source: 'response', y: 'R', side: 'left', color: CURVE_COLORS[n % CURVE_COLORS.length], at: {}, ...over });
