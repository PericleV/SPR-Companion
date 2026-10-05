// Optical response of an expanded structure: the layer indices at a wavelength, and R, T, A, phases over a grid of
// wavelengths × angles (spr-forge's TMM, physics/tmm.ts).
import { c, type C } from '../physics/complex.ts';
import { refractiveIndex, type Models } from '../physics/materials.ts';
import { tmmPoint, type Layer } from '../physics/tmm.ts';
import { TMM_META } from '../engine/dataset.ts';
import type { Axis, Dataset } from '../engine/types.ts';
import type { Expanded, MatRef, MixPart, RealLayer } from './structure.ts';
import { mixIndex, wienerEps } from './rough.ts';

// p (TM), s (TE), or unpolarized (the mean of R, T and A; no phases).
export type Pol = 'p' | 's' | 'u';

// A change Δn of the real index of media / layers: `targets` index [incident, ...layers, exit] (sensitivity); hit: which
// parts of the slices of a rough interface it reaches (their materials changed before they are mixed).
export type Perturb = { targets: number[]; dn: number; hit?: (p: MixPart) => boolean };

export const LAMBDA_AXIS = { id: 'lambda', label: 'λ', unit: 'nm' };
export const THETA_AXIS = { id: 'theta', label: 'θ', unit: '°' };

const matKey = (m: MatRef) => `${m.id}|${m.param ?? ''}|${m.dn ?? 0}|${m.dk ?? 0}`;

// Complex index of a material reference (with its offsets).
export function indexOf(m: MatRef, models: Models, lambda: number): C {
  const n = refractiveIndex(m.id, models, lambda, m.param);
  return m.dn || m.dk ? c(n.re + (m.dn ?? 0), Math.max(0, n.im + (m.dk ?? 0))) : n;
}

// The materials of a slice at one wavelength, perturbed where the change reaches them.
const partsOf = (L: RealLayer, at: (m: MatRef) => C, perturb?: Perturb) =>
  L.mix!.mats.map((m, i) => {
    const v = at(m);
    return perturb?.dn && perturb.hit?.(L.mix!.parts[i]) ? c(v.re + perturb.dn, v.im) : v;
  });

// Complex indices of [incident, ...layers, exit] at one wavelength (each material computed once).
export function indicesAt(e: Expanded, models: Models, lambda: number, perturb?: Perturb): C[] {
  const cache = new Map<string, C>();
  const at = (m: MatRef) => {
    const k = matKey(m);
    let n = cache.get(k);
    if (!n) {
      n = indexOf(m, models, lambda);
      cache.set(k, n);
    }
    return n;
  };
  // (a slice of a rough interface: the mixture of its materials)
  return [at(e.incident), ...e.layers.map((L) => (L.mix ? mixIndex(L.mix.method, partsOf(L, at, perturb), L.mix.f) : at(L.mat))), at(e.exit)];
}

// The TMM input at one wavelength.
// (a slice of a rough interface: the change reaches its parts when the perturbation says which — else the slice as a whole;
// a lamellar (Wiener) slice: its permittivity tensor)
export function stackAt(e: Expanded, models: Models, lambda: number, perturb?: Perturb): Layer[] {
  const n = indicesAt(e, models, lambda, perturb);
  const mixed = (k: number) => k >= 1 && k <= e.layers.length && !!e.layers[k - 1].mix && !!perturb?.hit;
  if (perturb && perturb.dn) for (const k of perturb.targets) if (k >= 0 && k < n.length && !mixed(k)) n[k] = c(n[k].re + perturb.dn, n[k].im);
  const wiener = e.layers.some((L) => L.mix?.method === 'wiener');
  const cache = new Map<string, C>();
  const at = (m: MatRef) => {
    const k = matKey(m);
    if (!cache.has(k)) cache.set(k, indexOf(m, models, lambda));
    return cache.get(k)!;
  };
  return n.map((nj, j) => {
    const L = j === 0 || j === n.length - 1 ? null : e.layers[j - 1];
    if (wiener && L?.mix?.method === 'wiener') return { n: nj, d: L.d, eps: wienerEps(partsOf(L, at, perturb), L.mix.f, L.mix.orient) };
    return { n: nj, d: L ? L.d : 0 };
  });
}

const DEG = 180 / Math.PI;

// Every quantity of a point: R, T, A, the phases (degrees), the complex amplitudes r and t; the slope of the phase of r
// along the scan (dphiR: °/° or °/nm) and the Goos–Hänchen shift gh = −(1/2π) dφr/dθ in wavelengths (the stationary-
// phase, Artmann convention of the literature: D = −(λ/2π) dφr/dθ) — those two from the neighbouring points.
export const POINT_KEYS = ['R', 'T', 'A', 'phiR', 'phiT', 'rRe', 'rIm', 'tRe', 'tIm', 'dphiR', 'gh'] as const;
export type PointKey = (typeof POINT_KEYS)[number];
export const POINT_META: Record<PointKey, { label: string; unit: string; domain?: [number, number] }> = {
  R: { label: 'R', unit: '', domain: [0, 1] },
  T: { label: 'T', unit: '', domain: [0, 1] },
  A: { label: 'A', unit: '', domain: [0, 1] },
  phiR: { label: 'φr', unit: '°', domain: [-180, 180] },
  phiT: { label: 'φt', unit: '°', domain: [-180, 180] },
  rRe: { label: 'Re r', unit: '' },
  rIm: { label: 'Im r', unit: '' },
  tRe: { label: 'Re t', unit: '' },
  tIm: { label: 'Im t', unit: '' },
  dphiR: { label: 'dφr/dx (phase slope along the scan)', unit: '' },
  gh: { label: 'GH shift −(1/2π) dφr/dθ', unit: 'λ' },
};

// One point for a polarization (unpolarized: the mean of R, T, A for s and p; no phases nor amplitudes).
export function pointOf(stack: Layer[], lambda: number, theta: number, pol: Pol): Record<PointKey, number> {
  if (pol !== 'u') {
    const r = tmmPoint(stack, lambda, theta, pol);
    return { R: r.R, T: r.T, A: r.A, phiR: r.phir * DEG, phiT: r.phit * DEG, rRe: r.rRe, rIm: r.rIm, tRe: r.tRe, tIm: r.tIm, dphiR: NaN, gh: NaN };
  }
  const s = tmmPoint(stack, lambda, theta, 's');
  const p = tmmPoint(stack, lambda, theta, 'p');
  return { R: (s.R + p.R) / 2, T: (s.T + p.T) / 2, A: (s.A + p.A) / 2, phiR: NaN, phiT: NaN, rRe: NaN, rIm: NaN, tRe: NaN, tIm: NaN, dphiR: NaN, gh: NaN };
}

export type ScanSpec = { lambda: number[]; theta: number[]; pol: Pol; perturb?: Perturb };

// R, T, A, φr, φt (degrees) over λ × θ, row-major with θ fastest.
export function scan(e: Expanded, models: Models, spec: ScanSpec, key = 'scan'): Dataset {
  const { lambda, theta, pol } = spec;
  const size = lambda.length * theta.length;
  const fields = { R: new Float64Array(size), T: new Float64Array(size), A: new Float64Array(size), phiR: new Float64Array(size), phiT: new Float64Array(size) };
  let k = 0;
  for (const lam of lambda) {
    const stack = stackAt(e, models, lam, spec.perturb);
    for (const th of theta) {
      const r = pointOf(stack, lam, th, pol);
      fields.R[k] = r.R;
      fields.T[k] = r.T;
      fields.A[k] = r.A;
      fields.phiR[k] = r.phiR;
      fields.phiT[k] = r.phiT;
      k++;
    }
  }
  const axes: Axis[] = [
    { ...LAMBDA_AXIS, values: lambda },
    { ...THETA_AXIS, values: theta },
  ];
  return { key, axes, fields, meta: TMM_META, size };
}

// Evenly spaced values from lo to hi (inclusive), `count` of them.
export function linspace(lo: number, hi: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  if (n === 1) return [lo];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

// The slope of a phase (degrees) along x by central differences (one-sided at the ends), across the ±180° wraps.
export function phaseSlope(xs: ArrayLike<number>, phi: ArrayLike<number>, at: number): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const a = Math.max(0, at - 1);
  const b = Math.min(n - 1, at + 1);
  let d = phi[b] - phi[a];
  d -= 360 * Math.round(d / 360);
  return d / (xs[b] - xs[a]);
}
// The Goos–Hänchen shift in wavelengths from dφr/dθ in °/°: −(1/2π) dφ/dθ (radians per radian).
export const ghOfSlope = (dphiDeg: number) => -dphiDeg / (2 * Math.PI);
