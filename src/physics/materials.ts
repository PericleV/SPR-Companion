// Material models: complex refractive index ñ(λ) = n + i·k.
import * as X from './complex.ts';
import { c, type C } from './complex.ts';

export const HC_EV_NM = 1239.84193;

export type Table = { lambda: number[]; n: number[]; k: number[] }; // λ in µm, ascending
export type EmaMethod = 'bruggeman' | 'maxwell-garnett' | 'looyenga';

export type MaterialModel =
  | { type: 'constant'; n: number; k: number }
  | { type: 'tabulated'; table: Table; extrap: 'clamp' | 'linear' }
  // refractiveindex.info dispersion formulas 1–9 (λ in µm) with constant or tabulated k
  | { type: 'formula'; formula: number; coefficients: number[]; k: number; kTable?: { lambda: number[]; k: number[] } }
  // ε(E) = ε∞ − ωp²/(E² + iγE) + Σ f·ω0²/(ω0² − E² − iγE), energies in eV
  | { type: 'drude-lorentz'; epsInf: number; wp: number; gamma: number; osc: { f: number; w0: number; g: number }[] }
  // porous material: host with a volume fraction `porosity` of pores filled with `filler`
  | { type: 'ema'; method: EmaMethod; host: string; filler: string; porosity: number }
  // doped semiconductor: Drude term from the carrier density N (10²⁰ cm⁻³), non-parabolic band (effective mass m0* at the
  // band bottom, non-parabolicity C in eV⁻¹) and the mobility (cm²/V·s); see carrierDrude
  | { type: 'drude-carrier'; epsInf: number; N: number; mStar0: number; C: number; mobility: number }
  // graphene from its surface conductivity (Kubo formula, intraband + interband at temperature T; see kuboSigma) as a
  // film of thickness d (nm): ε = ε_bg + iσ/(ε₀ω d); mu = chemical potential (eV), gamma = ħΓ scattering (eV)
  | { type: 'kubo'; mu: number; T: number; gamma: number; d: number; epsBg: number };

export type MaterialDef = {
  id: string;
  name: string;
  color: string;
  model: MaterialModel;
  range?: [number, number]; // nm, where the data are valid
  monolayer?: number; // nm; set for 2D materials (thickness = layers × monolayer)
  source?: string;
  builtin?: boolean;
  group?: string; // section of the library (built-in materials): MATERIAL_GROUPS
};

export type Models = Record<string, MaterialModel>;

// Linear interpolation on an ascending grid.
function interp(xs: number[], ys: number[], x: number, extrap: 'clamp' | 'linear'): number {
  const n = xs.length;
  if (n === 1) return ys[0];
  if (x <= xs[0] && extrap === 'clamp') return ys[0];
  if (x >= xs[n - 1] && extrap === 'clamp') return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  if (x <= xs[0]) hi = 1;
  else if (x >= xs[n - 1]) lo = n - 2;
  else
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

// refractiveindex.info formulas (same definitions as the database's nkexplorer tool).
export function formulaN(formula: number, coeff: number[], wl: number): number {
  const C = (i: number) => coeff[i - 1] ?? 0;
  let s = 0;
  switch (formula) {
    case 1:
      s = 1 + C(1);
      for (let i = 2; i <= 16; i += 2) if (C(i)) s += C(i) / (1 - (C(i + 1) / wl) ** 2);
      return Math.sqrt(s);
    case 2:
      s = 1 + C(1);
      for (let i = 2; i <= 16; i += 2) if (C(i)) s += C(i) / (1 - C(i + 1) / wl ** 2);
      return Math.sqrt(s);
    case 3:
      s = C(1);
      for (let i = 2; i <= 16; i += 2) if (C(i)) s += C(i) * wl ** C(i + 1);
      return Math.sqrt(s);
    case 4:
      s = C(1) + (C(2) * wl ** C(3)) / (wl ** 2 - C(4) ** C(5)) + (C(6) * wl ** C(7)) / (wl ** 2 - C(8) ** C(9));
      for (let i = 10; i <= 16; i += 2) if (C(i)) s += C(i) * wl ** C(i + 1);
      return Math.sqrt(s);
    case 5:
      s = C(1);
      for (let i = 2; i <= 10; i += 2) if (C(i)) s += C(i) * wl ** C(i + 1);
      return s;
    case 6:
      s = 1 + C(1);
      for (let i = 2; i <= 10; i += 2) if (C(i)) s += C(i) / (C(i + 1) - wl ** -2);
      return s;
    case 7:
      return C(1) + C(2) / (wl ** 2 - 0.028) + C(3) / (wl ** 2 - 0.028) ** 2 + C(4) * wl ** 2 + C(5) * wl ** 4 + C(6) * wl ** 6;
    case 8: {
      const t = C(1) + (C(2) * wl ** 2) / (wl ** 2 - C(3)) + C(4) * wl ** 2;
      return Math.sqrt((2 * t + 1) / (1 - t));
    }
    case 9:
      return Math.sqrt(C(1) + C(2) / (wl ** 2 - C(3)) + (C(4) * (wl - C(5))) / ((wl - C(5)) ** 2 + C(6)));
    default:
      return NaN;
  }
}

export const FORMULA_TEXT: Record<number, string> = {
  1: 'Sellmeier: n² − 1 = C1 + Σ C(i)λ²/(λ² − C(i+1)²)',
  2: 'Sellmeier-2: n² − 1 = C1 + Σ C(i)λ²/(λ² − C(i+1))',
  3: 'Polynomial: n² = C1 + Σ C(i)λ^C(i+1)',
  4: 'RefractiveIndex.INFO',
  5: 'Cauchy: n = C1 + Σ C(i)λ^C(i+1)',
  6: 'Gases: n − 1 = C1 + Σ C(i)/(C(i+1) − λ⁻²)',
  7: 'Herzberger',
  8: 'Retro',
  9: 'Exotic',
};

const epsToN = (e: C): C => X.sqrt(e); // principal root: Im(ñ) ≥ 0 when Im(ε) ≥ 0

function drudeLorentz(m: Extract<MaterialModel, { type: 'drude-lorentz' }>, E: number): C {
  let eps = c(m.epsInf);
  if (m.wp) eps = X.sub(eps, X.div(c(m.wp * m.wp), c(E * E, m.gamma * E)));
  for (const o of m.osc) eps = X.add(eps, X.div(c(o.f * o.w0 * o.w0), c(o.w0 * o.w0 - E * E, -o.g * E)));
  return eps;
}

// Drude permittivity of a doped semiconductor (J. R. Nolen et al., Phys. Rev. Mater. 4, 025202 (2020), CdO):
//   m* = m0*·√(1 + 2C·ħ²k_F²/(m0* mₑ)), k_F = (3π²N)^{1/3};  ħωp = ħ√(N e²/(ε₀ m* mₑ));  ħγ = ħ e/(μ m* mₑ);
//   ε = ε∞ − ωp²/(E² + iγE),  E = photon energy (eV), N = carrier density in 10²⁰ cm⁻³.
export function carrierDrude(m: Extract<MaterialModel, { type: 'drude-carrier' }>, N20: number, E: number): C {
  const N = N20 * 1e26; // m⁻³
  const HBARC = 1.973269804e-7; // eV·m
  const MEC2 = 510998.95; // eV
  const HBAR = 6.582119569e-16; // eV·s
  const QE = 1.602176634e-19; // C
  const EPS0 = 8.8541878128e-12; // F/m
  const ME = 9.1093837015e-31; // kg
  const kF2 = Math.cbrt(3 * Math.PI * Math.PI * N) ** 2; // m⁻²
  const mStar = m.mStar0 * Math.sqrt(1 + (2 * m.C * HBARC * HBARC * kF2) / (m.mStar0 * MEC2));
  const wp = HBAR * Math.sqrt((N * QE * QE) / (EPS0 * mStar * ME));
  const g = (HBAR * QE) / (m.mobility * 1e-4 * mStar * ME);
  return X.sub(c(m.epsInf), X.div(c(wp * wp), c(E * E, g * E)));
}

// Surface conductivity of graphene in units of σ₀ = e²/(4ħ) (G. W. Hanson, J. Appl. Phys. 103, 064302 (2008), the usual
// closed forms): intraband σ/σ₀ = (4i/π)·E_T/(E + iħΓ), E_T = k_BT·(μ/k_BT + 2 ln(1 + e^(−μ/k_BT))); interband
// σ/σ₀ = 1/2 + (1/π)·atan((E − 2μ)/(2k_BT)) − (i/2π)·ln((E + 2μ)²/((E − 2μ)² + (2k_BT)²)). Energies in eV.
export function kuboSigma(m: Extract<MaterialModel, { type: 'kubo' }>, E: number): C {
  const kT = Math.max(1e-6, 8.617333262e-5 * m.T);
  const mu = Math.abs(m.mu);
  const ET = kT * (mu / kT + 2 * Math.log1p(Math.exp(-mu / kT)));
  const intra = X.mul(c(0, 4 / Math.PI), X.div(c(ET), c(E, m.gamma)));
  const inter = c(0.5 + Math.atan((E - 2 * mu) / (2 * kT)) / Math.PI, -Math.log((E + 2 * mu) ** 2 / ((E - 2 * mu) ** 2 + (2 * kT) ** 2)) / (2 * Math.PI));
  return X.add(intra, inter);
}

// ε of the graphene film: ε_bg + iσ/(ε₀ω d), with σ₀/(ε₀ω d) = e²/(4ε₀ E d) (E in J, d in m).
function kuboEps(m: Extract<MaterialModel, { type: 'kubo' }>, E: number): C {
  const QE = 1.602176634e-19;
  const EPS0 = 8.8541878128e-12;
  const scale = (QE * QE) / (4 * EPS0 * (E * QE) * (m.d * 1e-9));
  const s = kuboSigma(m, E);
  return c(m.epsBg - scale * s.im, scale * s.re);
}

const cbrt = (z: C): C => {
  const r = Math.cbrt(Math.hypot(z.re, z.im));
  const a = Math.atan2(z.im, z.re) / 3;
  return c(r * Math.cos(a), r * Math.sin(a));
};

// Effective permittivity of pores (ε1, fraction p) in a host (ε2).
export function emaEps(method: EmaMethod, e1: C, e2: C, p: number): C {
  if (method === 'maxwell-garnett') {
    const d = X.sub(e1, e2);
    const num = X.add(X.add(e1, X.mul(c(2), e2)), X.mul(c(2 * p), d));
    const den = X.sub(X.add(e1, X.mul(c(2), e2)), X.mul(c(p), d));
    return X.mul(e2, X.div(num, den));
  }
  if (method === 'looyenga') {
    const s = X.add(X.mul(c(p), cbrt(e1)), X.mul(c(1 - p), cbrt(e2)));
    return X.mul(s, X.mul(s, s));
  }
  // Bruggeman: 2ε² − bε − ε1ε2 = 0, b = (3p − 1)ε1 + (2 − 3p)ε2; keep the root with Im ε ≥ 0.
  const b = X.add(X.mul(c(3 * p - 1), e1), X.mul(c(2 - 3 * p), e2));
  const disc = X.sqrt(X.add(X.mul(b, b), X.mul(c(8), X.mul(e1, e2))));
  const r1 = X.div(X.add(b, disc), c(4));
  const r2 = X.div(X.sub(b, disc), c(4));
  const score = (r: C) => (r.im >= -1e-12 ? 1e6 : 0) + r.re;
  return score(r1) >= score(r2) ? r1 : r2;
}

// `porosity` is the model parameter a Material node can set or sweep: the pore fraction of an effective-medium material,
// or the carrier density (10²⁰ cm⁻³) of a doped-semiconductor Drude model (top level only).
export function refractiveIndex(id: string, models: Models, lambdaNm: number, porosity?: number, depth = 0): C {
  const m = models[id];
  if (!m || depth > 8) return c(NaN, NaN);
  const wl = lambdaNm / 1000;
  switch (m.type) {
    case 'constant':
      return c(porosity ?? m.n, m.k); // (its parameter: n)
    case 'tabulated':
      return c(
        interp(m.table.lambda, m.table.n, wl, m.extrap),
        Math.max(0, interp(m.table.lambda, m.table.k, wl, m.extrap)),
      );
    case 'formula':
      return c(formulaN(m.formula, m.coefficients, wl), m.kTable ? Math.max(0, interp(m.kTable.lambda, m.kTable.k, wl, 'clamp')) : m.k);
    case 'drude-lorentz':
      return epsToN(drudeLorentz(m, HC_EV_NM / lambdaNm));
    case 'drude-carrier':
      return epsToN(carrierDrude(m, porosity ?? m.N, HC_EV_NM / lambdaNm));
    case 'kubo':
      return epsToN(kuboEps(m, HC_EV_NM / lambdaNm));
    case 'ema': {
      const sq = (z: C) => X.mul(z, z);
      const e1 = sq(refractiveIndex(m.filler, models, lambdaNm, undefined, depth + 1));
      const e2 = sq(refractiveIndex(m.host, models, lambdaNm, undefined, depth + 1));
      return epsToN(emaEps(m.method, e1, e2, porosity ?? m.porosity));
    }
  }
}

// An effective-medium material whose pores hold a given filler index (the neighbouring layer); other models: as usual.
export function emaWithFiller(id: string, models: Models, lambdaNm: number, filler: C, porosity?: number): C {
  const m = models[id];
  if (!m || m.type !== 'ema') return refractiveIndex(id, models, lambdaNm, porosity);
  const host = refractiveIndex(m.host, models, lambdaNm);
  return epsToN(emaEps(m.method, X.mul(filler, filler), X.mul(host, host), porosity ?? m.porosity));
}

// Ids a model depends on (itself included), for shipping to the worker.
export function dependencies(id: string, lib: Map<string, MaterialDef>, out = new Set<string>()): Set<string> {
  const d = lib.get(id);
  if (!d || out.has(id)) return out;
  out.add(id);
  if (d.model.type === 'ema') {
    dependencies(d.model.host, lib, out);
    dependencies(d.model.filler, lib, out);
  }
  return out;
}

// Valid wavelength range (nm), intersecting the constituents of an effective medium.
export function validRange(id: string, lib: Map<string, MaterialDef>, depth = 0): [number, number] {
  const d = lib.get(id);
  if (!d || depth > 8) return [0, Infinity];
  if (d.model.type !== 'ema') return d.range ?? [0, Infinity];
  const a = validRange(d.model.host, lib, depth + 1);
  const b = validRange(d.model.filler, lib, depth + 1);
  return [Math.max(a[0], b[0]), Math.min(a[1], b[1])];
}
