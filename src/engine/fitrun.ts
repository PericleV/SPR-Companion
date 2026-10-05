// Runs fits of the spectral components or of the coupled-oscillator dispersion.
import { branches, COMPONENTS, dispersionParams, values, type FitComponent, type FitParam, type ModelCtx, type ParamKind } from './fitmodels.ts';
import { levenbergMarquardt } from './lm.ts';

export type FitStats = { r2: number; rmse: number; points: number; iterations: number; sigma: Record<string, number> };

// Widths and Fano amplitudes are positive, brightness ratios non-negative.
const constrainKind = (kind: ParamKind, v: number) =>
  kind === 'width' ? Math.max(Math.abs(v), 1e-9) : kind === 'index' ? Math.max(Math.abs(v), 1.001) : kind === 'ratio' ? Math.max(v, 0) : kind === 'positive' ? Math.abs(v) : v;

export function stats(res: Float64Array, ys: ArrayLike<number>, iterations: number, sigma: Record<string, number>): FitStats {
  let mean = 0;
  for (let i = 0; i < ys.length; i++) mean += ys[i];
  mean /= ys.length;
  let sst = 0;
  for (let i = 0; i < ys.length; i++) sst += (ys[i] - mean) ** 2;
  const ssr = res.reduce((s, v) => s + v * v, 0);
  return { r2: 1 - ssr / sst, rmse: Math.sqrt(ssr / res.length), points: res.length, iterations, sigma };
}

export const paramId = (compId: string, key: string) => `${compId}.${key}`;

// Least-squares fit of the free component parameters to (xs, ys). A coupled-oscillator component has many local
// minima (the splitting and the width of a dark mode can be anything): several starts of Ω and of Γ₂ are tried and
// the best fit is kept.
export function fitSpectrum(comps: FitComponent[], xs: ArrayLike<number>, ys: ArrayLike<number>, ctx: ModelCtx) {
  const co = comps.findIndex((k) => k.type === 'coupled');
  if (co < 0) return fitOnce(comps, xs, ys, ctx);
  const k = comps[co];
  const W0 = Math.abs(k.params.W.value) || 1;
  const w20 = Math.abs(k.params.w2.value) || 0.1;
  const Ws = k.params.W.fixed ? [W0] : [W0, W0 / 4, W0 * 2.5, W0 * 6, W0 / 12];
  const w2s = k.params.w2.fixed ? [w20] : [w20, w20 * 10];
  // the start as given first: when it fits well already, the other starts are skipped; else every start a few
  // iterations, the best one then to convergence
  const first = fitOnce(comps, xs, ys, ctx, 40);
  let best: ReturnType<typeof fitOnce> = first;
  if (first.stats.r2 > 0.99) return fitOnce(first.comps, xs, ys, ctx);
  for (const W of Ws)
    for (const w2 of w2s) {
      if (W === W0 && w2 === w20) continue;
      const start = comps.map((c, i) => (i === co ? { ...c, params: { ...c.params, W: { ...c.params.W, value: W }, w2: { ...c.params.w2, value: w2 } } } : c));
      const r = fitOnce(start, xs, ys, ctx, 40);
      if (r.stats.rmse < best.stats.rmse) best = r;
    }
  return fitOnce(best.comps, xs, ys, ctx);
}

function fitOnce(comps: FitComponent[], xs: ArrayLike<number>, ys: ArrayLike<number>, ctx: ModelCtx, maxIter = 300) {
  const free = comps.flatMap((k, ci) =>
    COMPONENTS[k.type].params.filter((d) => !k.params[d.key].fixed).map((d) => ({ ci, key: d.key, kind: d.kind })),
  );
  const apply = (p: number[]) => {
    const next = comps.map((k) => ({ ...k, params: { ...k.params } }));
    free.forEach((f, i) => (next[f.ci].params[f.key] = { ...next[f.ci].params[f.key], value: p[i] }));
    return next;
  };
  // the parameter objects are built once per residual, not once per point
  const residual = (p: number[]) => {
    const m = apply(p).map((k) => ({ f: COMPONENTS[k.type].f, v: values(k) }));
    const r = new Float64Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      let y = 0;
      for (const c of m) y += c.f(xs[i], c.v, ctx);
      r[i] = y - ys[i];
    }
    return r;
  };
  const p0 = free.map((f) => comps[f.ci].params[f.key].value);
  const res = levenbergMarquardt(residual, p0, (p) => p.map((v, i) => constrainKind(free[i].kind, v)), maxIter);
  const sigma = Object.fromEntries(free.map((f, i) => [paramId(comps[f.ci].id, f.key), res.sigma[i]]));
  return { comps: apply(res.p), stats: stats(residual(res.p), ys, res.iterations, sigma) };
}

export type DispersionData = { xs: number[]; short: number[]; long: number[] };

// Fit of both branches at once; `short`/`long` are the branch at the smaller/larger value.
export function fitDispersion(params: Record<string, FitParam>, data: DispersionData, ctx: ModelCtx) {
  const free = dispersionParams(ctx.mode2).filter((d) => !params[d.key]?.fixed);
  const full = (p: number[]) => {
    const v = Object.fromEntries(Object.entries(params).map(([k, q]) => [k, q.value]));
    free.forEach((d, i) => (v[d.key] = p[i]));
    return v;
  };
  const residual = (p: number[]) => {
    const v = full(p);
    const n = data.xs.length;
    const r = new Float64Array(2 * n);
    data.xs.forEach((x, i) => {
      const [s, l] = branches(x, v, ctx);
      r[i] = s - data.short[i];
      r[n + i] = l - data.long[i];
    });
    return r;
  };
  const res = levenbergMarquardt(residual, free.map((d) => params[d.key]?.value ?? NaN), (p) => p.map((v, i) => constrainKind(free[i].kind, v)));
  const v = full(res.p);
  const next = Object.fromEntries(Object.keys(v).map((k) => [k, { fixed: params[k]?.fixed ?? false, value: v[k] }]));
  const sigma = Object.fromEntries(free.map((d, i) => [d.key, res.sigma[i]]));
  return { params: next, stats: stats(residual(res.p), [...data.short, ...data.long], res.iterations, sigma) };
}
