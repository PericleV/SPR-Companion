// The metrics a project defines: each a reduction of a computed curve (R by default; T, A, the phases, a computed
// quantity) in its own region of interest (ROI) — the minimum or maximum, the FWHM of a dip or the width of a band, the
// sensitivity to an index change of a medium / block / cavity, the figure of merit, the penetration depth of the field
// into a medium and the propagation length of the mode, a fit by components (Lorentzian, Fano, coupled oscillators…), a
// match with a target curve, a custom formula of the other metrics, and (sweeps) the coupled-oscillator dispersion of
// two branches. Each metric gives named quantities (e.g. the minimum: its position and the value there), referred to
// as `ref.quantity` in formulas and exposed for the optimization's objectives. In sweeps the ROI can follow a parameter
// (a zone of points (value, lo, hi) edited on the maps). Pure: runs in the workers.
import { extremum, halfWidth, windowOf, zoneAt } from '../engine/metrics.ts';
import { branches, COMPONENTS, coupledRates, crossingOf, dispersionParams, guessDispersion, guessSpectrum, HBAR_EVS, mode2At, modelAt, type ComponentType, type FitComponent, type ModelCtx } from '../engine/fitmodels.ts';
import { fitDispersion, fitSpectrum } from '../engine/fitrun.ts';
import { HC_EV_NM } from '../physics/materials.ts';
import { compile } from '../engine/expr.ts';
import { ghOfSlope, phaseSlope } from './compute.ts';

export type SensTarget = { kind: 'exit' } | { kind: 'incident' } | { kind: 'block'; block: string } | { kind: 'cavity'; block: string; index: number };
export type MetricKind = 'min' | 'max' | 'fwhm' | 'sens' | 'fom' | 'phase' | 'gh' | 'penetration' | 'propagation' | 'fit' | 'match' | 'zones' | 'custom';
export type Feature = 'dip' | 'peak'; // a resonance (R minimum) or a band of high R (DBR stop band)
export type ZonePt = { y: number; lo: number; hi: number };

// match: the curve compared with a target model (made of fit components) — MSE, or MSE + λ·(max error)², optionally
// only where the target is below a level (the resonances)
export type MatchSettings = { comps: FitComponent[]; cost: 'mse' | 'msemax'; lambdaMax: number; below: number };
// zones: regions of the axis where a quantity (its mean, minimum, maximum or integral) is to be maximized or minimized
export type ZoneStat = 'mean' | 'min' | 'max' | 'int';
export type Zone = { id: string; lo: number; hi: number; field: string; stat: ZoneStat; goal: 'max' | 'min' };
// a fit of the spectrum by components, or of two branches (two curves, e.g. the positions of two resonances vs a swept
// parameter) by the coupled-oscillator dispersion (mode 2 linear in the parameter, or a cavity vs the angle)
export type FitSettings = {
  comps: FitComponent[];
  guess: boolean;
  run?: boolean;
  parts?: boolean; // (older projects: every component drawn or none)
  mode?: 'spectrum' | 'dispersion';
  model?: 'linear' | 'angle'; // dispersion
  show?: { start?: boolean; fitted?: boolean; comps?: Record<string, boolean> }; // the overlays drawn (default all)
};

export type Metric = {
  id: string;
  ref: string; // name in formulas: ref.quantity
  label: string;
  on: boolean;
  kind: MetricKind;
  color?: string; // its colour on the plots (absent: one of the default colours, by its place in the list)
  // the data: the response (absent) or the values of the metrics along an axis ('metrics:<axis>'), e.g. the positions
  // of two resonances vs a swept thickness (then long is one of their axes)
  source?: string;
  field?: string; // the curve reduced (R when absent)
  field2?: string; // the second branch of a dispersion fit
  feature: Feature; // fwhm, sens, fom, penetration, propagation
  lo: number; // ROI (NaN = the end of the scan)
  hi: number;
  dn: number; // sens, fom
  target: SensTarget; // sens, fom: what Δn changes; penetration: the medium the field decays into
  // fit: start components; guess: placed on the data before each fit; run: fitted (Fit pressed) or only the start shown;
  // parts: each component drawn
  fit?: FitSettings;
  match?: MatchSettings;
  zones?: Zone[];
  expr?: string; // custom
  expose?: string[]; // quantities exposed as objectives (Optimization)
  along?: string; // sweeps: the axis the metric is computed along (an axis id; the scanned quantity when absent)
  // the ROI along another axis (sweeps): zone points (value, lo, hi), or a polygon drawn on a map ([along, other])
  follow?: { param: string; pts: ZonePt[]; poly?: [number, number][] };
  plot?: string; // the plot its marks are drawn on and its ROI drawn on (absent: every plot that shows its curve)
};

export const KIND_LABEL: Record<MetricKind, string> = {
  min: 'Minimum',
  max: 'Maximum',
  fwhm: 'FWHM / band width',
  sens: 'Sensitivity',
  fom: 'Figure of merit',
  phase: 'Phase (interrogation)',
  gh: 'Goos–Hänchen shift',
  penetration: 'Field (penetration, |E|², absorption)',
  propagation: 'Propagation length',
  fit: 'Fit',
  match: 'Match a target curve',
  zones: 'Zones (max / min)',
  custom: 'Custom (formula)',
};

export type Quantity = { key: string; label: string; unit: (scan: string) => string };
const POS = (label: string): Quantity => ({ key: 'pos', label, unit: (u) => u });
const VAL = (label = 'value'): Quantity => ({ key: 'R', label, unit: () => '' });
const TYPE_TAG: Record<ComponentType, string> = { baseline: 'B', lorentz: 'L', gauss: 'G', fano: 'F', coupled: 'C' };

// Quantity keys of the fit components: L1_x0, L1_w, F1_q … (the first Lorentzian, …).
export function fitKeys(comps: FitComponent[]): { key: string; ci: number; param: string; label: string; kind: string }[] {
  const seen: Record<string, number> = {};
  return comps.flatMap((c, ci) => {
    const tag = `${TYPE_TAG[c.type]}${(seen[c.type] = (seen[c.type] ?? 0) + 1)}`;
    return COMPONENTS[c.type].params.map((d) => ({ key: `${tag}_${d.key}`, ci, param: d.key, label: `${tag} ${d.label}`, kind: d.kind }));
  });
}
// The rates of the coupled-oscillator components: Cn_kappa (coupling κ = g/ħ), Cn_kappaT (threshold (γ₁ − γ₂)/4),
// Cn_g1, Cn_g2 (widths), in 10¹² rad/s; Cn_rabi = Ω in meV.
function coupledKeys(comps: FitComponent[]) {
  let n = 0;
  return comps.flatMap((c, ci) => (c.type === 'coupled' ? [{ tag: `C${++n}`, ci }] : []));
}

const fieldLabel = (f?: string) => (!f || f === 'R' ? 'R' : f);

// The quantities of a metric (the first is the main one).
export function quantitiesOf(m: Pick<Metric, 'kind' | 'feature' | 'fit' | 'field' | 'zones'>, spectral: boolean): Quantity[] {
  const peak = m.feature === 'peak';
  const f = fieldLabel(m.field);
  switch (m.kind) {
    case 'min':
      return [POS('position of the minimum'), VAL(`${f} there`)];
    case 'max':
      return [POS('position of the maximum'), VAL(`${f} there`)];
    case 'fwhm':
      return [
        { key: 'width', label: peak ? 'band width (at half height)' : 'FWHM', unit: (u) => u },
        POS(peak ? 'band centre' : 'resonance'),
        { key: 'depth', label: peak ? 'height' : 'depth', unit: () => '' },
        VAL(`${f} at the extremum`),
        ...(spectral ? [{ key: 'q', label: 'Q = position / width', unit: () => '' }] : []),
      ];
    case 'sens':
      return [{ key: 'S', label: 'sensitivity S', unit: (u) => `${u}/RIU` }, POS(peak ? 'band centre' : 'resonance'), { key: 'shifted', label: 'position with n + Δn', unit: (u) => u }];
    case 'phase':
      return [
        { key: 'slope', label: 'largest phase slope dφr/dx', unit: (u) => (u ? `°/${u}` : '') },
        POS('position of the largest slope'),
        { key: 'jump', label: 'phase change across the region', unit: () => '°' },
        { key: 'Sphi', label: 'phase sensitivity Δφr/Δn there', unit: () => '°/RIU' },
      ];
    case 'gh':
      return [
        { key: 'gh', label: 'GH shift −(1/2π) dφr/dθ (largest |·|)', unit: () => 'λ' },
        POS('position of the largest |GH|'),
        { key: 'D', label: 'beam displacement ⊥ beam, λ GH / n₁', unit: () => 'µm' },
        { key: 'Sgh', label: 'GH sensitivity: the largest ΔGH/Δn in the region', unit: () => 'λ/RIU' },
      ];
    case 'fom':
      return [{ key: 'fom', label: 'FOM = |S| / width', unit: () => '1/RIU' }, { key: 'S', label: 'sensitivity S', unit: (u) => `${u}/RIU` }, { key: 'width', label: peak ? 'band width' : 'FWHM', unit: (u) => u }, POS(peak ? 'band centre' : 'resonance')];
    case 'penetration':
      return [
        { key: 'depth', label: 'penetration depth (|E|² / e)', unit: () => 'nm' },
        POS(peak ? 'at the band centre' : 'at the resonance'),
        { key: 'peak', label: '|E|² at its interface', unit: () => '' },
        { key: 'E2max', label: 'largest |E|² in the layers', unit: () => '' },
        { key: 'absorbed', label: 'fraction absorbed in it (exit: transmitted)', unit: () => '' },
      ];
    case 'propagation':
      return [{ key: 'L', label: 'propagation length', unit: () => 'µm' }, { key: 'width', label: 'FWHM', unit: (u) => u }, POS('resonance')];
    case 'fit':
      if (m.fit?.mode === 'dispersion')
        // (the branches' unit: that of their positions; Ω in meV when they are wavelengths)
        return [
          { key: 'W', label: 'Ω (branch separation at zero detuning)', unit: () => '' },
          { key: 'rabi', label: 'Ω (Rabi splitting, branches in nm)', unit: () => 'meV' },
          { key: 'x1', label: 'mode 1 (fixed)', unit: () => '' },
          ...(m.fit.model === 'angle'
            ? [{ key: 'a', label: 'mode 2 at θ = 0', unit: () => '' }, { key: 'n', label: 'n_eff', unit: () => '' }]
            : [{ key: 'a', label: 'mode 2 at the middle', unit: () => '' }, { key: 'b', label: 'mode 2 slope', unit: () => '' }]),
          { key: 'crossing', label: 'zero detuning at', unit: (u: string) => u },
          { key: 'r2', label: 'R² of the fit', unit: () => '' },
        ];
      return [
        { key: 'r2', label: 'R² of the fit', unit: () => '' },
        ...fitKeys(m.fit?.comps ?? []).map((k) => ({ key: k.key, label: k.label, unit: (u: string) => (k.kind === 'x' || k.kind === 'width' ? u : '') })),
        ...coupledKeys(m.fit?.comps ?? []).flatMap(({ tag }) => [
          { key: `${tag}_kappa`, label: `${tag} κ (coupling)`, unit: () => '10¹² rad/s' },
          { key: `${tag}_kappaT`, label: `${tag} κT = (γ₁ − γ₂)/4`, unit: () => '10¹² rad/s' },
          { key: `${tag}_g1`, label: `${tag} γ₁`, unit: () => '10¹² rad/s' },
          { key: `${tag}_g2`, label: `${tag} γ₂`, unit: () => '10¹² rad/s' },
          { key: `${tag}_rabi`, label: `${tag} Ω`, unit: () => 'meV' },
        ]),
        { key: 'rmse', label: 'RMSE', unit: () => '' },
      ];
    case 'match':
      return [{ key: 'cost', label: 'match cost', unit: () => '' }, { key: 'mse', label: 'mean squared error', unit: () => '' }, { key: 'maxErr', label: 'largest error', unit: () => '' }];
    case 'custom':
      return [{ key: 'value', label: 'value', unit: () => '' }];
    case 'zones':
      return [
        { key: 'score', label: 'score = Σ (max zones) − Σ (min zones)', unit: () => '' },
        ...(m.zones ?? []).map((z, i) => ({ key: `z${i + 1}`, label: `zone ${i + 1}: ${z.stat === 'int' ? '∫' : z.stat} ${z.field || 'R'} (${z.goal === 'max' ? 'maximize' : 'minimize'})`, unit: () => '' })),
      ];
  }
}

export const usesShift = (m: Metric) => m.on && (m.kind === 'sens' || m.kind === 'fom' || m.kind === 'phase' || m.kind === 'gh') && m.dn !== 0;
// the phase and GH metrics also need the phase of r with n + Δn
export const usesPhaseShift = (m: Metric) => usesShift(m) && (m.kind === 'phase' || m.kind === 'gh');
export const phaseShiftKey = (m: Pick<Metric, 'dn' | 'target'>) => `${shiftKey(m)}:phi`;
// Key of the perturbed scan a sensitivity metric needs (metrics with the same target and Δn share one).
export const shiftKey = (m: Pick<Metric, 'dn' | 'target'>) => `${JSON.stringify(m.target)}|${m.dn}`;

// Marks of a metric on the curve; fit / match: the models over the ROI (start, fitted, each part; the target).
export type Marks = {
  x?: number;
  y?: number;
  x1?: number;
  x2?: number;
  level?: number;
  shifted?: number;
  shiftKey?: string;
  fit?: { x: number[]; start: number[]; fitted: number[]; parts?: number[][]; ids?: string[] };
  disp?: { x: number[]; lower: number[]; upper: number[]; mode1: number[]; mode2: number[] }; // the fitted branches, the uncoupled modes
  zones?: { lo: number; hi: number; goal: 'max' | 'min'; value: number; label: string }[];
};
export type MetricResult = { values: Record<string, number>; marks: Marks; error?: string };

// What some metrics need beyond the curve: the fixed λ or θ of the curve, the incident index, the field.
export type MetricContext = {
  scan: 'theta' | 'lambda';
  lambda: number; // the fixed one (or the curve's at a point)
  theta: number;
  np: (lambda: number) => number; // the real index of the incident medium
  // the field at x: the 1/e depth of |E|² in a medium (NaN: no decay there), |E|² at its first interface, the largest
  // |E|² in the layers, the fraction of the incident power absorbed in it
  depth?: (x: number, target: SensTarget) => { depth: number; peak: number; E2max?: number; absorbed?: number } | null;
  branchesNm?: boolean; // metrics of metrics: the values are positions on a wavelength axis (dispersion fits in energy)
};

const EMPTY = (m: Metric, spectral: boolean, error?: string): MetricResult => ({ values: Object.fromEntries(quantitiesOf(m, spectral).map((q) => [q.key, NaN])), marks: {}, ...(error ? { error } : {}) });

// The local extremum of the kind nearest to x0 in [i0, i1], refined by a parabola.
export function nearestExtremum(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, x0: number, kind: 'min' | 'max') {
  const s = kind === 'min' ? 1 : -1;
  let best = -1;
  for (let i = Math.max(i0, 1); i <= Math.min(i1, xs.length - 2); i++)
    if (s * ys[i] < s * ys[i - 1] && s * ys[i] <= s * ys[i + 1] && (best < 0 || Math.abs(xs[i] - x0) < Math.abs(xs[best] - x0))) best = i;
  if (best < 0) return extremum(xs, ys, i0, i1, kind);
  return extremum(xs, ys, best - 1, best + 1, kind);
}

// Edges of a band: the widest run of samples at or above `level` in [i0, i1], joined across gaps narrower than `gap`
// to neighbouring runs that are wide themselves (the two halves of a stop band around a cavity mode) but not to the
// narrow side lobes beside the band; edges interpolated at the crossings.
export function bandEdges(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, level: number, gap: number): [number, number] {
  const runs: [number, number][] = [];
  for (let i = i0; i <= i1; i++) {
    if (!(ys[i] >= level)) continue;
    let j = i;
    while (j + 1 <= i1 && ys[j + 1] >= level) j++;
    runs.push([i, j]);
    i = j;
  }
  if (!runs.length) return [NaN, NaN];
  const width = (r: [number, number]) => xs[r[1]] - xs[r[0]];
  let k = runs.reduce((p, r, i) => (width(r) > width(runs[p]) ? i : p), 0);
  const core = width(runs[k]);
  let [a, b] = runs[k];
  for (let l = k - 1; l >= 0 && xs[a] - xs[runs[l][1]] < gap && width(runs[l]) >= 0.25 * core; l--) a = runs[l][0];
  for (k = k + 1; k < runs.length && xs[runs[k][0]] - xs[b] < gap && width(runs[k]) >= 0.25 * core; k++) b = runs[k][1];
  const cross = (i: number, l: number) => xs[i] + ((level - ys[i]) / (ys[l] - ys[i])) * (xs[l] - xs[i]);
  return [a > i0 ? cross(a - 1, a) : xs[a], b < i1 ? cross(b, b + 1) : xs[b]];
}

// Width of the feature: a dip at half depth (between its minimum and the highest value of the ROI), a band at half
// height with its edges from bandEdges.
function widthOf(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, feature: Feature) {
  const w = halfWidth(xs, ys, i0, i1, feature, 'local');
  if (!Number.isFinite(w.center)) return null;
  if (feature === 'peak') {
    [w.x1, w.x2] = bandEdges(xs, ys, i0, i1, w.level, 0.05 * (xs[i1] - xs[i0]));
    return { ...w, pos: (w.x1 + w.x2) / 2, width: w.x2 - w.x1 };
  }
  return { ...w, pos: w.center, width: w.x2 - w.x1 };
}

// The position of the feature on a perturbed curve: the dip followed (the local minimum nearest to `x0`, in the ROI
// widened by half its span), or the band centre.
function shiftedPos(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, feature: Feature, x0: number, level: number) {
  if (feature === 'peak') {
    const [a, b] = bandEdges(xs, ys, i0, i1, level, 0.05 * (xs[i1] - xs[i0]));
    return (a + b) / 2;
  }
  const span = xs[i1] - xs[i0];
  const [j0, j1] = windowOf(xs, xs[i0] - span / 2, xs[i1] + span / 2);
  // the local minimum nearest the dip among those as deep as its half-depth level (a shallow ripple is not the dip;
  // none: the dip left the scan)
  let best = -1;
  for (let i = Math.max(j0, 1); i <= Math.min(j1, xs.length - 2); i++)
    if (ys[i] < ys[i - 1] && ys[i] <= ys[i + 1] && (!Number.isFinite(level) || ys[i] < level) && (best < 0 || Math.abs(xs[i] - x0) < Math.abs(xs[best] - x0))) best = i;
  return best < 0 ? NaN : extremum(xs, ys, best - 1, best + 1, 'min').x;
}

// The ROI of a metric: its own, or the zone at the value of the followed parameter (`at`: values by axis id).
export function roiOf(m: Metric, at?: Record<string, number>): [number, number] {
  const v = m.follow && at ? at[m.follow.param] : undefined;
  if (v !== undefined && Number.isFinite(v)) {
    if (m.follow!.poly && m.follow!.poly.length >= 3) return polyRoi(m.follow!.poly, v);
    if (m.follow!.pts.length) return zoneAt(m.follow!.pts, v);
  }
  return [m.lo, m.hi];
}

// A closed region from zone points (value, lo, hi): the lo edge up, the hi edge down; [along, other] vertices.
export const polyOfZone = (pts: ZonePt[]): [number, number][] => {
  const s = [...pts].sort((a, b) => a.y - b.y);
  return [...s.map((p): [number, number] => [p.lo, p.y]), ...s.reverse().map((p): [number, number] => [p.hi, p.y])];
};

// An empty ROI (from > to: no sample in it; NaN bounds would mean the whole scan).
export const NO_ROI: [number, number] = [Number.MAX_VALUE, -Number.MAX_VALUE];

// The ROI a polygon ([along, other] vertices) gives on the line other = v: from its first to its last crossing; none
// (outside the polygon): an empty ROI.
export function polyRoi(poly: [number, number][], v: number): [number, number] {
  const xs: number[] = [];
  // every crossing of the line (its edges included: a line through a corner or along the top / bottom edge counts)
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    if (a[1] === b[1]) {
      if (a[1] === v) xs.push(a[0], b[0]);
    } else if (v >= Math.min(a[1], b[1]) && v <= Math.max(a[1], b[1])) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  if (!xs.length) return NO_ROI;
  return [Math.min(...xs), Math.max(...xs)];
}

const slice = (a: ArrayLike<number>, i0: number, i1: number) => Array.from({ length: i1 - i0 + 1 }, (_, i) => a[i0 + i]);
const modelCurve = (comps: FitComponent[], x: number[], ctx: ModelCtx) => x.map((v) => modelAt(comps, v, ctx));
const partsOf = (comps: FitComponent[], x: number[], ctx: ModelCtx) => comps.map((c) => modelCurve([c], x, ctx));

// The fit in the ROI from the start components (placed on the data first with `guess`). Before Fit is pressed (run
// off) only the start model is drawn and its values given. On a wavelength axis the coupled oscillators are computed
// in energy (spr-forge's fit models).
function evalFit(m: Metric, xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, spectral: boolean): MetricResult {
  const comps = m.fit?.comps ?? [];
  if (!comps.length) return EMPTY(m, spectral, 'Add components to the fit.');
  const x = slice(xs, i0, i1);
  const y = slice(ys, i0, i1);
  if (x.length < 5 || y.some((v) => !Number.isFinite(v))) return EMPTY(m, spectral, 'Too few points in the ROI.');
  const ctx: ModelCtx = { energy: spectral, xref: (x[0] + x[x.length - 1]) / 2 };
  const start = m.fit?.guess ? guessSpectrum(comps, x, y) : comps;
  const startY = modelCurve(start, x, ctx);
  const valuesOf = (cs: FitComponent[], model: number[]) => {
    let ssr = 0;
    let sst = 0;
    const mean = y.reduce((s, v) => s + v, 0) / y.length;
    y.forEach((v, i) => {
      ssr += (model[i] - v) ** 2;
      sst += (v - mean) ** 2;
    });
    const values: Record<string, number> = { r2: 1 - ssr / sst, rmse: Math.sqrt(ssr / y.length) };
    for (const k of fitKeys(cs)) values[k.key] = cs[k.ci].params[k.param].value;
    for (const { tag, ci } of coupledKeys(cs)) {
      const p = Object.fromEntries(Object.entries(cs[ci].params).map(([k, q]) => [k, q.value]));
      const r = coupledRates(p, ctx);
      const toRate = (e: number) => e / HBAR_EVS / 1e12; // eV → 10¹² rad/s
      values[`${tag}_kappa`] = toRate(r.g);
      values[`${tag}_g1`] = toRate(r.g1);
      values[`${tag}_g2`] = toRate(r.g2);
      values[`${tag}_kappaT`] = Math.abs(toRate(r.g1) - toRate(r.g2)) / 4;
      values[`${tag}_rabi`] = 2 * r.g * 1000;
    }
    return values;
  };
  // each component's curve (drawn or not: the metric's overlay settings)
  const ids = comps.map((c) => c.id);
  if (!m.fit?.run) return { values: valuesOf(start, startY), marks: { fit: { x, start: startY, fitted: [], parts: partsOf(start, x, ctx), ids } } };
  try {
    const r = fitSpectrum(start, x, y, ctx);
    const fitted = modelCurve(r.comps, x, ctx);
    return { values: valuesOf(r.comps, fitted), marks: { fit: { x, start: startY, fitted, parts: partsOf(r.comps, x, ctx), ids } } };
  } catch (e) {
    return EMPTY(m, spectral, e instanceof Error ? e.message : String(e));
  }
}

// Two branches (the curves ys, ys2 over the ROI of the axis xs) fitted with the coupled-oscillator dispersion: mode 1
// fixed, mode 2 linear in the parameter (or a cavity vs the angle); in energy when the branches are wavelengths.
function evalDispersion(m: Metric, xs: ArrayLike<number>, ys: ArrayLike<number>, ys2: ArrayLike<number>, i0: number, i1: number, spectral: boolean, nm: boolean): MetricResult {
  const model = m.fit?.model ?? 'linear';
  const keep: number[] = [];
  for (let i = i0; i <= i1; i++) if (Number.isFinite(ys[i]) && Number.isFinite(ys2[i])) keep.push(i);
  if (keep.length < 4) return EMPTY(m, spectral, 'Fewer than 4 points with both branches in the ROI.');
  const x = keep.map((i) => xs[i]);
  const short = keep.map((i) => Math.min(ys[i], ys2[i]));
  const long = keep.map((i) => Math.max(ys[i], ys2[i]));
  const xref = (x[0] + x[x.length - 1]) / 2;
  const ctx: ModelCtx = { energy: nm, xref, mode2: model };
  try {
    const guess = guessDispersion(x, short, long, xref, ctx);
    const r = fitDispersion(Object.fromEntries(dispersionParams(model).map((p) => [p.key, { value: guess[p.key], fixed: false }])), { xs: x, short, long }, ctx);
    const v = Object.fromEntries(Object.entries(r.params).map(([key, q]) => [key, q.value]));
    const crossing = crossingOf(v, ctx);
    const values: Record<string, number> = { W: v.W, x1: v.x1, a: v.a, ...(model === 'angle' ? { n: v.n } : { b: v.b }), crossing, r2: r.stats.r2, rabi: NaN };
    if (nm) {
      const [s, l] = branches(Number.isFinite(crossing) ? crossing : xref, v, ctx);
      values.rabi = (HC_EV_NM / s - HC_EV_NM / l) * 1000;
    }
    const all = Array.from(xs);
    const br = all.map((p) => branches(p, v, ctx));
    return { values, marks: { disp: { x: all, lower: br.map((b) => b[0]), upper: br.map((b) => b[1]), mode1: all.map(() => v.x1), mode2: all.map((p) => mode2At(p, v, ctx)) } } };
  } catch (e) {
    return EMPTY(m, spectral, e instanceof Error ? e.message : String(e));
  }
}

// Zones: in each, a statistic of a quantity (mean, min, max, integral over the axis) to maximize or minimize; the
// score adds those to maximize and subtracts those to minimize.
function evalZones(m: Metric, xs: ArrayLike<number>, curves: Record<string, ArrayLike<number>>, spectral: boolean): MetricResult {
  const zs = m.zones ?? [];
  if (!zs.length) return EMPTY(m, spectral, 'Add a zone.');
  const values: Record<string, number> = {};
  const marks: NonNullable<Marks['zones']> = [];
  let score = 0;
  zs.forEach((z, k) => {
    const ys = curves[z.field || 'R'];
    const [i0, i1] = windowOf(xs, z.lo, z.hi);
    let v = NaN;
    if (ys && i1 >= i0) {
      const pts: number[] = [];
      for (let i = i0; i <= i1; i++) if (Number.isFinite(ys[i])) pts.push(i);
      if (pts.length) {
        if (z.stat === 'min') v = Math.min(...pts.map((i) => ys[i]));
        else if (z.stat === 'max') v = Math.max(...pts.map((i) => ys[i]));
        else if (z.stat === 'int') {
          v = 0;
          for (let j = 1; j < pts.length; j++) v += ((ys[pts[j]] + ys[pts[j - 1]]) / 2) * (xs[pts[j]] - xs[pts[j - 1]]);
        } else v = pts.reduce((s, i) => s + ys[i], 0) / pts.length;
      }
    }
    values[`z${k + 1}`] = v;
    score += z.goal === 'max' ? v : -v;
    marks.push({ lo: Number.isFinite(z.lo) ? z.lo : xs[0], hi: Number.isFinite(z.hi) ? z.hi : xs[xs.length - 1], goal: z.goal, value: v, label: `z${k + 1}` });
  });
  values.score = score;
  return { values, marks: { zones: marks } };
}

// The curve compared with a target model in the ROI: MSE, or MSE + λ·(max error)² (spr-forge's curve match); with
// `below` < 1 only the points where the target is below it (the resonances) count.
function evalMatch(m: Metric, xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, spectral: boolean): MetricResult {
  const s = m.match;
  if (!s?.comps.length) return EMPTY(m, spectral, 'Define the target with components.');
  const x = slice(xs, i0, i1);
  const y = slice(ys, i0, i1);
  const ctx: ModelCtx = { energy: spectral, xref: (x[0] + x[x.length - 1]) / 2 };
  const target = modelCurve(s.comps, x, ctx);
  const use = target.map((t) => !(s.below < 1) || t < s.below);
  let n = 0;
  let sum = 0;
  let mx = 0;
  y.forEach((v, i) => {
    if (!use[i]) return;
    const e = v - target[i];
    sum += e * e;
    mx = Math.max(mx, Math.abs(e));
    n++;
  });
  if (!n) return EMPTY(m, spectral, 'No point of the ROI is used (the level is below the target everywhere).');
  const mse = sum / n;
  return { values: { cost: s.cost === 'msemax' ? mse + s.lambdaMax * mx * mx : mse, mse, maxErr: mx }, marks: { fit: { x, start: target, fitted: [] } } };
}

// Phase interrogation and the Goos–Hänchen shift, from the phase of r on the curve (and with n + Δn): the largest
// phase slope in the region (its position, the phase change across the region, Δφ/Δn there), or the largest |GH| (its
// position, the beam displacement ⊥ the beam λ·GH/n₁, the largest ΔGH/Δn in the region — along θ only).
function evalPhase(m: Metric, xs: ArrayLike<number>, curves: Record<string, ArrayLike<number>>, shifts: Map<string, ArrayLike<number>>, spectral: boolean, roi: [number, number], ctx?: MetricContext): MetricResult {
  const phi = curves.phiR;
  const gh = curves.gh;
  if (!phi || (m.kind === 'gh' && !gh)) return EMPTY(m, spectral, 'Needs the phase of r (and the GH shift) among the quantities kept.');
  const [i0, i1] = windowOf(xs, roi[0], roi[1]);
  if (i1 - i0 < 2) return EMPTY(m, spectral);
  let finite = false;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(phi[i])) finite = true;
  if (!finite) return EMPTY(m, spectral, 'The phase needs a polarization: TE or TM (not unpolarized).');
  const phs = shifts.get(phaseShiftKey(m));
  const wrap = (d: number) => d - 360 * Math.round(d / 360);
  if (m.kind === 'phase') {
    let lo = Infinity;
    let hi = -Infinity;
    let u = phi[i0];
    let best = i0;
    let bestSlope = 0;
    for (let i = i0; i <= i1; i++) {
      if (i > i0) u += wrap(phi[i] - phi[i - 1]);
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
      const s = phaseSlope(xs, phi, i);
      if (Math.abs(s) > Math.abs(bestSlope)) [best, bestSlope] = [i, s];
    }
    const Sphi = phs ? wrap(phs[best] - phi[best]) / m.dn : NaN;
    return { values: { slope: bestSlope, pos: xs[best], jump: hi - lo, Sphi }, marks: { x: xs[best], y: phi[best] } };
  }
  let best = i0;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(gh[i]) && !(Math.abs(gh[i]) <= Math.abs(gh[best]))) best = i;
  const g = gh[best];
  const lam = spectral ? xs[best] : ctx?.lambda;
  const n1 = lam !== undefined && ctx ? ctx.np(lam) : NaN;
  const D = lam !== undefined ? (g * lam) / n1 / 1000 : NaN;
  // the GH sensitivity: the largest change of GH over the region (the angle a GH sensor would work at)
  let Sgh = NaN;
  if (phs && !spectral)
    for (let i = i0; i <= i1; i++) {
      const d = ghOfSlope(phaseSlope(xs, phs, i)) - gh[i];
      if (Number.isFinite(d) && !(Math.abs(d) <= Math.abs(Sgh * m.dn))) Sgh = d / m.dn;
    }
  return { values: { gh: g, pos: xs[best], D, Sgh }, marks: { x: xs[best], y: g }, ...(spectral && phs ? { error: 'ΔGH/Δn needs an angular scan (the GH shift with n + Δn along θ).' } : {}) };
}

// One metric on a curve; `shifts`: the perturbed R curves by shiftKey.
export function evalMetric(m: Metric, xs: ArrayLike<number>, curves: Record<string, ArrayLike<number>>, shifts: Map<string, ArrayLike<number>>, spectral: boolean, roi: [number, number] = [m.lo, m.hi], ctx?: MetricContext): MetricResult {
  if (m.kind === 'custom') return EMPTY(m, spectral); // (evalMetrics)
  if (m.kind === 'zones') return evalZones(m, xs, curves, spectral);
  if (m.kind === 'phase' || m.kind === 'gh') return evalPhase(m, xs, curves, shifts, spectral, roi, ctx);
  const ys = curves[m.field && !['sens', 'fom'].includes(m.kind) ? m.field : 'R'];
  if (!ys) return EMPTY(m, spectral, `No curve “${m.field}”.`);
  const [i0, i1] = windowOf(xs, roi[0], roi[1]);
  if (i1 - i0 < 2) return EMPTY(m, spectral);
  if (m.kind === 'fit' && m.fit?.mode === 'dispersion') {
    const ys2 = m.field2 ? curves[m.field2] : undefined;
    if (!ys2) return EMPTY(m, spectral, 'Choose the second branch.');
    return evalDispersion(m, xs, ys, ys2, i0, i1, spectral, !!ctx?.branchesNm);
  }
  if (m.kind === 'fit') return evalFit(m, xs, ys, i0, i1, spectral);
  if (m.kind === 'match') return evalMatch(m, xs, ys, i0, i1, spectral);
  if (m.kind === 'min' || m.kind === 'max') {
    const e = extremum(xs, ys, i0, i1, m.kind);
    return { values: { pos: e.x, R: e.y }, marks: { x: e.x, y: e.y } };
  }
  const w = widthOf(xs, ys, i0, i1, m.feature);
  if (!w) return EMPTY(m, spectral);
  const marks: Marks = { x: m.feature === 'peak' ? w.center : w.pos, y: w.extreme, x1: w.x1, x2: w.x2, level: w.level };
  const depth = Number.isFinite(w.level) ? 2 * Math.abs(w.level - w.extreme) : NaN;
  if (m.kind === 'fwhm') {
    const values: Record<string, number> = { width: w.width, pos: w.pos, depth, R: w.extreme };
    if (spectral) values.q = w.width > 0 ? w.pos / w.width : NaN;
    return { values, marks };
  }
  if (m.kind === 'penetration') {
    const d = ctx?.depth?.(w.pos, m.target);
    if (!d) return { ...EMPTY(m, spectral, ctx?.depth ? 'That medium is not in the structure.' : 'The field is computed on the Simulation page.'), marks };
    return { values: { depth: d.depth, pos: w.pos, peak: d.peak, E2max: d.E2max ?? NaN, absorbed: d.absorbed ?? NaN }, marks, ...(Number.isFinite(d.depth) ? {} : { error: 'No 1/e decay of |E|² in that medium (the other values hold).' }) };
  }
  if (m.kind === 'propagation') {
    // Im β of the mode from its width: angular dθ (rad) → Δk = k₀ n_p cosθ Δθ; spectral Δλ → Δk = k₀ n_p sinθ Δλ / λ;
    // L = 1/(2 Im β) = 1/Δk (the intensity decays over L)
    if (!ctx) return { ...EMPTY(m, spectral, 'The propagation length is computed on the Simulation page.'), marks };
    const lam = spectral ? w.pos : ctx.lambda;
    const np = ctx.np(lam);
    const k0 = (2 * Math.PI) / lam;
    const dk = spectral ? k0 * np * Math.sin((ctx.theta * Math.PI) / 180) * (w.width / lam) : k0 * np * Math.cos((w.pos * Math.PI) / 180) * ((w.width * Math.PI) / 180);
    return { values: { L: dk > 0 ? 1 / dk / 1000 : NaN, width: w.width, pos: w.pos }, marks };
  }
  const key = shiftKey(m);
  const Rs = shifts.get(key);
  const shifted = Rs ? shiftedPos(xs, Rs, i0, i1, m.feature, w.pos, w.level) : NaN;
  const S = (shifted - w.pos) / m.dn;
  marks.shifted = shifted;
  marks.shiftKey = key;
  const lost = Rs && !Number.isFinite(shifted) ? 'The dip with n + Δn is not in the scan (it moved out of it: widen the scan or use a smaller Δn).' : undefined;
  if (m.kind === 'sens') return { values: { S, pos: w.pos, shifted }, marks, ...(lost ? { error: lost } : {}) };
  return { values: { fom: w.width > 0 ? Math.abs(S) / w.width : NaN, S, width: w.width, pos: w.pos }, marks, ...(lost ? { error: lost } : {}) };
}

// Every metric on a curve (off ones: empty); the custom formulas from the values of the metrics before them.
export function evalMetrics(
  metrics: Metric[],
  xs: ArrayLike<number>,
  curves: Record<string, ArrayLike<number>> | ArrayLike<number>,
  shifts: { key: string; R: ArrayLike<number> }[],
  spectral: boolean,
  at?: Record<string, number>,
  ctx?: MetricContext,
): MetricResult[] {
  const cs = 'length' in curves ? { R: curves as ArrayLike<number> } : (curves as Record<string, ArrayLike<number>>);
  const map = new Map(shifts.map((s) => [s.key, s.R]));
  const vars: Record<string, number> = {};
  return metrics.map((m) => {
    if (!m.on) return { values: {}, marks: {} };
    let r: MetricResult;
    if (m.kind === 'custom') {
      const c = compile(m.expr ?? '');
      if (typeof c === 'string') r = EMPTY(m, spectral, c);
      else {
        const missing = c.names.filter((n) => !(n in vars));
        r = missing.length ? EMPTY(m, spectral, `Unknown: ${missing.join(', ')} (metrics above this one, as name.quantity)`) : { values: { value: c.fn(vars) }, marks: {} };
      }
    } else r = evalMetric(m, xs, cs, map, spectral, roiOf(m, at), ctx);
    for (const [k, v] of Object.entries(r.values)) vars[`${m.ref}.${k}`] = v;
    return r;
  });
}

// A name for formulas: letters, digits and _, unique among the metrics.
export function uniqueRef(base: string, taken: string[]): string {
  const b = base.replace(/[^\w]/g, '').replace(/^\d+/, '') || 'm';
  let r = b;
  for (let i = 2; taken.includes(r); i++) r = `${b}${i}`;
  return r;
}

const REF_BASE: Record<MetricKind, string> = { min: 'min', max: 'max', fwhm: 'res', sens: 'sens', fom: 'fom', phase: 'ph', gh: 'gh', penetration: 'pen', propagation: 'prop', fit: 'fit', match: 'match', zones: 'zones', custom: 'f' };
let zoneCounter = 0;
export const newZone = (over: Partial<Zone> = {}): Zone => ({ id: `z${Date.now().toString(36)}${zoneCounter++}`, lo: NaN, hi: NaN, field: 'R', stat: 'mean', goal: 'max', ...over });
let counter = 0;
export function newMetric(kind: MetricKind, over: Partial<Metric> = {}, taken: string[] = []): Metric {
  return {
    id: `m${Date.now().toString(36)}${(counter++).toString(36)}`,
    ref: uniqueRef(REF_BASE[kind], taken),
    label: KIND_LABEL[kind],
    on: true,
    kind,
    feature: 'dip',
    lo: NaN,
    hi: NaN,
    dn: 0.001,
    target: { kind: 'exit' },
    ...(kind === 'fit' ? { fit: { comps: [], guess: true, run: false, parts: true } } : {}),
    ...(kind === 'match' ? { match: { comps: [], cost: 'msemax', lambdaMax: 0.01, below: 1 } } : {}),
    ...(kind === 'zones' ? { zones: [newZone({ goal: 'max' }), newZone({ goal: 'min' })] } : {}),
    ...(kind === 'custom' ? { expr: '' } : {}),
    ...(kind === 'phase' ? { field: 'phiR' } : kind === 'gh' ? { field: 'gh' } : {}),
    ...over,
  };
}

// A new metric added to a list (its label numbered by kind, a unique formula name).
export const withNewMetric = (metrics: Metric[], kind: MetricKind = 'fwhm'): Metric[] => [...metrics, newMetric(kind, { label: `${KIND_LABEL[kind]} ${metrics.filter((m) => m.kind === kind).length + 1}` }, metrics.map((m) => m.ref))];