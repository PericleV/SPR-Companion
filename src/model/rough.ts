// Rough interfaces (after SPR Forge's engine/rough.ts, the method of T. Treebupachatsakul et al., Sensors 21, 6164
// (2021)): a height profile h(x) over a periodic cell, of zero mean around the nominal interface — so every material
// keeps its mean thickness — cut into horizontal slices; each slice is an effective medium of the fractions of the
// materials at its depth (TMM). Three kinds of interface:
//   profile    a random profile: white noise low-pass filtered in Fourier space (autocorrelation exp(−r²/cl²)), scaled
//              to the RMS or the peak-to-peak height; one realization per seed;
//   effective  one interface layer, half of each material (thickness: the peak-to-peak height, or 2·RMS);
//   graded     an interface layer whose fractions change linearly with depth (the same thickness), in slices.
// The slices mix by Bruggeman, Maxwell-Garnett, Looyenga or linearly in n. Several rough interfaces whose zones
// overlap (a thin film) are cut together; a film thinner than the RMS heights of its two random interfaces follows the
// interface on its incident side (its second interface copies the shape of the first, with its own height); a surface
// never goes above the one before it (the film is pinched off there). In TMM only the distribution of the heights
// counts (the fractions at each depth): the correlation length shapes the drawing and changes a realization slightly.
import * as X from '../physics/complex.ts';
import { c, type C } from '../physics/complex.ts';

export type RoughType = 'profile' | 'effective' | 'graded';
export type RoughMix = 'bruggeman' | 'maxwell-garnett' | 'looyenga' | 'linear' | 'wiener';
// wiener: the direction of the profile — in the plane of incidence (x: grooves normal to it) or normal to it (y)
export type RoughOrient = 'x' | 'y';
export type Rough = {
  on: boolean;
  type: RoughType;
  kind: 'rms' | 'pp'; // what `size` is: the RMS height or the peak-to-peak height (nm)
  size: number;
  cl: number; // correlation length (nm), profile
  cell: number; // length of the periodic cell (nm), profile
  px: number; // points of the profile over the cell
  seed: number; // the random realization, profile
  slices: number; // slices of the rough zone (profile, graded)
  mix: RoughMix;
  repeat: 'independent' | 'replicated'; // a DBR layer: every period its own realization, or the same shape
  orient?: RoughOrient; // wiener: the profile along x (in the plane of incidence) or along y
};
// The two interfaces of a layer: top (towards the incident medium of the structure) and bottom.
export type Roughs = { top?: Rough; bottom?: Rough };
export type RoughSide = 'top' | 'bottom';

export const defaultRough = (over: Partial<Rough> = {}): Rough => ({ on: true, type: 'profile', kind: 'rms', size: 2, cl: 20, cell: 1000, px: 1000, seed: 1, slices: 10, mix: 'bruggeman', repeat: 'independent', ...over });
export const roughOn = (r?: Rough): r is Rough => !!r && r.on && r.size > 0;
export const hasRough = (r?: Roughs) => roughOn(r?.top) || roughOn(r?.bottom);

export const ROUGH_TYPES: Record<RoughType, { label: string; title: string }> = {
  profile: { label: 'random profile', title: 'A random height profile (correlation length, seed), cut into slices' },
  effective: { label: 'effective layer', title: 'One interface layer, half of each material; its thickness is the peak-to-peak height (or 2·RMS)' },
  graded: { label: 'graded layer', title: 'An interface layer whose material fractions change linearly with depth (the same thickness), in slices' },
};
export const ROUGH_MIX: Record<RoughMix, string> = { bruggeman: 'Bruggeman', 'maxwell-garnett': 'Maxwell-Garnett', looyenga: 'Looyenga (LLL)', linear: 'linear in n', wiener: 'lamellar (Wiener): harmonic across, arithmetic along' };

// ---- the profile ----

// Deterministic generator (mulberry32) and Gaussian numbers (Box–Muller).
function gaussian(seed: number) {
  let a = (Math.round(seed) * 2654435761) >>> 0 || 1;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

const shapes = new Map<string, Float64Array>();
// A unit profile (zero mean, RMS 1) of `px` points over one period: white noise filtered by exp(−(π cl f)²/2) (the
// square root of the power spectrum of a Gaussian autocorrelation exp(−r²/cl²)); cl in units of the cell.
export function roughShape(px: number, cl: number, seed: number): Float64Array {
  const n = Math.max(4, Math.round(px));
  const key = `${n}|${cl}|${seed}`;
  const hit = shapes.get(key);
  if (hit) return hit;
  const g = gaussian(seed);
  const w = Float64Array.from({ length: n }, () => g());
  const cs = Float64Array.from({ length: n }, (_, k) => Math.cos((2 * Math.PI * k) / n));
  const sn = Float64Array.from({ length: n }, (_, k) => Math.sin((2 * Math.PI * k) / n));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const fr = f <= n / 2 ? f : f - n; // cycles per cell
    const filt = Math.exp(-((Math.PI * cl * fr) ** 2) / 2);
    if (filt < 1e-12) continue;
    let sr = 0;
    let si = 0;
    for (let j = 0; j < n; j++) {
      const k = (f * j) % n;
      sr += w[j] * cs[k];
      si -= w[j] * sn[k];
    }
    re[f] = sr * filt;
    im[f] = si * filt;
  }
  const h = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let f = 0; f < n; f++) {
      if (re[f] === 0 && im[f] === 0) continue;
      const k = (f * j) % n;
      s += re[f] * cs[k] - im[f] * sn[k];
    }
    h[j] = s / n;
  }
  const mean = h.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (let j = 0; j < n; j++) {
    h[j] -= mean;
    ss += h[j] * h[j];
  }
  const rms = Math.sqrt(ss / n) || 1;
  for (let j = 0; j < n; j++) h[j] /= rms;
  if (shapes.size > 128) shapes.delete(shapes.keys().next().value!);
  shapes.set(key, h);
  return h;
}

export const statsOf = (h: ArrayLike<number>) => {
  let s = 0;
  let ss = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < h.length; i++) {
    s += h[i];
    lo = Math.min(lo, h[i]);
    hi = Math.max(hi, h[i]);
  }
  const mean = s / Math.max(1, h.length);
  for (let i = 0; i < h.length; i++) ss += (h[i] - mean) ** 2;
  return { mean, rms: Math.sqrt(ss / Math.max(1, h.length)), pp: hi - lo, min: lo, max: hi };
};

// The lag (in points) where the autocorrelation of a periodic profile falls to 1/e (its correlation length for a
// Gaussian autocorrelation exp(−r²/cl²)); linear interpolation between the points.
export function corrLength(h: ArrayLike<number>): number {
  const n = h.length;
  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += h[i] * h[i];
  let prev = 1;
  for (let lag = 1; lag < n / 2; lag++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += h[i] * h[(i + lag) % n];
    const r = s / c0;
    if (r < 1 / Math.E) return lag - 1 + (prev - 1 / Math.E) / (prev - r);
    prev = r;
  }
  return NaN;
}

const LAYER_PX = 400; // points of the interface layers (effective, graded)

// The heights (nm, zero mean) of an interface at `px` points; `offset` shifts the seed (a DBR period).
export function heightsOf(r: Rough, px: number, offset = 0): Float64Array {
  if (r.type === 'profile') {
    const shape = resample(roughShape(r.px, r.cl / Math.max(1e-9, r.cell), r.seed + offset), px);
    const f = r.kind === 'rms' ? r.size : r.size / (statsOf(shape).pp || 1);
    return shape.map((v) => v * f);
  }
  // the interface layers: half its thickness w on each side of the interface (w = peak-to-peak, or 2·RMS)
  const half = r.kind === 'rms' ? r.size : r.size / 2;
  if (r.type === 'effective') return Float64Array.from({ length: px }, (_, i) => (i % 2 ? half : -half));
  // (the ramp spans exactly ±half: the zone is the given thickness)
  return Float64Array.from({ length: px }, (_, i) => half * (-1 + (2 * i) / Math.max(1, px - 1)));
}

// Nearest-point resampling of a periodic profile to n points.
const resample = (h: Float64Array, n: number) => (h.length === n ? h : Float64Array.from({ length: n }, (_, i) => h[Math.floor((i * h.length) / n)]));
const pxOf = (r: Rough) => (r.type === 'profile' ? Math.max(4, Math.round(r.px)) : LAYER_PX);
const slicesOf = (r: Rough) => (r.type === 'effective' ? 1 : Math.max(1, Math.round(r.slices)));

// ---- the layering ----

// A stack item: a medium or a layer (d), the roughness of its sides, and the seed offset of its realization.
export type RoughItem = { d: number; rough?: Roughs; offset?: number };
// Out: a flat (part of) item i of the list, or a slice of a rough zone (the fractions of the items there).
export type RoughOut = { kind: 'layer'; i: number; d: number } | { kind: 'slice'; d: number; owner: number; mats: number[]; frac: number[]; mix: RoughMix; orient: RoughOrient };
export type RoughZone = { z0: number; z1: number; k0: number; k1: number; S: Float64Array[] }; // surfaces k0 … k1
export type RoughPlan = { out: RoughOut[]; notes: string[]; zones: RoughZone[]; z: number[]; px: number; cell: number };

// The layering of `list` (incident medium, layers, exit medium; the media d = 0), or null without a rough interface.
// Interface k lies between list[k] and list[k + 1]; its roughness: the bottom of list[k] or the top of list[k + 1].
export function roughPlan(list: RoughItem[]): RoughPlan | null {
  const n = list.length;
  const nI = n - 1;
  const notes: string[] = [];
  const finite = (i: number) => i > 0 && i < n - 1;
  const par: (Rough | null)[] = [];
  const off: number[] = [];
  for (let k = 0; k < nI; k++) {
    const up = finite(k) && roughOn(list[k].rough?.bottom) ? list[k].rough!.bottom! : null;
    const dn = finite(k + 1) && roughOn(list[k + 1].rough?.top) ? list[k + 1].rough!.top! : null;
    if (up && dn && !notes.some((t) => t.startsWith('both sides'))) notes.push('both sides of an interface are rough (the bottom of a layer and the top of the next): the bottom one is used');
    par.push(up ?? dn);
    const r = up ?? dn;
    off.push(!r || r.repeat === 'replicated' ? 0 : up ? (list[k].offset ?? 0) : (list[k + 1]?.offset ?? 0));
  }
  if (!par.some(Boolean)) return null;
  const d = list.map((L, i) => (finite(i) ? Math.max(0, L.d) : 0));
  const z = new Array<number>(nI).fill(0);
  for (let k = 1; k < nI; k++) z[k] = z[k - 1] + d[k];
  const px = Math.max(...par.map((p) => (p ? pxOf(p) : 0)));
  const cell = par.find((p) => p?.type === 'profile')?.cell ?? 1000;
  const H: (Float64Array | null)[] = par.map((p, k) => (p ? heightsOf(p, px, off[k]) : null));
  // a thin film between two random interfaces follows the first one (its own height)
  const rmsOf = (k: number) => (H[k] ? statsOf(H[k]!).rms : 0);
  for (let k = 1; k < nI; k++)
    if (par[k]?.type === 'profile' && par[k - 1]?.type === 'profile' && d[k] <= rmsOf(k - 1) + rmsOf(k)) {
      const prev = H[k - 1]!;
      const s = statsOf(prev);
      const f = par[k]!.kind === 'rms' ? par[k]!.size / (s.rms || 1) : par[k]!.size / (s.pp || 1);
      H[k] = prev.map((v) => v * f);
      notes.push(`a ${d[k].toFixed(1)} nm film is thinner than the RMS heights of its two interfaces: its second interface follows the first (a conformal film)`);
    }
  const S: Float64Array[] = Array.from({ length: nI }, (_, k) => (H[k] ? H[k]!.map((v) => z[k] + v) : new Float64Array(px).fill(z[k])));
  let pinched = false;
  for (let k = 1; k < nI; k++)
    for (let x = 0; x < px; x++)
      if (S[k][x] < S[k - 1][x]) {
        S[k][x] = S[k - 1][x];
        pinched = true;
      }
  if (pinched) notes.push('a rough surface reaches the next interface: the film is pinched off there (zero thickness)');
  // zones: interfaces whose surfaces overlap in depth are cut together; a flat interface inside a zone belongs to it
  const span = S.map((s) => statsOf(s));
  const groups: { k0: number; k1: number; z0: number; z1: number }[] = [];
  for (let k = 0; k < nI; k++) {
    if (!(span[k].max > span[k].min + 1e-9)) continue;
    const g = groups[groups.length - 1];
    if (g && span[k].min < g.z1 - 1e-12) {
      g.k1 = k;
      g.z1 = Math.max(g.z1, span[k].max);
      g.z0 = Math.min(g.z0, span[k].min);
    } else groups.push({ k0: k, k1: k, z0: span[k].min, z1: span[k].max });
  }
  for (const g of groups)
    for (let k = 0; k < nI; k++)
      if (span[k].min >= g.z0 - 1e-12 && span[k].max <= g.z1 + 1e-12) {
        g.k0 = Math.min(g.k0, k);
        g.k1 = Math.max(g.k1, k);
      }
  const out: RoughOut[] = [{ kind: 'layer', i: 0, d: 0 }];
  const cuts = [...new Set([...z, ...groups.flatMap((g) => [g.z0, g.z1])])].sort((a, b) => a - b);
  const done = new Set<number>();
  const push = (i: number, dd: number) => {
    const last = out[out.length - 1];
    if (last.kind === 'layer' && last.i === i) last.d += dd;
    else out.push({ kind: 'layer', i, d: dd });
  };
  const sliceGroup = (gi: number) => {
    const g = groups[gi];
    const members = par.slice(g.k0, g.k1 + 1).filter((p): p is Rough => !!p);
    const N = Math.max(1, members.reduce((a, p) => a + slicesOf(p), 0));
    const mix = members[0]?.mix ?? 'bruggeman';
    const orient = members[0]?.orient ?? 'x';
    const h = (g.z1 - g.z0) / N;
    for (let s = 0; s < N; s++) {
      const zc = g.z0 + (s + 0.5) * h;
      const count = new Map<number, number>();
      for (let x = 0; x < px; x++) {
        let L = g.k0;
        for (let k = g.k0; k <= g.k1; k++) if (S[k][x] <= zc) L = k + 1;
        count.set(L, (count.get(L) ?? 0) + 1);
      }
      const mats = [...count.keys()].sort((a, b) => a - b);
      const frac = mats.map((m) => count.get(m)! / px);
      out.push({ kind: 'slice', d: h, owner: mats[frac.indexOf(Math.max(...frac))], mats, frac, mix, orient });
    }
  };
  for (let c0 = 0; c0 < cuts.length - 1; c0++) {
    const [a, b] = [cuts[c0], cuts[c0 + 1]];
    if (!(b > a + 1e-12)) continue;
    const m = (a + b) / 2;
    const gi = groups.findIndex((g) => m > g.z0 && m < g.z1);
    if (gi >= 0) {
      if (!done.has(gi)) {
        done.add(gi);
        sliceGroup(gi);
      }
      continue;
    }
    for (let j = 1; j < n - 1; j++) if (m > z[j - 1] && m < z[j]) push(j, b - a);
  }
  // (a zone no cut reached: every zone spans cuts of its own, so none in practice)
  groups.forEach((_, gi) => !done.has(gi) && sliceGroup(gi));
  out.push({ kind: 'layer', i: n - 1, d: 0 });
  return { out, notes, zones: groups.map((g) => ({ ...g, S: S.slice(g.k0, g.k1 + 1) })), z, px, cell };
}

// ---- effective medium of a slice ----

const cbrt = (z: C): C => {
  const r = Math.cbrt(Math.hypot(z.re, z.im));
  const a = Math.atan2(z.im, z.re) / 3;
  return c(r * Math.cos(a), r * Math.sin(a));
};

// ε of a mixture: fractions f of the permittivities e (Bruggeman: the root with Im ε ≥ 0 by Newton from the Looyenga
// value; Maxwell-Garnett: the material with the largest fraction as host).
export function emaMix(method: Exclude<RoughMix, 'linear'>, e: C[], f: number[]): C {
  if (e.length === 1) return e[0];
  const loo = () => {
    let s = c(0);
    e.forEach((ei, i) => (s = X.add(s, X.mul(c(f[i]), cbrt(ei)))));
    return X.mul(s, X.mul(s, s));
  };
  if (method === 'looyenga') return loo();
  if (method === 'maxwell-garnett') {
    const h = f.indexOf(Math.max(...f));
    const eh = e[h];
    let q = c(0);
    e.forEach((ei, i) => {
      if (i !== h) q = X.add(q, X.mul(c(f[i]), X.div(X.sub(ei, eh), X.add(ei, X.mul(c(2), eh)))));
    });
    return X.div(X.mul(eh, X.add(c(1), X.mul(c(2), q))), X.sub(c(1), q));
  }
  let x = loo();
  for (let it = 0; it < 60; it++) {
    let F = c(0);
    let dF = c(0);
    e.forEach((ei, i) => {
      const den = X.add(ei, X.mul(c(2), x));
      F = X.add(F, X.mul(c(f[i]), X.div(X.sub(ei, x), den)));
      dF = X.sub(dF, X.mul(c(3 * f[i]), X.div(ei, X.mul(den, den))));
    });
    const step = X.div(F, dF);
    x = X.sub(x, step);
    if (Math.hypot(step.re, step.im) < 1e-14 * Math.hypot(x.re, x.im)) break;
  }
  return x.im < 0 ? X.conj(x) : x;
}

// The permittivity tensor of a lamellar slice (the limits of O. Wiener; the zeroth-order effective medium of a 1D
// profile, the quasi-static limit of RCWA on it): along the lamellae the arithmetic mean Σ f ε, across them the
// harmonic mean 1/Σ (f/ε). Profile along x (in the plane of incidence): εx harmonic, εy = εz arithmetic; along y: εy
// harmonic. TE then sees εy, TM εx and εz.
export function wienerEps(n: C[], f: number[], orient: RoughOrient = 'x'): { x: C; y: C; z: C } {
  const e = n.map((x) => X.mul(x, x));
  const arith = e.reduce((a, ei, i) => X.add(a, X.mul(c(f[i]), ei)), c(0));
  const harm = X.div(c(1), e.reduce((a, ei, i) => X.add(a, X.div(c(f[i]), ei)), c(0)));
  return orient === 'x' ? { x: harm, y: arith, z: arith } : { x: arith, y: harm, z: arith };
}

// The index of a mixture of indices n with fractions f (wiener: the arithmetic mean of ε, a nominal index — the
// transfer matrices use the tensor).
export function mixIndex(method: RoughMix, n: C[], f: number[]): C {
  if (n.length === 1) return n[0];
  if (method === 'linear') return n.reduce((a, ni, i) => c(a.re + f[i] * ni.re, a.im + f[i] * ni.im), c(0));
  if (method === 'wiener') return X.sqrt(wienerEps(n, f).y);
  return X.sqrt(emaMix(method, n.map((x) => X.mul(x, x)), f));
}

// The roughs of a layer with the seeds of their random profiles shifted by k (another realization).
export const shiftSeeds = (r: Roughs | undefined, k: number): Roughs | undefined =>
  !r || !k ? r : { top: r.top && r.top.type === 'profile' ? { ...r.top, seed: r.top.seed + k } : r.top, bottom: r.bottom && r.bottom.type === 'profile' ? { ...r.bottom, seed: r.bottom.seed + k } : r.bottom };
export const randomRough = (r?: Roughs) => (roughOn(r?.top) && r!.top!.type === 'profile') || (roughOn(r?.bottom) && r!.bottom!.type === 'profile');
