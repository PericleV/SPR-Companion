// Helpers of the Materials page: model descriptions, units, resampling of tabulated data, where a material is used.
import { FORMULA_TEXT, HC_EV_NM, type MaterialDef, type MaterialModel, type Table } from '../physics/materials.ts';
import type { Library } from '../physics/library.ts';
import type { Project } from './project.ts';
import type { Structure } from './structure.ts';

export const MODEL_LABEL: Record<MaterialModel['type'], string> = {
  constant: 'Constant n, k',
  tabulated: 'Tabulated (n, k vs λ)',
  formula: 'Dispersion formula',
  'drude-lorentz': 'Drude-Lorentz',
  ema: 'Porous / effective medium',
  'drude-carrier': 'Doped semiconductor (Drude)',
  kubo: 'Graphene (Kubo conductivity)',
};

const num = (v: number, d = 4) => String(+v.toPrecision(d));

export function describeModel(m: MaterialModel, lib: Library): string {
  const name = (id: string) => lib.get(id)?.name ?? id;
  switch (m.type) {
    case 'constant':
      return `n = ${num(m.n, 6)}, k = ${num(m.k, 6)}`;
    case 'tabulated':
      return `${m.table.lambda.length} points, ${num(m.table.lambda[0] * 1000)}–${num(m.table.lambda.at(-1)! * 1000)} nm, linear interpolation, ${m.extrap === 'clamp' ? 'constant' : 'linear'} extrapolation`;
    case 'formula':
      return `${FORMULA_TEXT[m.formula] ?? `formula ${m.formula}`}; C = ${m.coefficients.map((v) => num(v)).join(', ')}${m.kTable ? '; tabulated k' : m.k ? `; k = ${num(m.k)}` : ''}`;
    case 'drude-lorentz':
      return `ε∞ = ${num(m.epsInf)}, ħωp = ${num(m.wp)} eV, ħγ = ${num(m.gamma)} eV${m.osc.length ? `, ${m.osc.length} Lorentz oscillator${m.osc.length > 1 ? 's' : ''}` : ''}`;
    case 'ema':
      return `${m.method === 'bruggeman' ? 'Bruggeman' : m.method === 'maxwell-garnett' ? 'Maxwell-Garnett' : 'Looyenga'}: host ${name(m.host)}, inclusions ${name(m.filler)}, fill fraction ${num(m.porosity)}`;
    case 'drude-carrier':
      return `ε∞ = ${num(m.epsInf)}, N = ${num(m.N)}·10²⁰ cm⁻³, m* = ${num(m.mStar0)} mₑ, μ = ${num(m.mobility)} cm²/V·s`;
    case 'kubo':
      return `μc = ${num(m.mu)} eV, T = ${num(m.T)} K, ħΓ = ${num(m.gamma)} eV, film ${num(m.d)} nm, ε_bg = ${num(m.epsBg)}`;
  }
}

// What the per-layer parameter of a material means (MatRef.param), if it has one.
export function paramOf(def: MaterialDef | undefined): { label: string; value: number; min: number; max: number } | null {
  const m = def?.model;
  if (m?.type === 'ema') return { label: 'fill fraction', value: m.porosity, min: 0, max: 1 };
  if (m?.type === 'drude-carrier') return { label: 'N [10²⁰ cm⁻³]', value: m.N, min: 0, max: Infinity };
  if (m?.type === 'constant' && !def?.builtin) return { label: 'n', value: m.n, min: 1, max: 10 };
  return null;
}

// Energy units of the Drude-Lorentz editor, converted to eV.
export type EnergyUnit = 'eV' | 'rad/s' | 'Hz' | '1/cm' | 'nm';
export const ENERGY_UNITS: EnergyUnit[] = ['eV', 'rad/s', 'Hz', '1/cm', 'nm'];
const HBAR_EVS = 6.582119569e-16;
export function toEv(v: number, u: EnergyUnit): number {
  switch (u) {
    case 'eV':
      return v;
    case 'rad/s':
      return v * HBAR_EVS;
    case 'Hz':
      return v * 2 * Math.PI * HBAR_EVS;
    case '1/cm':
      return v * 1.239841984e-4;
    case 'nm':
      return v > 0 ? HC_EV_NM / v : NaN;
  }
}

// Natural cubic spline through (x, y), x ascending: a function of x (linear beyond the ends).
export function spline(x: number[], y: number[]): (t: number) => number {
  const n = x.length;
  if (n < 3) return (t) => (n === 1 ? y[0] : y[0] + ((t - x[0]) / (x[1] - x[0])) * (y[1] - y[0]));
  const h = x.slice(1).map((v, i) => v - x[i]);
  // second derivatives M (M0 = Mn-1 = 0): tridiagonal system
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(1);
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i - 1];
    b[i] = 2 * (h[i - 1] + h[i]);
    c[i] = h[i];
    d[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }
  for (let i = 1; i < n; i++) {
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    d[i] -= w * d[i - 1];
  }
  const M = new Array<number>(n).fill(0);
  M[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i];
  return (t) => {
    if (t <= x[0]) return y[0] + ((t - x[0]) / h[0]) * (y[1] - y[0]);
    if (t >= x[n - 1]) return y[n - 1] + ((t - x[n - 1]) / h[n - 2]) * (y[n - 1] - y[n - 2]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= t) lo = mid;
      else hi = mid;
    }
    const hh = h[lo];
    const A = (x[hi] - t) / hh;
    const B = (t - x[lo]) / hh;
    return A * y[lo] + B * y[hi] + ((A ** 3 - A) * M[lo] + (B ** 3 - B) * M[hi]) * (hh * hh) / 6;
  };
}

// A table resampled on `count` evenly spaced wavelengths (linear or cubic-spline interpolation; k kept ≥ 0).
export function resample(t: Table, count: number, kind: 'linear' | 'spline'): Table {
  const n = Math.max(2, Math.round(count));
  const [lo, hi] = [t.lambda[0], t.lambda[t.lambda.length - 1]];
  const lambda = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  const lin = (ys: number[]) => (l: number) => {
    let j = 1;
    while (j < t.lambda.length - 1 && t.lambda[j] < l) j++;
    const f = (l - t.lambda[j - 1]) / (t.lambda[j] - t.lambda[j - 1] || 1);
    return ys[j - 1] + f * (ys[j] - ys[j - 1]);
  };
  const fn = kind === 'spline' ? spline(t.lambda, t.n) : lin(t.n);
  const fk = kind === 'spline' ? spline(t.lambda, t.k) : lin(t.k);
  return { lambda, n: lambda.map(fn), k: lambda.map((l) => Math.max(0, fk(l))) };
}

// The materials a structure uses (with the constituents of effective media).
export function structureMaterials(s: Structure): string[] {
  const ids = [s.incident.id, s.exit.id];
  for (const b of s.blocks) {
    if (b.kind === 'film') ids.push(b.mat.id);
    else ids.push(...b.period.map((p) => p.mat.id), ...b.cavities.map((c) => c.mat.id));
  }
  return [...new Set(ids)];
}

// Where a material is used: the structure, or as a constituent of other materials.
export function usesOf(p: Project, id: string): string[] {
  const out: string[] = [];
  if (structureMaterials(p.structure).includes(id)) out.push('the structure');
  for (const m of p.materials) if (m.model.type === 'ema' && (m.model.host === id || m.model.filler === id)) out.push(m.name);
  return out;
}

export const newMaterialId = (name: string) =>
  `u-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'material'}-${Math.random().toString(36).slice(2, 6)}`;

// The colour of a material in drawings and field maps: the project's choice, else the library's.
export const colorOf = (colors: Record<string, string>, lib: Library, id: string) => colors[id] ?? lib.get(id)?.color ?? '#888888';

const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f'];
export const nextColor = (k: number) => PALETTE[k % PALETTE.length];
