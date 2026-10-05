// Analyses of the computed data (one scan, a dispersion map, or a sweep over any number of parameters): every metric
// computed along its axis (the scanned λ or θ by default; any numeric axis) on every curve of the other axes, from
// every computed quantity; its ROI may follow one of them (zone points or a polygon drawn on a map). The results are
// datasets over the other axes, one field per quantity (ref.quantity), plotted like the response — and analysed again:
// a metric whose source is such a dataset ('metrics:<axis>') runs along one of its axes (e.g. the fit of two resonance
// positions vs a swept thickness with the coupled-oscillator dispersion, the maximum of S vs a thickness).
import type { Axis, Dataset } from '../engine/types.ts';
import { evalMetrics, quantitiesOf, type Metric, type MetricContext, type MetricResult } from './metrics.ts';

export type SweepData = {
  axes: Axis[]; // ids: the exposed parameter ids, then the scanned quantities ('theta', 'lambda')
  fields: Record<string, Float64Array>;
  shifts: { key: string; R: Float64Array }[];
  size: number;
};

export type AnalysisGroup = {
  key: string; // the dataset key: 'metrics:<along>' (on the response) or '<source>/<along>' (on metrics)
  source: string; // 'response' or the key of the analysed group
  along: string;
  alongIndex: number; // in the axes of the analysed data
  axes: Axis[]; // the analysed data's axes
  other: number[]; // indices of the other axes
  metrics: Metric[];
  results: MetricResult[][]; // [curve][metric]
  dataset: Dataset; // over the other axes
};

export const strides = (sizes: number[]) => sizes.map((_, i) => sizes.slice(i + 1).reduce((p, n) => p * n, 1));

// The curve along axis `a` at the indices `idx` of the other axes (idx[a] ignored).
export function curveOf(arr: Float64Array, sizes: number[], a: number, idx: number[]): Float64Array {
  const st = strides(sizes);
  const base = idx.reduce((s, v, i) => (i === a ? s : s + v * st[i]), 0);
  const out = new Float64Array(sizes[a]);
  for (let i = 0; i < sizes[a]; i++) out[i] = arr[base + i * st[a]];
  return out;
}

// Per-axis indices of the curve k among the curves along axis `a` (row-major over the other axes).
export function curveIndices(sizes: number[], a: number, k: number): number[] {
  const idx = sizes.map(() => 0);
  for (let i = sizes.length - 1; i >= 0; i--) {
    if (i === a) continue;
    idx[i] = k % sizes[i];
    k = Math.floor(k / sizes[i]);
  }
  return idx;
}

// The flat index of a curve among the curves along `a` (inverse of curveIndices).
export const curveNumber = (sizes: number[], a: number, idx: number[]) => sizes.reduce((k, n, i) => (i === a ? k : k * n + idx[i]), 0);

export const isResponse = (m: Metric) => !m.source || m.source === 'response';

// The metrics of one source grouped by the axis they run along, computed on every curve.
function analyzeSource(data: SweepData, metrics: Metric[], source: string, defaultAlong: string, ctxFor?: (idx: number[], along: number) => MetricContext | undefined, branchesNm = false): AnalysisGroup[] {
  const groups = new Map<string, Metric[]>();
  for (const m of metrics) {
    const along = m.along && data.axes.some((x) => x.id === m.along) ? m.along : defaultAlong;
    if (data.axes.some((x) => x.id === along)) groups.set(along, [...(groups.get(along) ?? []), m]);
  }
  const sizes = data.axes.map((x) => x.values.length);
  const out: AnalysisGroup[] = [];
  for (const [along, ms] of groups) {
    const a = data.axes.findIndex((x) => x.id === along);
    const other = sizes.map((_, i) => i).filter((i) => i !== a);
    const count = other.reduce((p, i) => p * sizes[i], 1);
    const xs = data.axes[a].values;
    const spectral = along === 'lambda';
    const results: MetricResult[][] = [];
    for (let k = 0; k < count; k++) {
      const idx = curveIndices(sizes, a, k);
      const curves = Object.fromEntries(Object.entries(data.fields).map(([f, arr]) => [f, curveOf(arr, sizes, a, idx)]));
      const shifts = data.shifts.map((s) => ({ key: s.key, R: curveOf(s.R, sizes, a, idx) }));
      const at = Object.fromEntries(other.map((i) => [data.axes[i].id, data.axes[i].values[idx[i]]]));
      const ctx = ctxFor?.(idx, a) ?? (branchesNm ? ({ branchesNm: true } as MetricContext) : undefined);
      results.push(evalMetrics(ms, xs, curves, shifts, spectral, at, ctx));
    }
    const fields: Record<string, Float64Array> = {};
    const meta: Dataset['meta'] = [];
    ms.forEach((m, j) => {
      if (!m.on) return;
      for (const q of quantitiesOf(m, spectral)) {
        const key = `${m.ref}.${q.key}`;
        fields[key] = Float64Array.from(results, (r) => r[j].values[q.key] ?? NaN);
        meta.push({ key, label: `${m.label}: ${q.label}`, short: key, unit: q.unit(data.axes[a].unit) });
      }
    });
    const key = source === 'response' ? `metrics:${along}` : `${source}/${along}`;
    out.push({ key, source, along, alongIndex: a, axes: data.axes, other, metrics: ms, results, dataset: { key, axes: other.map((i) => data.axes[i]), fields, meta, size: count } });
  }
  return out;
}

// Every metric: those on the response (by default along the scanned quantity `scanAxis`), then those on the values of
// other metrics (their source: a group's key; by default along the first axis of its dataset).
// ctxFor: the context of a response curve (its structure: the incident index, the field), from its indices.
export function analyzeSweep(data: SweepData, metrics: Metric[], scanAxis: string, ctxFor?: (idx: number[], along: number) => MetricContext | undefined): AnalysisGroup[] {
  const out = analyzeSource(data, metrics.filter(isResponse), 'response', scanAxis, ctxFor);
  for (const g of [...out]) {
    const ms = metrics.filter((m) => m.source === g.key);
    if (!ms.length) continue;
    const ds = g.dataset;
    if (!ds.axes.length) continue; // one value per quantity: nothing to run along
    const sub: SweepData = { axes: ds.axes, fields: ds.fields as Record<string, Float64Array>, shifts: [], size: ds.size };
    out.push(...analyzeSource(sub, ms, g.key, ds.axes[0].id, undefined, g.along === 'lambda'));
  }
  return out;
}

// The group a metric is computed in, and its result on the first curve (one scan: the only one).
export function groupOf(groups: AnalysisGroup[], m: Metric) {
  return groups.find((g) => g.metrics.some((x) => x.id === m.id));
}
export function firstResult(groups: AnalysisGroup[], m: Metric): MetricResult | undefined {
  const g = groupOf(groups, m);
  return g?.results[0]?.[g.metrics.findIndex((x) => x.id === m.id)];
}

// The axis a metric runs along in the data (for its unit), given its group.
export const alongAxisOf = (groups: AnalysisGroup[], m: Metric): Axis | undefined => {
  const g = groupOf(groups, m);
  return g ? g.axes[g.alongIndex] : undefined;
};

// The name of a data source in the menus.
export const sourceLabel = (g: AnalysisGroup, groups: AnalysisGroup[]) => {
  const along = g.axes[g.alongIndex]?.label ?? g.along;
  if (g.source === 'response') return `the metrics (along ${along})`;
  const base = groups.find((x) => x.key === g.source);
  return `metrics of the metrics along ${base?.axes[base.alongIndex]?.label ?? '?'} (along ${along})`;
};