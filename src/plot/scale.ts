import type { Axis } from '../engine/types.ts';

export type Tick = { v: number; text: string };

export function niceTicks(lo: number, hi: number, count = 6): Tick[] {
  if (!(hi > lo)) return [{ v: lo, text: fmt(lo, 1) }];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out: Tick[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push({ v, text: fmt(v, step) });
  return out;
}

const fmt = (v: number, step: number) => {
  const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  const s = v.toFixed(dec);
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
};

// Ticks for an axis: category labels when present, numeric otherwise.
export function axisTicks(a: Axis, lo: number, hi: number, count = 6): Tick[] {
  if (!a.labels) return niceTicks(lo, hi, count);
  const every = Math.max(1, Math.ceil(a.labels.length / count));
  return a.labels.flatMap((text, i) => (i % every === 0 && i >= lo - 1e-9 && i <= hi + 1e-9 ? [{ v: i, text }] : []));
}

// Index of the value nearest to v in an ascending array.
export function nearest(xs: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[hi] - v) < Math.abs(xs[lo] - v) ? hi : lo;
}

// Manual axis limits over the automatic range: each finite bound replaces the automatic one (NaN = automatic);
// ignored when they do not leave a positive span.
export function applyLim(auto: [number, number], lim?: [number, number]): [number, number] {
  if (!lim) return auto;
  const lo = Number.isFinite(lim[0]) ? lim[0] : auto[0];
  const hi = Number.isFinite(lim[1]) ? lim[1] : auto[1];
  return hi > lo ? [lo, hi] : auto;
}
