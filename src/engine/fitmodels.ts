// Fit models: additive spectral components and the coupled-oscillator dispersion (anticrossing).
// On a wavelength axis (nm) the coupled-oscillator physics is done in energy, but every parameter
// is given in nm; on other axes x is used directly as the frequency-like variable.
import { HC_EV_NM } from '../physics/materials.ts';

export type ParamKind = 'x' | 'width' | 'amp' | 'positive' | 'offset' | 'slope' | 'q' | 'ratio' | 'index';
export type ParamDef = { key: string; label: string; kind: ParamKind; hint?: string };
export type ComponentType = 'baseline' | 'lorentz' | 'gauss' | 'fano' | 'coupled';
// mode2: how the tunable mode of the dispersion depends on x (linear, or a cavity vs the angle θ in degrees)
export type Mode2Model = 'linear' | 'angle';
export type ModelCtx = { energy: boolean; xref: number; mode2?: Mode2Model };
type Params = Record<string, number>;

const lorentz = (x: number, x0: number, w: number) => 1 / (1 + ((2 * (x - x0)) / w) ** 2);

// Energy (or x itself) and width conversions for the coupled-oscillator models.
const toE = (x: number, c: ModelCtx) => (c.energy ? HC_EV_NM / x : x);
// Energy width γ whose wavelength width at `at` is exactly w: hc/(E − γ/2) − hc/(E + γ/2) = w.
// So a Γ given in nm is the FWHM measured on the λ axis, and Ω the branch separation in nm.
const widthE = (w: number, at: number, c: ModelCtx) => {
  if (!c.energy) return w;
  if (w === 0) return 0;
  const E = HC_EV_NM / at;
  return (2 * (Math.sqrt(HC_EV_NM ** 2 + w * w * E * E) - HC_EV_NM)) / w;
};

// The energies and rates of a coupled-oscillator parameter set, computed once per set (a fit evaluates the model on
// every point with the same parameter object).
type CoupledConsts = { c: ModelCtx; x1: number; x2: number; w1: number; w2: number; W: number; E1: number; E2: number; g1: number; g2: number; g: number };
const coupledCache = new WeakMap<Params, CoupledConsts>();
function coupledConsts(p: Params, c: ModelCtx): CoupledConsts {
  const k = coupledCache.get(p);
  if (k && k.c === c && k.x1 === p.x1 && k.x2 === p.x2 && k.w1 === p.w1 && k.w2 === p.w2 && k.W === p.W) return k;
  const mid = (p.x1 + p.x2) / 2;
  const v = { c, x1: p.x1, x2: p.x2, w1: p.w1, w2: p.w2, W: p.W, E1: toE(p.x1, c), E2: toE(p.x2, c), g1: widthE(p.w1, p.x1, c), g2: widthE(p.w2, p.x2, c), g: widthE(p.W, mid, c) / 2 };
  coupledCache.set(p, v);
  return v;
}

export const COMPONENTS: Record<ComponentType, { label: string; params: ParamDef[]; note: string; f: (x: number, p: Params, c: ModelCtx) => number }> = {
  baseline: {
    label: 'Baseline',
    note: 'c + s·(x − x_mid)',
    params: [
      { key: 'c', label: 'c', kind: 'offset' },
      { key: 's', label: 's (slope)', kind: 'slope' },
    ],
    f: (x, p, c) => p.c + p.s * (x - c.xref),
  },
  lorentz: {
    label: 'Lorentzian',
    note: 'A / (1 + (2(x − x₀)/Γ)²); A < 0 for a dip',
    params: [
      { key: 'A', label: 'A', kind: 'amp' },
      { key: 'x0', label: 'x₀', kind: 'x' },
      { key: 'w', label: 'Γ (FWHM)', kind: 'width' },
    ],
    f: (x, p) => p.A * lorentz(x, p.x0, p.w),
  },
  gauss: {
    label: 'Gaussian',
    note: 'A·exp(−4 ln2 (x − x₀)²/Γ²) (Γ = FWHM = 2√(2 ln2)·σ); A < 0 for a dip',
    params: [
      { key: 'A', label: 'A', kind: 'amp' },
      { key: 'x0', label: 'x₀', kind: 'x' },
      { key: 'w', label: 'Γ (FWHM)', kind: 'width' },
    ],
    f: (x, p) => p.A * Math.exp((-4 * Math.LN2 * (x - p.x0) ** 2) / (p.w * p.w)),
  },
  fano: {
    label: 'Fano',
    note: 'A·[(q + ε)²/(1 + ε²) − 1]/(1 + q²), ε = 2(x − x₀)/Γ, A ≥ 0; q → ±∞ peak, q = 0 dip (with a constant, (A, q) and (−A, −1/q) would be the same curve)',
    params: [
      { key: 'A', label: 'A (≥ 0)', kind: 'positive' },
      { key: 'x0', label: 'x₀', kind: 'x' },
      { key: 'w', label: 'Γ', kind: 'width' },
      { key: 'q', label: 'q (asymmetry)', kind: 'q' },
    ],
    f: (x, p) => {
      const e = (2 * (x - p.x0)) / p.w;
      return (p.A * ((p.q + e) ** 2 / (1 + e * e) - 1)) / (1 + p.q * p.q);
    },
  },
  coupled: {
    label: 'Coupled oscillators',
    note: 'y = A·(γ₁/2)·Im[G₁₁ + r·G₂₂ + 2√r·G₁₂], G = (H − E)⁻¹, H = [[E₁ − iγ₁/2, g], [g, E₂ − iγ₂/2]]; Ω = 2g',
    params: [
      { key: 'A', label: 'A', kind: 'amp' },
      { key: 'x1', label: 'mode 1', kind: 'x' },
      { key: 'w1', label: 'Γ₁', kind: 'width' },
      { key: 'x2', label: 'mode 2', kind: 'x' },
      { key: 'w2', label: 'Γ₂', kind: 'width' },
      { key: 'W', label: 'Ω (splitting)', kind: 'width', hint: 'Separation of the two modes at zero detuning (x₁ = x₂)' },
      { key: 'r', label: 'r (mode 2 brightness)', kind: 'ratio' },
    ],
    f: (x, p, c) => {
      const E = toE(x, c);
      const { E1, E2, g1, g2, g } = coupledConsts(p, c);
      // a = E1 − E − iγ1/2, b = E2 − E − iγ2/2, det = ab − g²
      const [ar, ai, br, bi] = [E1 - E, -g1 / 2, E2 - E, -g2 / 2];
      const dr = ar * br - ai * bi - g * g;
      const di = ar * bi + ai * br;
      const r = Math.max(0, p.r);
      // numerator: b + r·a + 2√r·g
      const nr = br + r * ar + 2 * Math.sqrt(r) * g;
      const ni = bi + r * ai;
      const q = dr * dr + di * di;
      const im = (ni * dr - nr * di) / q;
      return p.A * (g1 / 2) * im;
    },
  },
};

export type FitParam = { value: number; fixed: boolean };

// A component with neutral starting values (use guessSpectrum to place it on the data).
export function newComponent(type: ComponentType): FitComponent {
  const start: Record<ParamKind, number> = { x: 0, width: 1, amp: -0.5, positive: 0.5, offset: 1, slope: 0, q: 0, ratio: 0, index: 1.5 };
  return {
    id: Math.random().toString(36).slice(2, 8),
    type,
    params: Object.fromEntries(COMPONENTS[type].params.map((p) => [p.key, { value: start[p.kind], fixed: type === 'coupled' && p.key === 'r' }])),
  };
}

// Unit of a parameter from the units of x and y.
export const paramUnit = (kind: ParamKind, xUnit: string, yUnit: string) =>
  kind === 'x' || kind === 'width'
    ? xUnit
    : kind === 'amp' || kind === 'positive' || kind === 'offset'
      ? yUnit
      : kind === 'slope'
        ? `${yUnit || '1'}/${xUnit || '1'}`
        : '';
export type FitComponent = { id: string; type: ComponentType; params: Record<string, FitParam> };

export const modelAt = (comps: FitComponent[], x: number, c: ModelCtx) =>
  comps.reduce((s, k) => s + COMPONENTS[k.type].f(x, values(k), c), 0);

export const values = (k: FitComponent): Params => Object.fromEntries(Object.entries(k.params).map(([n, p]) => [n, p.value]));

// ---- Coupled-oscillator dispersion: two branches vs a tuning parameter x ----

export const DISPERSION: ParamDef[] = [
  { key: 'x1', label: 'mode 1 (fixed)', kind: 'x', hint: 'uncoupled resonance that does not tune (e.g. exciton)' },
  { key: 'a', label: 'mode 2 at x_mid', kind: 'x', hint: 'uncoupled tunable mode (e.g. cavity) at the middle of the x range' },
  { key: 'b', label: 'mode 2 slope', kind: 'slope', hint: 'change of mode 2 per unit of x' },
  { key: 'W', label: 'Ω (splitting)', kind: 'width', hint: 'Branch separation at zero detuning (mode 2 = mode 1)' },
];
// Cavity vs angle: E_c(θ) = E₀ / √(1 − sin²θ / n_eff²) (λ_c(θ) = λ₀ √(1 − sin²θ / n_eff²) on a wavelength scale).
export const DISPERSION_ANGLE: ParamDef[] = [
  DISPERSION[0],
  { key: 'a', label: 'mode 2 at θ = 0', kind: 'x', hint: 'uncoupled cavity mode at normal incidence (E₀ or λ₀)' },
  { key: 'n', label: 'n_eff', kind: 'index', hint: 'effective index of the cavity mode: E_c(θ) = E₀/√(1 − sin²θ/n_eff²)' },
  DISPERSION[3],
];
export const dispersionParams = (m?: Mode2Model) => (m === 'angle' ? DISPERSION_ANGLE : DISPERSION);

// The uncoupled mode 2 at x, in the units of the branches (NaN beyond the cut-off of the angle model).
export function mode2At(x: number, p: Params, c: ModelCtx): number {
  if (c.mode2 !== 'angle') return p.a + p.b * (x - c.xref);
  const s = Math.sin((x * Math.PI) / 180) / p.n;
  const f = 1 - s * s;
  if (!(f > 0)) return NaN;
  // a wavelength shortens as the energy grows; any other branch unit is taken as energy-like
  return c.energy ? p.a * Math.sqrt(f) : p.a / Math.sqrt(f);
}

// x at zero detuning (mode 2 = mode 1).
export function crossingOf(p: Params, c: ModelCtx): number {
  if (c.mode2 !== 'angle') return c.xref + (p.x1 - p.a) / p.b;
  const r = c.energy ? p.x1 / p.a : p.a / p.x1;
  const s2 = p.n * p.n * (1 - r * r);
  return s2 >= 0 && s2 <= 1 ? (Math.asin(Math.sqrt(s2)) * 180) / Math.PI : NaN;
}

// Positions of the two branches at x, ascending.
export function branches(x: number, p: Params, c: ModelCtx): [number, number] {
  const E1 = toE(p.x1, c);
  const Ec = toE(mode2At(x, p, c), c);
  const g = widthE(p.W, p.x1, c) / 2;
  const s = Math.sqrt(g * g + ((E1 - Ec) / 2) ** 2);
  const [hi, lo] = [(E1 + Ec) / 2 + s, (E1 + Ec) / 2 - s];
  return c.energy ? [HC_EV_NM / hi, HC_EV_NM / lo] : [lo, hi];
}

// ---- Initial guesses from the data ----

// Crude peak/dip estimates: baseline from the window edges, then the strongest deviations.
export function guessSpectrum(comps: FitComponent[], xs: ArrayLike<number>, ys: ArrayLike<number>): FitComponent[] {
  const n = xs.length;
  const edge = Math.max(1, Math.floor(n / 20));
  let base = 0;
  for (let i = 0; i < edge; i++) base += ys[i] + ys[n - 1 - i];
  base /= 2 * edge;
  const dev = Array.from(ys, (y) => y - base);
  const used: [number, number][] = [];
  const nextFeature = () => {
    let k = -1;
    for (let i = 0; i < n; i++) {
      if (used.some(([a, b]) => xs[i] >= a && xs[i] <= b)) continue;
      if (k < 0 || Math.abs(dev[i]) > Math.abs(dev[k])) k = i;
    }
    if (k < 0) return { x0: (xs[0] + xs[n - 1]) / 2, A: 0, w: (xs[n - 1] - xs[0]) / 10 };
    const half = Math.abs(dev[k]) / 2;
    let a = k;
    let b = k;
    while (a > 0 && Math.abs(dev[a]) > half) a--;
    while (b < n - 1 && Math.abs(dev[b]) > half) b++;
    const w = Math.max(xs[b] - xs[a], Math.abs(xs[1] - xs[0]) * 2);
    used.push([xs[k] - w, xs[k] + w]);
    return { x0: xs[k], A: dev[k], w };
  };
  const set = (k: FitComponent, v: Params) => ({
    ...k,
    params: Object.fromEntries(Object.entries(k.params).map(([name, p]) => [name, p.fixed || !(name in v) ? p : { ...p, value: v[name] }])),
  });
  return comps.map((k) => {
    if (k.type === 'baseline') return set(k, { c: base, s: 0 });
    if (k.type === 'lorentz' || k.type === 'gauss') return set(k, nextFeature());
    if (k.type === 'fano') {
      const f = nextFeature();
      // q = 0: a dip of depth A; large q: a peak of height ≈ A
      return set(k, f.A < 0 ? { ...f, A: -f.A, q: 0 } : { ...f, q: 5 });
    }
    const f1 = nextFeature();
    const f2 = nextFeature();
    const [m1, m2] = f1.x0 < f2.x0 ? [f1, f2] : [f2, f1];
    const W = Math.abs(m2.x0 - m1.x0) * 0.8;
    const mid = (m1.x0 + m2.x0) / 2;
    return set(k, { A: m1.A * 1.5, x1: mid, x2: mid, w1: Math.min(m1.w, m2.w), w2: Math.min(m1.w, m2.w), W, r: 0 });
  });
}

// Guess for the dispersion: λ_short + λ_long ≈ mode 1 + mode 2(x); Ω from the smallest gap.
// Angle model: mode 2² (or 1/mode 2²) is linear in sin²θ, fitted by least squares.
export function guessDispersion(xs: number[], short: number[], long: number[], xref: number, c?: ModelCtx): Params {
  let k = 0;
  for (let i = 1; i < xs.length; i++) if (long[i] - short[i] < long[k] - short[k]) k = i;
  const x1 = (short[k] + long[k]) / 2;
  const s = xs.map((_, i) => short[i] + long[i] - x1);
  if (c?.mode2 === 'angle') {
    const t = xs.map((x) => Math.sin((x * Math.PI) / 180) ** 2);
    const y = s.map((v) => (c.energy ? v * v : 1 / (v * v)));
    const [A, B] = lineFit(t, y);
    const a = c.energy ? Math.sqrt(Math.max(A, 0)) : 1 / Math.sqrt(Math.max(A, 1e-300));
    const n = B < 0 && A > 0 ? Math.sqrt(-A / B) : 1.5;
    return { x1, a: Number.isFinite(a) && a > 0 ? a : x1, n: Math.min(Math.max(n, 1), 5), W: long[k] - short[k] };
  }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = s.reduce((a, b) => a + b, 0) / s.length;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (s[i] - my);
    sxx += (x - mx) ** 2;
  });
  const b = sxx ? sxy / sxx : 0;
  return { x1, a: my + b * (xref - mx), b, W: long[k] - short[k] };
}

// Least-squares line y = A + B·t.
function lineFit(t: number[], y: number[]): [number, number] {
  const mt = t.reduce((a, b) => a + b, 0) / t.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sty = 0;
  let stt = 0;
  t.forEach((v, i) => {
    sty += (v - mt) * (y[i] - my);
    stt += (v - mt) ** 2;
  });
  const B = stt ? sty / stt : 0;
  return [my - B * mt, B];
}

// Slider range from the data window, widened to include the current value.
export function rangeFor(kind: ParamKind, value: number, x: [number, number], y: [number, number]): [number, number] {
  const xr = x[1] - x[0] || 1;
  const yr = y[1] - y[0] || 1;
  const r: Record<ParamKind, [number, number]> = {
    x: [x[0] - 0.1 * xr, x[1] + 0.1 * xr],
    width: [0, xr],
    amp: [-2 * yr, 2 * yr],
    positive: [0, 2 * yr],
    offset: [y[0] - yr, y[1] + yr],
    slope: [(-2 * yr) / xr, (2 * yr) / xr],
    q: [-20, 20],
    ratio: [0, 5],
    index: [1, 4],
  };
  const [lo, hi] = r[kind];
  return Number.isFinite(value) ? [Math.min(lo, value), Math.max(hi, value)] : [lo, hi];
}

// Rates of a coupled-oscillator component in energy (eV): coupling g = Ω/2 and the widths (FWHM) γ₁, γ₂ of the two
// modes. The same model as the temporal coupled-mode theory A ∝ Im{(ω − ω₂ + iγ₂/2) / [κ² − (ω − ω₁ + iγ₁/2)(ω − ω₂ +
// iγ₂/2)]}: κ = g/ħ, and κ_T = (γ₁ − γ₂)/4 is the threshold above which the modes split (Autler–Townes).
export const HBAR_EVS = 6.582119569e-16;
export function coupledRates(p: Record<string, number>, c: ModelCtx) {
  const mid = (p.x1 + p.x2) / 2;
  return { g: widthE(p.W, mid, c) / 2, g1: widthE(p.w1, p.x1, c), g2: widthE(p.w2, p.x2, c) };
}

// A width Ω (branch separation) given on the wavelength axis at `at` (nm) as an energy (eV).
export const energyWidth = (w: number, at: number) => widthE(w, at, { energy: true, xref: at });
