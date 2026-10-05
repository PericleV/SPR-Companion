// Objective functions: reductions of a curve to a cost (lower is better).
// polarization slice of a zone: s, p, their mean, or every curve separately
export type SpecPol = 's' | 'p' | 'avg' | 'all';

// ∫ y dx over [lo, hi] (trapezoid, linear interpolation at the ends); xs ascending.
export function integrate(xs: ArrayLike<number>, ys: ArrayLike<number>, lo: number, hi: number): { area: number; width: number } {
  const n = xs.length;
  const a = Math.max(lo, xs[0]);
  const b = Math.min(hi, xs[n - 1]);
  if (!(b > a)) return { area: 0, width: 0 };
  const yAt = (x: number) => {
    let i = 1;
    while (i < n - 1 && xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  };
  let area = 0;
  let px = a;
  let py = yAt(a);
  for (let i = 0; i < n; i++) {
    if (xs[i] <= a) continue;
    if (xs[i] >= b) break;
    area += ((py + ys[i]) / 2) * (xs[i] - px);
    [px, py] = [xs[i], ys[i]];
  }
  area += ((py + yAt(b)) / 2) * (b - px);
  return { area, width: b - a };
}

// Smooth minimum (or maximum) of the samples inside [lo, hi]: −τ·log(mean(exp(−y/τ))).
export function softExtreme(xs: ArrayLike<number>, ys: ArrayLike<number>, lo: number, hi: number, kind: 'min' | 'max', tau: number): number {
  const s = kind === 'min' ? 1 : -1;
  const vals: number[] = [];
  for (let i = 0; i < xs.length; i++) if (xs[i] >= lo && xs[i] <= hi) vals.push(s * ys[i]);
  if (!vals.length) return NaN;
  const m = Math.min(...vals);
  const mean = vals.reduce((acc, v) => acc + Math.exp(-(v - m) / tau), 0) / vals.length;
  return s * (m - tau * Math.log(mean));
}

export type ZoneGoal = 'max' | 'min' | 'target' | 'ge' | 'le';
// A zone: a band where a quantity (a field, or OD) should be maximized / minimized / equal to / ≥ / ≤ `target`,
// optionally in a slice of the data (polarization, angle; the node's default otherwise).
export type Zone = { lo: number; hi: number; field: string; goal: ZoneGoal; target: number; weight: number; pol?: SpecPol; angle?: number };
export type ZoneReduce = 'mean' | 'worst' | 'contrast';
export type Outside = 'ignore' | 'min' | 'max';

// Value of a zone on one curve: the mean over the band (integral / width), or for the worst-point reduction the
// soft-minimum (goals max, ≥) / soft-maximum (min, ≤) of the samples in the band.
export function zoneLineValue(xs: ArrayLike<number>, ys: ArrayLike<number>, z: Zone, reduce: ZoneReduce, tau: number): number {
  if (reduce === 'worst' && z.goal !== 'target') return softExtreme(xs, ys, z.lo, z.hi, z.goal === 'max' || z.goal === 'ge' ? 'min' : 'max', tau);
  const { area, width } = integrate(xs, ys, z.lo, z.hi);
  return width > 0 ? area / width : NaN;
}

// Cost of a zone value (before its weight): maximize → −v, minimize → v, target → (v − t)², ≥ / ≤ t → the squared
// violation (0 when met).
export function zoneCost(goal: ZoneGoal, v: number, t: number): number {
  switch (goal) {
    case 'max':
      return -v;
    case 'min':
      return v;
    case 'target':
      return (v - t) ** 2;
    case 'ge':
      return Math.min(0, v - t) ** 2;
    case 'le':
      return Math.max(0, v - t) ** 2;
  }
}

// Mean of a curve outside every zone: the whole-axis integral minus the zones, per unit length.
export function outsideLineValue(xs: ArrayLike<number>, ys: ArrayLike<number>, zones: Zone[]): number {
  const all = integrate(xs, ys, -Infinity, Infinity);
  let area = all.area;
  let width = all.width;
  for (const z of zones) {
    const part = integrate(xs, ys, z.lo, z.hi);
    area -= part.area;
    width -= part.width;
  }
  return width > 1e-12 ? area / width : NaN;
}

export type ZonesResult = { cost: number; zoneValues: number[]; outsideValue: number };

// Cost of the zones. Each zone has its own curves (its slice of the data: `lines[i]`), the region outside the zones
// the curves `outLines`; costs are averaged over the curves of each zone. The contrast reduction (mean in the
// maximized zones over the mean outside) is taken curve by curve when every zone has the same curves, else on the means.
export function zonesCost(
  xs: ArrayLike<number>,
  zones: Zone[],
  lines: ArrayLike<number>[][],
  outLines: ArrayLike<number>[],
  reduce: ZoneReduce,
  outside: Outside,
  outsideWeight: number,
  tau = 0.02,
): ZonesResult {
  const vals = zones.map((z, i) => lines[i].map((ys) => zoneLineValue(xs, ys, z, reduce, tau)));
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  const zoneValues = vals.map(mean);
  const useOut = outside !== 'ignore' || reduce === 'contrast';
  const outVals = useOut ? outLines.map((ys) => outsideLineValue(xs, ys, zones)) : [];
  const outsideValue = useOut ? mean(outVals) : NaN;
  let cost = 0;
  if (reduce === 'contrast') {
    const maxZones = zones.flatMap((z, i) => (z.goal === 'max' ? [i] : []));
    const w = maxZones.reduce((s, i) => s + zones[i].weight, 0) || 1;
    const ratio = (inside: number, out: number) => -inside / ((Number.isFinite(out) ? out : 0) + 0.01);
    const n = outVals.length;
    if (n && maxZones.every((i) => vals[i].length === n)) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += ratio(maxZones.reduce((s, i) => s + zones[i].weight * vals[i][k], 0) / w, outVals[k]);
      cost = acc / n;
    } else cost = ratio(maxZones.reduce((s, i) => s + zones[i].weight * zoneValues[i], 0) / w, outsideValue);
    zones.forEach((z, i) => {
      if (z.goal !== 'max') cost += z.weight * mean(vals[i].map((v) => zoneCost(z.goal, v, z.target)));
    });
  } else {
    zones.forEach((z, i) => (cost += z.weight * mean(vals[i].map((v) => zoneCost(z.goal, v, z.target)))));
    if (outside !== 'ignore') {
      const oc = mean(outVals.filter(Number.isFinite).map((v) => (outside === 'min' ? v : -v)));
      if (Number.isFinite(oc)) cost += outsideWeight * oc;
    }
  }
  return { cost, zoneValues, outsideValue };
}

export type MetricStat = 'mean' | 'min' | 'max' | 'rms';
export type FormulaStat = MetricStat | 'at' | 'fge' | 'fle';
export type MetricGoal = 'min' | 'max' | 'target' | 'le' | 'ge';

export const statOf = (vals: number[], stat: MetricStat) => {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return NaN;
  if (stat === 'min') return Math.min(...v);
  if (stat === 'max') return Math.max(...v);
  if (stat === 'rms') return Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
  return v.reduce((s, x) => s + x, 0) / v.length;
};

// Statistic of a Custom objective term: the metric statistics, the mean of the values at a point ('at': one value per
// curve), or the fraction of the values ≥ / ≤ level (a logistic step of width `soft` when soft > 0, differentiable).
export function formulaStat(vals: number[], stat: FormulaStat, level = 0, soft = 0): number {
  if (stat === 'at') return statOf(vals, 'mean');
  if (stat === 'fge' || stat === 'fle') {
    const v = vals.filter(Number.isFinite);
    if (!v.length) return NaN;
    const s = stat === 'fge' ? 1 : -1;
    const step = (x: number) => (soft > 0 ? 1 / (1 + Math.exp((-s * (x - level)) / soft)) : s * (x - level) >= 0 ? 1 : 0);
    return v.reduce((a, x) => a + step(x), 0) / v.length;
  }
  return statOf(vals, stat);
}

// Cost of a scalar: constraints (≤, ≥) are quadratic penalties, zero when satisfied.
export function metricCost(value: number, goal: MetricGoal, target: number, scale: number): number {
  const s = scale > 0 ? scale : 1;
  switch (goal) {
    case 'min':
      return value / s;
    case 'max':
      return -value / s;
    case 'target':
      return ((value - target) / s) ** 2;
    case 'le':
      return value > target ? 100 * ((value - target) / s) ** 2 : 0;
    case 'ge':
      return value < target ? 100 * ((target - value) / s) ** 2 : 0;
  }
}
