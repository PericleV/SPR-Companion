// Sensorgrams (the Sensorgram page), after SPR Forge's Binding kinetics and Sensorgram nodes: the bound analyte along a
// protocol of injections (engine/kinetics.ts), turned into the SPR signal of the configuration's structure. At every
// time the bound mass becomes a binding layer on the sensing (exit) medium — a monolayer as high as the molecule up to
// a full random monolayer, thicker beyond (multilayer), or a compact layer d = Γ/ρ — or enters a film of the structure
// (or the film swells with the buffer); the flowing solution raises the buffer index (bulk effect, dn/dc·c·MW) and the
// buffer drifts. The reflectance is recomputed (transfer matrices) over the scan at every time, seen through the
// instrument (blur, detector noise), and read out: the position of the dip (exact between the grid points without an
// instrument, else located on the measured curves) or a parameter (R, T, A, a phase) at a point. Isotropic multilayers only.
// Pure: the plan and the read-out run on the page, the reflectance in the workers.
import { ANALYTES, blocking, equilibrium, MODEL_TEXT, simulate, surfaceOf, type Analyte, type KineticModel, type KineticParams, type KineticResult, type KineticStep, type Surface } from '../engine/kinetics.ts';
import { defaultInstrument, instrumentOf, instrumentWarnings, measure, noisy, type InstrumentSettings } from '../engine/instrument.ts';
import { halfWidth, locate, type LocateMethod } from '../engine/metrics.ts';
import * as X from '../physics/complex.ts';
import { c, type C } from '../physics/complex.ts';
import { emaEps, type Models } from '../physics/materials.ts';
import type { Layer } from '../physics/tmm.ts';
import type { Library } from '../physics/library.ts';
import { indicesAt, linspace, pointOf, type Pol } from './compute.ts';
import type { Interrogation } from './analysis.ts';
import { expand, withoutRough, type Expanded, type Structure } from './structure.ts';

// ---- settings ----

export type SgStep = { label: string; t: number; c: number; regen?: boolean; swell?: number }; // t: duration (s), c: nM
export type SgSeriesOf = 'none' | 'c' | 'ka' | 'kd' | 'rmax' | 'kt' | 'ka2' | 'kd2' | 'tau' | 'ionic' | 'zeta';
export type SgMixing = 'linear' | 'bruggeman' | 'maxwell-garnett';
// The quantities a read-out at a point can follow (the curves over the scan are of this quantity then).
export type SgQuantity = 'R' | 'T' | 'A' | 'phiR' | 'phiT' | 'rRe' | 'rIm';
export const SG_QUANTITIES: Record<SgQuantity, { label: string; short: string; unit: string; phase?: boolean; intensity?: boolean }> = {
  R: { label: 'R — reflectance', short: 'R', unit: '', intensity: true },
  T: { label: 'T — transmittance', short: 'T', unit: '', intensity: true },
  A: { label: 'A — absorptance', short: 'A', unit: '', intensity: true },
  phiR: { label: 'φr — phase of r', short: 'φr', unit: '°', phase: true },
  phiT: { label: 'φt — phase of t', short: 'φt', unit: '°', phase: true },
  rRe: { label: 'Re r', short: 'Re r', unit: '' },
  rIm: { label: 'Im r', short: 'Im r', unit: '' },
};
export type SgSettings = {
  // the analyte (a preset of ANALYTES or 'custom': the values below) and the surface it binds to
  analyte: string;
  mw: number; // Da
  dndc: number; // mL/g
  rho: number; // g/cm³
  dims: [number, number, number]; // nm, a ≥ b ≥ c
  orient: 'side' | 'end'; // lying or standing on the surface
  surface: 'ligand' | 'rsa'; // 1:1 models: ligand sites (Rmax typed) or a free surface (random sequential adsorption)
  ionic: number; // mM
  zeta: number; // mV
  // the kinetics and the protocol
  model: KineticModel;
  ka: number;
  kd: number;
  rmax: number;
  kt: number;
  ka2: number;
  kd2: number;
  rmax2: number;
  tau: number;
  steps: SgStep[];
  dt: number; // s between the samples of the kinetics
  seriesOf: SgSeriesOf; // the quantity a series varies (one curve per value); 'c' scales the injections
  series: number[];
  // where the signal changes: '' = the sensing (exit) medium, a binding layer on it; a film block id = that film
  target: string;
  thick: 'auto' | 'compact'; // auto: monolayer → multilayer; compact: d = Γ/ρ
  mixing: SgMixing; // linear in n = de Feijter
  bulk: boolean; // the bulk index of the flowing solution
  drift: number; // baseline drift of the buffer index, µRIU/min
  // the read-out: the scan — a window that follows the resonance at every time inside the Simulation's range (auto),
  // the Simulation's whole scan, or a range of its own — the resonance or a parameter at a point
  scan: { mode: 'auto' | 'sim' | 'own'; own?: boolean; from: number; to: number; points: number; win: number };
  readout: 'dip' | 'value'; // the resonance (the dip), or a quantity at a point of the scan
  quantity: SgQuantity; // readout 'value': R, T, A, a phase, a part of r
  at: number; // readout 'value': at this angle / wavelength (NaN: at the resonance of the start)
  track: boolean; // the exact dip between the grid points (without an instrument)
  locate: LocateMethod;
  locLevel: number;
  locDeg: number;
  maxTimes: number;
  // the instrument; the noise seeds (one noisy run per seed)
  inst: InstrumentSettings;
  seeds: number[];
  // the views (what the plots show)
  show: string;
  kinShow: string;
  mapSeries: number;
  mapSeed: number;
  times: number[]; // R curves at these times (empty: the end of every step)
  showMap: boolean; // the curves card: also the map R(t, θ)
  plan: SeriesPlanSettings; // the planner of a concentration series
  cards: string[]; // the plots shown on the right (Add plot): sensorgram, summary, binding, reflectance, steady
};

export const defaultSg = (): SgSettings => ({
  analyte: 'igg',
  mw: 150000,
  dndc: 0.188,
  rho: 1.35,
  dims: [14.2, 8.5, 3.8],
  orient: 'side',
  surface: 'ligand',
  ionic: 150,
  zeta: -10,
  model: 'langmuir',
  ka: 1e5,
  kd: 1e-3,
  rmax: 1000,
  kt: 1e9,
  ka2: 1e-3,
  kd2: 1e-3,
  rmax2: 500,
  tau: 60,
  steps: [
    { label: 'baseline', t: 60, c: 0 },
    { label: 'association', t: 300, c: 50 },
    { label: 'dissociation', t: 600, c: 0 },
  ],
  dt: 2,
  seriesOf: 'none',
  series: [12.5, 25, 50, 100, 200],
  target: '',
  thick: 'auto',
  mixing: 'linear',
  bulk: true,
  drift: 0,
  scan: { mode: 'auto', from: 66, to: 74, points: 161, win: 201 },
  readout: 'dip',
  quantity: 'R',
  at: NaN,
  track: true,
  locate: 'parabola',
  locLevel: 0.5,
  locDeg: 2,
  maxTimes: 400,
  inst: defaultInstrument(),
  seeds: [1],
  show: 'shift',
  kinShow: 'RU',
  mapSeries: 0,
  mapSeed: 0,
  times: [],
  showMap: false,
  plan: defaultPlanSettings(),
  cards: ['sensorgram', 'summary'],
});

// A project's settings with the defaults of what is missing (older projects, examples).
export const sgOf = (s: Partial<SgSettings> | undefined): SgSettings => {
  const d = defaultSg();
  // (older projects: own on / off — off is now the window that follows the resonance)
  return { ...d, ...s, scan: { ...d.scan, ...s?.scan, mode: s?.scan?.mode ?? (s?.scan?.own ? 'own' : 'auto') }, inst: { ...d.inst, ...s?.inst }, plan: { ...d.plan, ...s?.plan, KD: Number.isFinite(s?.plan?.KD) ? s!.plan!.KD : NaN }, at: Number.isFinite(s?.at) ? (s!.at as number) : NaN, quantity: s?.quantity && SG_QUANTITIES[s.quantity] ? s.quantity : 'R' };
};

export const SERIES_OF: Record<SgSeriesOf, { sym: string; unit: string; label: string }> = {
  none: { sym: '', unit: '', label: 'nothing (one run)' },
  c: { sym: 'c', unit: 'nM', label: 'the concentration c (scales the injections)' },
  ka: { sym: 'ka', unit: 'M⁻¹s⁻¹', label: 'ka' },
  kd: { sym: 'kd', unit: 's⁻¹', label: 'kd' },
  rmax: { sym: 'Rmax', unit: 'RU', label: 'Rmax' },
  kt: { sym: 'kt', unit: 'RU M⁻¹s⁻¹', label: 'kt (mass transport)' },
  ka2: { sym: 'ka2', unit: '', label: 'ka2' },
  kd2: { sym: 'kd2', unit: 's⁻¹', label: 'kd2' },
  tau: { sym: 'τ', unit: 's', label: 'τ (swelling)' },
  ionic: { sym: 'I', unit: 'mM', label: 'the ionic strength I' },
  zeta: { sym: 'ζ', unit: 'mV', label: 'the ζ potential' },
};

// The analyte: a preset or the settings' own values.
export const analyteOf = (s: SgSettings): Analyte => (s.analyte !== 'custom' && ANALYTES[s.analyte] ? ANALYTES[s.analyte] : { name: 'custom analyte', mw: s.mw, dndc: s.dndc, rho: s.rho, dims: s.dims });
// The 1:1 models can take the free surface (random sequential adsorption).
export const rsaModel = (m: KineticModel) => m === 'langmuir' || m === 'transport';
export { ANALYTES, MODEL_TEXT };

// ---- the kinetics (every series) ----

export type SgStepSpan = { t0: number; t1: number; label: string; c: number };
export type Steady = { rows: string[]; cs: number[]; Req: number[]; fit?: number[]; reached?: number[]; KD?: number; Rmax?: number };
export type SgKinetics = {
  errors: string[];
  warnings: string[];
  analyte: Analyte;
  swelling: boolean;
  rsa: boolean;
  surfaces: Surface[]; // per series
  setups: { p: KineticParams; steps: KineticStep[] }[];
  runs: KineticResult[];
  t: number[];
  vals: number[]; // the series values (one NaN: no series)
  seriesLabel: (k: number) => string;
  steps: SgStepSpan[];
  rmax: number; // RU, the nominal Rmax (the jamming capacity on a free surface)
  steady: Steady | null;
};

export function kineticsOf(s: SgSettings): SgKinetics {
  const errors: string[] = [];
  const swelling = s.model === 'swelling';
  const analyte = analyteOf(s);
  const rsa = s.surface === 'rsa' && rsaModel(s.model);
  const empty: SgKinetics = { errors, warnings: [], analyte, swelling, rsa, surfaces: [], setups: [], runs: [], t: [], vals: [NaN], seriesLabel: () => '', steps: [], rmax: NaN, steady: null };
  if (!s.steps.length) errors.push('Add the steps of the protocol.');
  s.steps.forEach((st, i) => {
    if (!(st.t >= 0)) errors.push(`Step ${i + 1}: the duration must be ≥ 0 s.`);
    if (!swelling && !(st.c >= 0)) errors.push(`Step ${i + 1}: the concentration must be ≥ 0.`);
  });
  const total = s.steps.reduce((a, st) => a + Math.max(0, st.t), 0);
  if (s.steps.length && !(total > 0)) errors.push('The protocol lasts 0 s.');
  if (!(s.dt > 0)) errors.push('The time step must be > 0.');
  else if (total / s.dt > 20000) errors.push(`Too many time points (${Math.round(total / s.dt)}): a larger time step (at most 20 000 points).`);
  const pos = (v: number, what: string) => !(v > 0) && errors.push(`${what} must be > 0.`);
  if (swelling) pos(s.tau, 'τ');
  else {
    if (!(s.ka >= 0) || !(s.kd >= 0)) errors.push('ka and kd must be ≥ 0.');
    if (!rsa) pos(s.rmax, 'Rmax');
    if (s.model === 'transport') pos(s.kt, 'kt');
    if (s.model === 'hetero') pos(s.rmax2, 'Rmax2');
    if ((s.model === 'bivalent' || s.model === 'hetero' || s.model === 'twostate') && (!(s.ka2 >= 0) || !(s.kd2 >= 0))) errors.push('ka2 and kd2 must be ≥ 0.');
    if (!(s.ionic > 0)) errors.push('The ionic strength must be > 0.');
  }
  if (!(analyte.mw > 0 && analyte.dndc > 0 && analyte.rho > 0 && analyte.dims.every((v) => v > 0))) errors.push('The analyte needs MW, dn/dc, density and dimensions > 0.');
  const seriesOn = s.seriesOf !== 'none';
  const vals = seriesOn ? s.series.filter(Number.isFinite) : [NaN];
  if (seriesOn && !vals.length) errors.push('Give the values of the series.');
  if (vals.length > 50) errors.push('At most 50 values in a series.');
  const cRef = Math.max(0, ...s.steps.map((st) => st.c));
  if (seriesOn && s.seriesOf === 'c' && !swelling && !(cRef > 0)) errors.push('A concentration series scales the injections: give a step a concentration.');
  if (seriesOn && s.seriesOf === 'ionic' && vals.some((v) => !(v > 0))) errors.push('The ionic strength must be > 0.');
  if (seriesOn && s.seriesOf === 'rmax' && rsa) errors.push('On a free surface Rmax is the jamming capacity: vary the ionic strength or ζ instead.');
  if (errors.length) return empty;

  const swept = (key: SgSeriesOf, v: number, def: number) => (Number.isFinite(v) && s.seriesOf === key ? v : def);
  // the surface of every series (a varied I or ζ changes the repulsion)
  const surfaces = vals.map((v) => surfaceOf(analyte, s.orient, swept('ionic', v, s.ionic), swept('zeta', v, s.zeta)));
  const setups = vals.map((v, k) => {
    const p: KineticParams = { model: s.model, ka: s.ka, kd: s.kd, rmax: s.rmax, kt: s.kt, ka2: s.ka2, kd2: s.kd2, rmax2: s.rmax2, tau: s.tau, drift: 0, rsa };
    let steps: KineticStep[] = s.steps.map((st) => ({ label: st.label, t: st.t, c: st.c * 1e-9, regen: st.regen, swell: st.swell }));
    if (Number.isFinite(v)) {
      if (s.seriesOf === 'c') steps = steps.map((st) => ({ ...st, c: (st.c * v) / cRef }));
      else if (s.seriesOf !== 'ionic' && s.seriesOf !== 'zeta' && s.seriesOf !== 'none') p[s.seriesOf] = v;
    }
    if (rsa) p.rmax = surfaces[k].capacity * 1000;
    return { p, steps };
  });
  const runs = setups.map(({ p, steps }) => simulate(p, steps, s.dt));
  const warnings: string[] = [];
  if (!swelling && runs.some((r, k) => Math.max(...r.R) > surfaces[k].capacity * 1000 * 1.0001))
    warnings.push(
      `More bound than a random ${s.orient === 'end' ? 'end-on' : 'side-on'} monolayer holds (${+(surfaces[0].capacity * 1000).toPrecision(3)} RU): the molecules must ${s.orient === 'end' ? 'pack in order' : 'stand (end-on) or pack in order'}, or form a multilayer (the binding layer then grows).`,
    );
  let t0 = 0;
  const steps = s.steps.map((st) => {
    const span = { t0, t1: t0 + Math.max(0, st.t), label: st.label || (st.c > 0 ? 'injection' : 'buffer'), c: st.c };
    t0 = span.t1;
    return span;
  });
  const { sym, unit } = SERIES_OF[s.seriesOf];
  const seriesLabel = (k: number) => (seriesOn ? `${sym} = ${+vals[k].toPrecision(4)}${unit ? ` ${unit}` : ''}` : swelling ? 's' : 'R');
  return {
    errors,
    warnings,
    analyte,
    swelling,
    rsa,
    surfaces,
    setups,
    runs,
    t: runs[0].t,
    vals,
    seriesLabel,
    steps,
    rmax: swelling ? NaN : rsa ? surfaces[0].capacity * 1000 : s.model === 'hetero' ? s.rmax + s.rmax2 : s.rmax,
    steady: swelling ? null : steadyState(setups, runs, rsaModel(s.model), rsa),
  };
}

// Steady-state (equilibrium) analysis: the response at the end of every injection (all series) against its
// concentration, a Langmuir isotherm R = Rmax c / (KD + c) fitted by least squares (Rmax solved, KD by a golden search on
// log KD); for the 1:1 models also how close each injection came to its own equilibrium.
export function steadyState(setups: { p: KineticParams; steps: { t: number; c: number }[] }[], runs: KineticResult[], oneToOne: boolean, rsa: boolean): Steady | null {
  const pts = new Map<number, { R: number[]; reached: number[] }>();
  setups.forEach(({ p, steps }, k) => {
    const r = runs[k];
    let t1 = 0;
    for (const st of steps) {
      t1 += Math.max(0, st.t);
      if (!(st.c > 0)) continue;
      let j = 0;
      while (j + 1 < r.t.length && r.t[j + 1] <= t1 + 1e-9) j++;
      const cn = +(st.c * 1e9).toPrecision(9);
      const e = pts.get(cn) ?? { R: [], reached: [] };
      e.R.push(r.R[j]);
      if (oneToOne) e.reached.push(r.R[j] / equilibrium(p, st.c));
      pts.set(cn, e);
    }
  });
  const cs = [...pts.keys()].sort((a, b) => a - b);
  if (cs.length < 2) return null;
  const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;
  const y = cs.map((cc) => mean(pts.get(cc)!.R));
  const rows: string[] = [];
  const fmt = (v: number) => `${+v.toPrecision(3)}`;
  const out: Steady = { rows, cs, Req: y };
  if (cs.length >= 3) {
    const sse = (lk: number) => {
      const K = 10 ** lk;
      const g = cs.map((cc) => cc / (K + cc));
      const rm = g.reduce((a, v, i) => a + v * y[i], 0) / g.reduce((a, v) => a + v * v, 0);
      return { rm, K, e: g.reduce((a, v, i) => a + (rm * v - y[i]) ** 2, 0) };
    };
    let a = Math.log10(cs[0]) - 4;
    let b = Math.log10(cs[cs.length - 1]) + 4;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 120; it++) {
      const x1 = b - gr * (b - a);
      const x2 = a + gr * (b - a);
      if (sse(x1).e < sse(x2).e) b = x2;
      else a = x1;
    }
    const best = sse((a + b) / 2);
    out.fit = cs.map((cc) => (best.rm * cc) / (best.K + cc));
    out.KD = best.K;
    out.Rmax = best.rm;
    const p0 = setups[0].p;
    const model = oneToOne && p0.kd > 0 && !rsa ? ` (the model: KD ${fmt((p0.kd / p0.ka) * 1e9)} nM, Rmax ${fmt(p0.rmax)} RU)` : '';
    rows.push(`steady state (end of each injection, ${cs.length} concentrations): KD ${fmt(best.K)} nM, Rmax ${fmt(best.rm)} RU${model}`);
    if (best.K > 3 * cs[cs.length - 1]) rows.push('the highest concentration is far below KD: the isotherm does not bend, KD and Rmax are poorly defined (inject higher concentrations)');
  }
  if (oneToOne) {
    const reached = cs.map((cc) => mean(pts.get(cc)!.reached));
    out.reached = reached;
    const i = reached.reduce((m, v, k) => (v < reached[m] ? k : m), 0);
    rows.push(
      reached[i] < 0.95
        ? `${fmt(cs[i])} nM reached only ${fmt(100 * reached[i])} % of its equilibrium: a steady-state KD is biased (longer injections, or fit the kinetics)`
        : `every injection reached ≥ ${fmt(100 * reached[i])} % of its equilibrium`,
    );
  }
  return out;
}

// ---- planning a concentration series (1:1 kinetics) ----

// The settings of the planner: KD estimated (NaN: kd/ka of the model), how many concentrations between which multiples
// of KD (evenly on a log scale), the concentrations typed over (absent: the generated ones), the longest injection,
// whether Apply also sets the dissociation.
export type SeriesPlanSettings = { KD: number; count: number; from: number; to: number; cs?: number[]; maxInject: number; diss: boolean };
export const defaultPlanSettings = (): SeriesPlanSettings => ({ KD: NaN, count: 5, from: 0.1, to: 10, maxInject: 3600, diss: true });

export type PlanRow = { c: number; kobs: number; t95: number; frac: number; reached: number };
export type SeriesPlan =
  | { KD: number; ka: number; kd: number; auto: boolean; cs: number[]; custom: boolean; rows: PlanRow[]; inject: number; capped: boolean; half: number; diss: number; notes: string[] }
  | { error: string };

// A concentration series around KD (estimated, or kd/ka of the model; the association rate ka of the model, kd = KD·ka):
// `count` concentrations from `from` to `to` × KD evenly on a log scale (rounded to two significant figures), or the
// ones typed; the injection long enough for the lowest one to reach 95 % of its equilibrium, t95 = ln 20 / (ka c + kd)
// (1:1 Langmuir; the other models: their ka, kd as a guide), at most `maxInject` (each concentration then reaches
// 1 − e^(−kobs t) of it); the dissociation long enough to lose 10 % of the bound analyte, ln(10/9) / kd, at least as
// long as the injection and at most `maxInject`. The times rounded up to 10 s.
export function planSeries(s: SgSettings): SeriesPlan {
  if (s.model === 'swelling') return { error: 'Polymer swelling has no concentration series.' };
  if (!(s.ka > 0)) return { error: 'ka must be > 0.' };
  const o = { ...defaultPlanSettings(), ...s.plan };
  const auto = !Number.isFinite(o.KD) || !(o.KD > 0);
  if (auto && !(s.kd > 0)) return { error: 'kd = 0 (irreversible binding): there is no KD from the model — give an estimated KD, or every concentration ends at Rmax given time.' };
  const KD = auto ? (s.kd / s.ka) * 1e9 : o.KD; // nM
  const ka = s.ka;
  const kd = KD * 1e-9 * ka;
  const r2 = (v: number) => +v.toPrecision(2);
  const count = Math.max(2, Math.min(12, Math.round(o.count)));
  const [lo, hi] = [Math.max(1e-6, Math.min(o.from, o.to)), Math.max(1e-6, Math.max(o.from, o.to))];
  const gen = Array.from({ length: count }, (_, i) => r2(KD * lo * (hi / lo) ** (count > 1 ? i / (count - 1) : 0)));
  const custom = !!o.cs?.length;
  const cs = (custom ? o.cs!.filter((c) => c > 0) : gen).slice().sort((a, b) => a - b);
  if (!cs.length) return { error: 'Give the concentrations (> 0).' };
  const up10 = (t: number) => Math.ceil(t / 10) * 10;
  const t95 = (c: number) => Math.log(20) / (ka * c * 1e-9 + kd);
  const need = up10(Math.max(...cs.map(t95)));
  const cap = Math.max(10, o.maxInject);
  const inject = Math.min(need, up10(cap));
  const rows = cs.map((c) => {
    const kobs = ka * c * 1e-9 + kd;
    return { c, kobs, t95: Math.log(20) / kobs, frac: c / (KD + c), reached: 1 - Math.exp(-kobs * inject) };
  });
  const diss = Math.min(up10(cap), Math.max(inject, up10(Math.log(10 / 9) / kd)));
  const notes: string[] = [];
  if (s.model !== 'langmuir') notes.push(`${MODEL_TEXT[s.model]}: ka and kd of the first step taken as a 1:1 guide${s.model === 'transport' ? ' (mass transport makes the approach slower still)' : ''}.`);
  if (s.surface === 'rsa' && rsaModel(s.model)) notes.push('On a free surface the blocking function slows the approach near saturation: the times are a lower bound.');
  if (need > inject) notes.push(`The lowest concentration needs ${need} s for 95 %: with injections of ${inject} s it reaches ${Math.round(100 * rows[0].reached)} % — a steady-state KD from these would be biased (fit the kinetics instead, or raise the lowest concentration).`);
  if (cs[cs.length - 1] < 2 * KD) notes.push('The highest concentration is below 2 KD: the isotherm hardly bends (KD and Rmax poorly defined from the steady state).');
  return { KD, ka, kd, auto, cs, custom, rows, inject, capped: need > inject, half: Math.log(2) / kd, diss, notes };
}

// The plan applied: the concentration series, every injection that long, and (diss) the buffer step after each
// injection as long as the planned dissociation.
export function applySeriesPlan(s: SgSettings, p: Exclude<SeriesPlan, { error: string }>): SgSettings {
  const diss = s.plan?.diss ?? true;
  return {
    ...s,
    seriesOf: 'c',
    series: p.cs,
    steps: s.steps.map((st, i) => (st.c > 0 ? { ...st, t: p.inject } : diss && i > 0 && s.steps[i - 1].c > 0 && !st.regen ? { ...st, t: p.diss } : st)),
  };
}

// ---- the optical plan (built on the page, computed in the workers) ----

export type SgPlan = {
  along: 'theta' | 'lambda';
  xs: number[]; // the whole scan (the Simulation's or its own)
  // the curves computed: windows of W points of the grid xsG; a window that follows the resonance is placed at every
  // time by a coarse search over the whole scan (coarse: its points), a fixed one starts at i0 (the whole scan: i0 = 0)
  win: { xsG: number[]; W: number; coarse: number[] | null; i0: number };
  lambda: number; // angular scan: its wavelength
  theta: number; // spectral scan: its angle
  pol: Pol;
  sensing: number; // index of the sensing medium in [incident, ...layers, exit] (0 when the light comes from the other side)
  binding: boolean; // a binding layer on the sensing medium (else: the target film changes)
  target: number; // the target film's index in [incident, ...layers, exit] (binding: unused)
  swelling: boolean;
  mixing: SgMixing;
  nP: number; // the analyte's index (the buffer + dn/dc·ρ at λ₀)
  lam0: number;
  nK: number;
  nT: number;
  d: number[]; // per (series, time) q = k·nT + j: the layer thickness (nm)
  f: number[]; // the guest volume fraction (analyte; solvent when swelling)
  bulk: number[]; // the change of the buffer index
  track: boolean; // the exact dip (golden section with the transfer matrix) between the grid points
  readout: 'dip' | 'value';
  quantity: SgQuantity; // the curves: R (the dip) or the quantity read at a point
  at: number;
  atAuto: boolean; // the point: the resonance of the start (found here), not a value given
  // the calibration: the read-out with a little bound mass (a layer h → hG with fraction fG) and a little buffer index
  cal: { h: number; hG: number; fG: number; dG: number; dN: number } | null;
};

const linearMix = (host: C, guest: C, f: number): C => c(f * guest.re + (1 - f) * host.re, f * guest.im + (1 - f) * host.im);
// The index of a mixture: the guest (volume fraction f) in the host — linear in n (de Feijter) or an effective medium.
export function mixIndex(method: SgMixing, host: C, guest: C, f: number): C {
  if (method === 'linear') return linearMix(host, guest, f);
  return X.sqrt(emaEps(method, X.mul(guest, guest), X.mul(host, host), f));
}

// The stack at one wavelength for (thickness d, guest fraction f, buffer Δn), from the indices of the expanded
// structure there.
export function sgStack(ex: Expanded, base: C[], plan: Omit<SgPlan, 'at' | 'atAuto'>, d: number, f: number, dn: number): Layer[] {
  const nb = c(base[plan.sensing].re + dn, base[plan.sensing].im);
  const n = base.map((x, j) => (j === plan.sensing ? nb : x));
  const ds = n.map((_, j) => (j === 0 || j === n.length - 1 ? 0 : ex.layers[j - 1].d));
  if (plan.binding) {
    // the binding layer: the analyte with the buffer in its pores (host analyte, filler buffer, porosity 1 − f)
    const nl = f > 0 ? mixIndex(plan.mixing, c(plan.nP, 0), nb, 1 - f) : nb;
    const layer = { n: nl, d };
    const L = n.map((nj, j) => ({ n: nj, d: ds[j] }));
    return plan.sensing === 0 ? [L[0], layer, ...L.slice(1)] : [...L.slice(0, -1), layer, L[L.length - 1]];
  }
  const t = plan.target;
  const guest = plan.swelling ? nb : c(plan.nP, 0);
  n[t] = mixIndex(plan.mixing, base[t], guest, f);
  if (plan.swelling) ds[t] = d;
  return n.map((nj, j) => ({ n: nj, d: ds[j] }));
}

// Golden-section minimum of f on [a, b].
export function goldenMin(f: (x: number) => number, a: number, b: number, tol: number) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c1 = b - g * (b - a);
  let c2 = a + g * (b - a);
  let f1 = f(c1);
  let f2 = f(c2);
  for (let it = 0; it < 200 && Math.abs(b - a) > tol; it++) {
    if (f1 < f2) {
      b = c2;
      c2 = c1;
      f2 = f1;
      c1 = b - g * (b - a);
      f1 = f(c1);
    } else {
      a = c1;
      c1 = c2;
      f1 = f2;
      c2 = a + g * (b - a);
      f2 = f(c2);
    }
  }
  const x = (a + b) / 2;
  return { x, y: f(x) };
}

// A quantity (R by default) at one point of the scan, for one state of the layer.
function readerOf(ex: Expanded, models: Models, plan: Omit<SgPlan, 'at' | 'atAuto'>, d: number, f: number, dn: number, q: SgQuantity = 'R') {
  if (plan.along === 'theta') {
    const st = sgStack(ex, indicesAt(ex, models, plan.lambda), plan, d, f, dn);
    return (th: number) => pointOf(st, plan.lambda, th, plan.pol)[q];
  }
  return (lam: number) => pointOf(sgStack(ex, indicesAt(ex, models, lam), plan, d, f, dn), lam, plan.theta, plan.pol)[q];
}

// The resonance (the dip of R, refined) of one state of the layer, NaN when it lies at an end of the scan.
function resonanceOf(ex: Expanded, models: Models, plan: Omit<SgPlan, 'at' | 'atAuto'>, d: number, f: number, dn: number) {
  const read = readerOf(ex, models, plan, d, f, dn);
  const ys = plan.xs.map(read);
  let k0 = 0;
  for (let k = 1; k < ys.length; k++) if (ys[k] < ys[k0]) k0 = k;
  if (k0 < 1 || k0 > ys.length - 2) return NaN;
  const [a, b] = [plan.xs[k0 - 1], plan.xs[k0 + 1]].sort((p, r) => p - r);
  return goldenMin(read, a, b, 1e-9 * Math.max(1, Math.abs(b))).x;
}

export type SgChunk = { pairs: number[]; R: Float64Array; i0: Int32Array; edge: Uint8Array; pos: Float64Array; rmin: Float64Array; val: Float64Array; nL: Float64Array };

// The reflectance of the given (series, time) pairs over the scan; the exact dip (tracking) or R at the read-out
// point; the index of the changing layer at λ₀.
export function sgCompute(ex: Expanded, models: Models, plan: SgPlan, pairs: number[]): SgChunk {
  const { xsG, W, coarse } = plan.win;
  const nX = W;
  const out: SgChunk = { pairs, R: new Float64Array(pairs.length * nX), i0: new Int32Array(pairs.length), edge: new Uint8Array(pairs.length), pos: new Float64Array(pairs.length).fill(NaN), rmin: new Float64Array(pairs.length).fill(NaN), val: new Float64Array(pairs.length).fill(NaN), nL: new Float64Array(pairs.length) };
  const base0 = indicesAt(ex, models, plan.lam0);
  // (a spectral scan: the indices at a wavelength once)
  const memo = new Map<number, C[]>();
  const baseAt = (lam: number) => {
    let b = memo.get(lam);
    if (!b) memo.set(lam, (b = indicesAt(ex, models, lam)));
    return b;
  };
  const baseL = plan.along === 'theta' ? indicesAt(ex, models, plan.lambda) : null;
  const step = xsG.length > 1 ? xsG[1] - xsG[0] : 1;
  pairs.forEach((q, i) => {
    const [d, f, dn] = [plan.d[q], plan.f[q], plan.bulk[q]];
    const qk = plan.quantity;
    const st = baseL ? sgStack(ex, baseL, plan, d, f, dn) : null;
    const at = (x: number, key: SgQuantity) => (st ? pointOf(st, plan.lambda, x, plan.pol)[key] : pointOf(sgStack(ex, baseAt(x), plan, d, f, dn), x, plan.theta, plan.pol)[key]);
    // where the window is: the resonance found on the coarse grid of the whole scan (a jump of any size is followed)
    let i0 = plan.win.i0;
    if (coarse) {
      let kc = 0;
      let best = Infinity;
      coarse.forEach((x, k) => {
        const r = at(x, 'R');
        if (r < best) [best, kc] = [r, k];
      });
      if (kc === 0 || kc === coarse.length - 1) out.edge[i] = 1;
      i0 = Math.min(xsG.length - W, Math.max(0, Math.round((coarse[kc] - xsG[0]) / step) - (W - 1) / 2));
    }
    out.i0[i] = i0;
    const R = out.R.subarray(i * nX, (i + 1) * nX);
    for (let k = 0; k < W; k++) R[k] = at(xsG[i0 + k], qk);
    const xs = xsG.slice(i0, i0 + W);
    const st0 = sgStack(ex, base0, plan, d, f, dn);
    out.nL[i] = st0[plan.binding ? (plan.sensing === 0 ? 1 : st0.length - 2) : plan.target].n.re;
    const read = readerOf(ex, models, plan, d, f, dn, plan.quantity);
    if (plan.readout === 'value') out.val[i] = read(plan.at);
    else if (plan.track) {
      let k0 = 0;
      for (let k = 1; k < nX; k++) if (R[k] < R[k0]) k0 = k;
      if (k0 > 0 && k0 < nX - 1) {
        const [a, b] = [xs[k0 - 1], xs[k0 + 1]].sort((p, r) => p - r);
        const m = goldenMin(read, a, b, 1e-9 * Math.max(1, Math.abs(b)));
        out.pos[i] = m.x;
        out.rmin[i] = m.y;
      }
    }
  });
  return out;
}

export type SgCal = { perG?: number; perN: number };
// A phase difference brought to (−180°, 180°].
const wrap180 = (v: number) => v - 360 * Math.round(v / 360);

// The calibration: the read-out at the start of the first series, exact (transfer matrices, the dip refined), with a
// little bound mass (0.01 ng/mm²) and a little buffer index (10⁻⁵) added: per ng/mm² and per RIU.
export function sgCalibrate(ex: Expanded, models: Models, plan: SgPlan): SgCal | null {
  const cal = plan.cal;
  if (!cal) return null;
  const nX = plan.xs.length;
  const q = plan.readout === 'value' ? plan.quantity : 'R';
  const base = readerOf(ex, models, plan, cal.h, 0, 0, q);
  const ys = plan.xs.map(readerOf(ex, models, plan, cal.h, 0, 0));
  let i0 = 0;
  for (let i = 1; i < nX; i++) if (ys[i] < ys[i0]) i0 = i;
  if (plan.readout === 'dip' && (i0 < 1 || i0 > nX - 2)) return null;
  const [a, b] = [plan.xs[Math.max(0, i0 - 2)], plan.xs[Math.min(nX - 1, i0 + 2)]].sort((p, q) => p - q);
  const read = (f: (x: number) => number) => (plan.readout === 'value' ? f(plan.at) : goldenMin(f, a, b, 1e-10 * Math.max(1, Math.abs(b))).x);
  const r0 = read(base);
  const diff = (v: number) => (SG_QUANTITIES[q].phase ? wrap180(v - r0) : v - r0);
  const perN = diff(read(readerOf(ex, models, plan, cal.h, 0, cal.dN, q))) / cal.dN;
  if (plan.swelling) return { perN };
  return { perG: diff(read(readerOf(ex, models, plan, cal.hG, cal.fG, 0, q))) / cal.dG, perN };
}

export const MAX_SG_POINTS = 4_000_000; // reflectance points of one run (× seeds for the measured curves)

// The scan of the read-out (the Simulation's interrogation or the settings' own range).
export function scanOf(s: SgSettings, it: Interrogation): { along: 'theta' | 'lambda'; xs: number[] } | null {
  if (it.mode === 'map') return null;
  const own = s.scan.own;
  return { along: it.mode, xs: linspace(own ? s.scan.from : it.from, own ? s.scan.to : it.to, Math.max(3, Math.round(own ? s.scan.points : it.points))) };
}

// The times computed: at most maxTimes of the kinetics' samples (evenly picked, the last one kept).
export function timeIndices(n: number, maxTimes: number): number[] {
  const maxT = Math.max(2, Math.min(5000, Math.round(maxTimes || 400)));
  const stride = Math.max(1, Math.ceil((n - 1) / (maxT - 1)));
  const out: number[] = [];
  for (let j = 0; j < n; j += stride) out.push(j);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

export type SgPlanResult = { plan: SgPlan | null; errors: string[]; warnings: string[]; tIdx: number[]; layer?: string };

// The optical plan: where the signal changes and how (thickness, guest fraction, buffer Δn at every series and time).
export function sgPlan(structure: Structure, it: Interrogation, s: SgSettings, kin: SgKinetics, lib: Library, models: Models): SgPlanResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (e: string[]): SgPlanResult => ({ plan: null, errors: e, warnings, tIdx: [] });
  if (kin.errors.length) return fail(kin.errors);
  const sc = scanOf(s, it);
  if (!sc) return fail(['The sensorgram reads an angular or a spectral scan: this configuration has a dispersion map (switch its interrogation on the Simulation page).']);
  if (s.scan.own && !(s.scan.to > s.scan.from)) errors.push('The scan: “to” must be larger than “from”.');
  // (the sensorgram ignores the roughness: the workers get the structure without it too)
  const plain = withoutRough(structure);
  if (JSON.stringify(plain) !== JSON.stringify(structure)) warnings.push('The roughness of the structure is ignored here: the sensorgram is computed with smooth interfaces.');
  const ex = expand(plain, lib, models);
  if (ex.errors.length) return fail(ex.errors);
  const last = ex.layers.length + 1;
  const sensing = structure.reversed ? 0 : last;
  const binding = !s.target;
  let target = -1;
  if (!binding) {
    const blk = structure.blocks.find((b) => b.id === s.target);
    if (!blk) return fail(['The target film is no longer in the structure: choose the target again.']);
    if (blk.kind !== 'film') return fail(['The target must be a single film (not a DBR).']);
    target = ex.layers.findIndex((L) => L.block === s.target) + 1;
    if (target < 1) return fail(['The target film has no thickness in the structure.']);
  }
  if (kin.swelling && binding) errors.push('Polymer swelling: choose the polymer film of the structure as the target.');
  if (errors.length) return fail(errors);

  const tIdx = timeIndices(kin.t.length, s.maxTimes);
  const nT = tIdx.length;
  const nK = kin.vals.length;
  const lam0 = sc.along === 'lambda' ? (Math.min(...sc.xs) + Math.max(...sc.xs)) / 2 : it.lambda;
  const nb0 = indicesAt(ex, models, lam0)[sensing].re;
  const an = kin.analyte;
  const nP = nb0 + an.dndc * an.rho;
  const compact = s.thick === 'compact';
  const L0 = binding ? 0 : ex.layers[target - 1].d;
  const driftAt = (t: number) => ((Number.isFinite(s.drift) ? s.drift : 0) * 1e-6 * t) / 60; // µRIU/min
  const d: number[] = [];
  const f: number[] = [];
  const bulk: number[] = [];
  let overfull = false;
  for (let k = 0; k < nK; k++)
    for (const j of tIdx) {
      const tv = kin.t[j];
      const run = kin.runs[k];
      if (kin.swelling) {
        const sw = Math.max(-0.99, run.s[j]);
        d.push(L0 * (1 + sw));
        f.push(Math.max(0, sw / (1 + sw)));
        bulk.push(driftAt(tv));
        continue;
      }
      const G = Math.max(0, run.R[j]) / 1000; // ng/mm²
      bulk.push((s.bulk ? (an.dndc * run.c[j] * an.mw) / 1000 : 0) + driftAt(tv)); // c in M: (mL/g)·(g/mL)
      let thick = L0;
      if (binding) {
        // auto: a monolayer as high as the molecule up to its jamming capacity, then thicker with the extra mass
        const S = kin.surfaces[k];
        thick = compact ? G / an.rho : G > S.capacity ? (S.height * G) / S.capacity : S.height;
      }
      const fv = thick > 0 ? (binding && compact ? (G > 0 ? 1 : 0) : G / an.rho / thick) : 0;
      if (fv > 1 + 1e-9) overfull = true;
      d.push(Math.max(0, thick));
      f.push(Math.min(1, fv));
    }
  if (overfull) warnings.push('More bound mass than fits in the target film (analyte volume fraction > 1, clipped).');
  const size = nK * nT * Math.min(sc.xs.length, s.scan.mode === 'auto' ? Math.max(11, Math.round(s.scan.win)) : sc.xs.length);
  if (size > MAX_SG_POINTS) return fail([`Too many points (${size.toLocaleString('en')} > ${MAX_SG_POINTS.toLocaleString('en')}): fewer times (max times), a coarser or narrower scan, or fewer series.`]);
  const lo = Math.min(sc.xs[0], sc.xs[sc.xs.length - 1]);
  const hi = Math.max(sc.xs[0], sc.xs[sc.xs.length - 1]);
  const atGiven = Number.isFinite(s.at);
  if (s.readout === 'value' && atGiven && !(s.at >= lo && s.at <= hi)) warnings.push(`The read-out point ${s.at} lies outside the scan (${+lo.toPrecision(6)}–${+hi.toPrecision(6)}).`);
  // the calibration: a layer as for the first series (auto: the molecule's height; compact: Γ/ρ; a film: its thickness)
  const dG = 0.01;
  const S0 = kin.surfaces[0];
  const h = binding ? (compact ? 0 : S0?.height ?? 0) : L0;
  const hG = binding && compact ? dG / an.rho : h;
  const fG = binding && compact ? 1 : dG / an.rho / Math.max(1e-12, hG);
  const draft: Omit<SgPlan, 'at' | 'atAuto' | 'win'> & { win: SgPlan['win'] } = {
    along: sc.along,
    xs: sc.xs,
    win: { xsG: sc.xs, W: sc.xs.length, coarse: null, i0: 0 },
    lambda: it.lambda,
    theta: it.theta,
    pol: it.pol,
    sensing,
    binding,
    target,
    swelling: kin.swelling,
    mixing: s.mixing,
    nP,
    lam0,
    nK,
    nT,
    d,
    f,
    bulk,
    track: s.track && !instrumentOf(s.inst, sc.along),
    readout: s.readout,
    quantity: s.readout === 'value' ? s.quantity : 'R',
    cal: { h, hG, fG, dG, dN: 1e-5 },
  };
  // a quantity at a point: by default at the resonance of the start (the first series, the first time)
  let at = atGiven ? s.at : (lo + hi) / 2;
  if (s.readout === 'value' && !atGiven) {
    const r = resonanceOf(ex, models, draft, d[0], f[0], bulk[0]);
    if (Number.isFinite(r)) at = r;
    else warnings.push('No resonance (a dip of R inside the scan) at the start: the quantity is read at the middle of the scan.');
  }
  // the window: the whole scan, or (auto) W points around the resonance — 2·FWHM on each side of the dip of the start
  // (at least 20 steps of the scan), on a grid of that step; a parameter at a point: a window fixed around the point
  let win: SgPlan['win'] = { xsG: sc.xs, W: sc.xs.length, coarse: null, i0: 0 };
  if (s.scan.mode === 'auto') {
    const W = Math.max(11, Math.round(s.scan.win)) | 1;
    const read = readerOf(ex, models, draft, d[0], f[0], bulk[0]);
    const ys = sc.xs.map(read);
    const w = halfWidth(sc.xs, ys, 0, sc.xs.length - 1, 'dip', 'local').width;
    const dx = Math.abs(sc.xs[1] - sc.xs[0]);
    const hw = Math.min((hi - lo) / 2, Math.max(20 * dx, Number.isFinite(w) && w > 0 ? 2 * w : 20 * dx));
    const step = (2 * hw) / (W - 1);
    if (W * 1.5 < sc.xs.length) {
      const xsG = Array.from({ length: Math.floor((hi - lo) / step + 1e-9) + 1 }, (_, k) => lo + k * step);
      // (a broad dip: the window is the whole range, W points over it)
      if (xsG.length <= W) win = { xsG: linspace(lo, hi, W), W, coarse: null, i0: 0 };
      else {
        const fine = Number.isFinite(w) && w > 0 ? w / 4 : 4 * dx;
        const M = Math.min(sc.xs.length, Math.max(21, Math.ceil((hi - lo) / fine) + 1));
        const center = s.readout === 'value' ? at : NaN;
        win = {
          xsG,
          W,
          coarse: s.readout === 'value' ? null : linspace(lo, hi, M),
          i0: s.readout === 'value' ? Math.min(xsG.length - W, Math.max(0, Math.round((center - lo) / step) - (W - 1) / 2)) : 0,
        };
      }
    }
  }
  const plan: SgPlan = { ...draft, at, atAuto: s.readout === 'value' && !atGiven, win };
  const qInfo = SG_QUANTITIES[plan.quantity];
  if (s.readout === 'value' && !qInfo.intensity && instrumentOf(s.inst, sc.along)) warnings.push(`The instrument (blur, detector noise) acts on intensities: ${qInfo.short} is read without it.`);
  if (s.readout === 'dip' && s.track && instrumentOf(s.inst, sc.along)) warnings.push('The dip is not refined exactly through the instrument: it is located on the measured curves.');
  warnings.push(...instrumentWarnings(s.inst, sc.along, sc.xs));
  const layer =
    binding && !kin.swelling
      ? compact
        ? 'compact: all the bound mass as a dense layer of the analyte, d = Γ/ρ'
        : `a monolayer ${+S0.height.toPrecision(3)} nm high (the molecule), full at Γ∞ = ${+S0.capacity.toPrecision(3)} ng/mm² (random packing); beyond, it thickens (multilayer)`
      : undefined;
  return { plan, errors: [], warnings, tIdx, layer };
}

// ---- the read-out ----

export type SgField = { key: string; label: string; short: string; unit: string };
export type SgSummary = { peak: number[]; end: number[]; cal?: SgCal; sigma?: number; lodRIU?: number; lodG?: number; lodNM?: number; irreversible?: boolean };
export type SgResult = {
  along: 'theta' | 'lambda';
  xs: number[]; // the grid of the curves (a window of W points of it per series and time, from i0)
  W: number;
  i0: Int32Array; // per (series, time)
  unit: string; // of the read-out (° or nm; a parameter at a point: its own)
  times: number[];
  nK: number;
  nT: number;
  seeds: number[]; // the noise seeds (one entry, 0: no noise)
  exact: Float64Array; // per (series, time) the W points of its window, without the instrument
  measured: Float32Array[] | null; // per seed: R through the instrument (null without one)
  fields: Record<string, Float64Array>; // per (seed, series, time): index (s·nK + k)·nT + j
  meta: SgField[];
  rows: string[];
  summary: SgSummary;
  nP: number;
  lam0: number;
  quantity: SgQuantity; // of the curves over the scan (R for the resonance)
  at: number; // a quantity at a point: where it is read
  atAuto: boolean;
};

const interp = (xs: ArrayLike<number>, ys: ArrayLike<number>, x: number) => {
  const n = xs.length;
  const asc = xs[n - 1] >= xs[0];
  for (let i = 0; i + 1 < n; i++) {
    const [a, b] = [xs[i], xs[i + 1]];
    if ((asc && x >= a && x <= b) || (!asc && x <= a && x >= b)) return ys[i] + ((ys[i + 1] - ys[i]) * (x - a)) / (b - a || 1);
  }
  return NaN;
};

// The sensorgram from the computed reflectance: the instrument (one measured run per seed), the read-out, the shift
// from the start of every series, the layer and the surface, the summary, the calibration and the detection limit.
export function sgFinish(s: SgSettings, kin: SgKinetics, plan: SgPlan, tIdx: number[], exact: Float64Array, ex: { i0: Int32Array; edge: Uint8Array; pos: Float64Array; rmin: Float64Array; val: Float64Array; nL: Float64Array }, cal: SgCal | null, warnings: string[]): SgResult {
  const { nK, nT } = plan;
  const { xsG, W } = plan.win;
  const nX = W;
  const xs = xsG.slice(0, W); // (every window has the same step: the blur of the instrument sees the same grid)
  const qInfo = SG_QUANTITIES[plan.quantity];
  const inst = qInfo.intensity ? instrumentOf(s.inst, plan.along) : null;
  const noise = !!inst && noisy(inst);
  const seeds = noise ? (s.seeds.length ? s.seeds : [1]) : [0];
  const measured = inst ? seeds.map((sd) => Float32Array.from(measure(exact, xs, inst, sd))) : null;
  const nS = seeds.length;
  const N = nS * nK * nT;
  const pos = new Float64Array(N).fill(NaN);
  const rmin = new Float64Array(N).fill(NaN);
  const loc = { method: s.locate, level: s.locLevel, deg: s.locDeg };
  let edge = false;
  for (let si = 0; si < nS; si++)
    for (let q = 0; q < nK * nT; q++) {
      const o = si * nK * nT + q;
      const ys = measured ? measured[si].subarray(q * nX, (q + 1) * nX) : exact.subarray(q * nX, (q + 1) * nX);
      const xq = xsG.slice(ex.i0[q], ex.i0[q] + W);
      if (plan.readout === 'value') {
        pos[o] = measured ? interp(xq, ys, plan.at) : ex.val[q];
        continue;
      }
      const e = locate(xq, ys, 0, nX - 1, 'min', loc);
      if (e.i <= 0 || e.i >= nX - 1 || ex.edge[q]) edge = true;
      const useExact = !measured && plan.track && Number.isFinite(ex.pos[q]);
      pos[o] = useExact ? ex.pos[q] : e.x;
      rmin[o] = useExact ? ex.rmin[q] : e.y;
    }
  if (edge) warnings.push(`The dip reaches the end of the ${plan.along === 'theta' ? 'θ' : 'λ'} scan at some times: widen the scan.`);
  const shift = Float64Array.from(pos, (v, o) => (qInfo.phase && plan.readout === 'value' ? wrap180(v - pos[o - (o % nT)]) : v - pos[o - (o % nT)]));
  const binding = plan.binding && !kin.swelling;
  const an = kin.analyte;
  const each = (f: (k: number, j: number) => number) => {
    const a = new Float64Array(N);
    for (let o = 0; o < N; o++) a[o] = f(Math.floor(o / nT) % nK, o % nT);
    return a;
  };
  const G = (k: number, j: number) => (kin.swelling ? 0 : Math.max(0, kin.runs[k].R[tIdx[j]]) / 1000);
  const fields: Record<string, Float64Array> = {
    pos,
    shift,
    dL: each((k, j) => plan.d[k * nT + j]),
    nL: each((k, j) => ex.nL[k * nT + j]),
    fV: each((k, j) => plan.f[k * nT + j]),
  };
  const readU = plan.readout === 'value' ? qInfo.unit : plan.along === 'theta' ? '°' : 'nm';
  const ax = plan.along === 'theta' ? 'θ' : 'λ';
  const what = plan.binding ? 'binding' : 'target';
  const meta: SgField[] = [
    { key: 'shift', label: plan.readout === 'value' ? `Δ${qInfo.short} (from the start)` : `Δ${ax} of the resonance (from the start)`, short: plan.readout === 'value' ? `Δ${qInfo.short}` : `Δ${ax}`, unit: readU },
    { key: 'pos', label: plan.readout === 'value' ? `${qInfo.short} at ${ax} = ${+plan.at.toPrecision(6)}${plan.along === 'theta' ? '°' : ' nm'}${plan.atAuto ? ' (the resonance)' : ''}` : `${ax} of the resonance`, short: plan.readout === 'value' ? qInfo.short : `${ax} res.`, unit: readU },
  ];
  if (plan.readout === 'dip') {
    fields.Rmin = rmin;
    meta.push({ key: 'Rmin', label: 'R at the resonance', short: 'R min', unit: '' });
  }
  meta.push(
    { key: 'dL', label: `height (thickness) of the ${what} layer`, short: 'd layer', unit: 'nm' },
    { key: 'nL', label: `index of the ${what} layer at ${+plan.lam0.toFixed(1)} nm`, short: 'n layer', unit: '' },
    { key: 'fV', label: kin.swelling ? 'solvent volume fraction in the layer' : `analyte volume fraction in the ${what} layer`, short: 'f', unit: '' },
  );
  if (!kin.swelling) {
    fields.Gamma = each(G);
    meta.push({ key: 'Gamma', label: 'Γ — bound mass', short: 'Γ', unit: 'ng/mm²' });
  }
  if (binding) {
    const S = (k: number) => kin.surfaces[k];
    const num = (k: number, j: number) => (G(k, j) * 1e-21) / S(k).mass; // molecules per nm²
    fields.deq = each((k, j) => G(k, j) / an.rho);
    fields.cover = each((k, j) => (num(k, j) * Math.PI * S(k).foot ** 2) / 4);
    fields.jam = each((k, j) => G(k, j) / S(k).capacity);
    fields.num = each((k, j) => num(k, j) * 1e6);
    fields.spacing = each((k, j) => (num(k, j) > 0 ? 1 / Math.sqrt(num(k, j)) : NaN));
    meta.push(
      { key: 'deq', label: 'equivalent compact thickness d = Γ/ρ (what an SPR fit at the protein index reports)', short: 'd eq', unit: 'nm' },
      { key: 'cover', label: 'coverage — fraction of the surface under the molecules (footprints)', short: 'coverage', unit: '' },
      { key: 'jam', label: 'Γ / Γ∞ — fraction of a full random monolayer (jamming)', short: 'Γ/Γ∞', unit: '' },
      { key: 'num', label: 'molecules per µm²', short: 'N', unit: 'µm⁻²' },
      { key: 'spacing', label: 'mean distance between the molecules (1/√N)', short: 'spacing', unit: 'nm' },
    );
  }

  // the summary: the change of every series (the first seed), the surface where the most is bound
  const at = (k: number, j: number) => k * nT + j;
  const fmtS = (v: number) => `${+v.toPrecision(4)}${readU === '°' ? '°' : readU ? ` ${readU}` : ''}`;
  const p3 = (v: number) => `${+v.toPrecision(3)}`;
  const peak = Array.from({ length: nK }, (_, k) => Array.from({ length: nT }, (_, j) => shift[at(k, j)]).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0));
  const end = Array.from({ length: nK }, (_, k) => shift[at(k, nT - 1)]);
  const rows = [`largest change ${peak.map(fmtS).join(', ')}; at the end ${end.map(fmtS).join(', ')}`];
  if (binding) {
    const g = fields.Gamma;
    const kB = Array.from({ length: nK }, (_, k) => k).reduce((b, k) => (g[at(k, nT - 1)] > g[at(b, nT - 1)] ? k : b), 0);
    let om = at(kB, 0);
    for (let j = 0; j < nT; j++) if (g[at(kB, j)] > g[om]) om = at(kB, j);
    const o = at(kB, nT - 1);
    rows.push(
      `${nK > 1 ? `${kin.seriesLabel(kB)}, ` : ''}most bound: Γ ${p3(g[om])} ng/mm² = ${p3(100 * fields.jam[om])} % of a random monolayer, coverage ${p3(100 * fields.cover[om])} %, ${p3(fields.num[om])} molecules/µm², ${p3(fields.spacing[om])} nm apart; layer ${p3(fields.dL[om])} nm (d eq ${p3(fields.deq[om])} nm)${o !== om ? `; at the end Γ ${p3(g[o])} ng/mm²` : ''}`,
    );
  }
  const summary: SgSummary = { peak, end, cal: cal ?? undefined };
  if (cal) {
    const per = (v: number) => `${+v.toPrecision(3)}${readU === '°' ? '°' : readU ? ` ${readU}` : ''}`;
    rows.push(`calibration: ${cal.perG !== undefined ? `1 ng/mm² (1000 RU) → ${per(cal.perG)}${plan.binding ? '' : ' (in the film)'}, ` : ''}buffer index: ${per(cal.perN)} per RIU`);
    // the detection limit: 3σ of the read-out over the first, analyte-free step (the first series, every seed)
    const st0 = kin.steps[0];
    if (noise && st0 && !(st0.c > 0)) {
      const dev: number[] = [];
      let groups = 0;
      for (let si = 0; si < nS; si++) {
        const v: number[] = [];
        for (let j = 0; j < nT; j++) if (kin.t[tIdx[j]] <= st0.t1 + 1e-9 && Number.isFinite(pos[si * nK * nT + j])) v.push(pos[si * nK * nT + j]);
        if (!v.length) continue;
        groups++;
        const m = v.reduce((a, x) => a + x, 0) / v.length;
        dev.push(...v.map((x) => x - m));
      }
      if (dev.length >= 5) {
        const sigma = Math.sqrt(dev.reduce((a, x) => a + x * x, 0) / (dev.length - groups));
        summary.sigma = sigma;
        summary.lodRIU = (3 * sigma) / Math.abs(cal.perN);
        const parts = [`noise σ ${per(sigma)} (first step, ${dev.length} points)`, `3σ: ${summary.lodRIU.toExponential(1)} RIU`];
        if (cal.perG !== undefined && plan.binding) {
          const lg = (3 * sigma) / Math.abs(cal.perG);
          summary.lodG = lg;
          parts.push(`${+lg.toPrecision(2)} ng/mm² = ${+(lg * 1000).toPrecision(2)} RU`);
          const p = rsaModel(s.model) ? kin.setups[0].p : null;
          if (p && lg * 1000 < 0.99 * p.rmax) {
            const R = lg * 1000;
            const free = p.rsa ? p.rmax * blocking(R / p.rmax) : p.rmax - R;
            if (p.kd > 0) {
              summary.lodNM = ((p.kd * R) / (p.ka * free)) * 1e9;
              parts.push(`${+summary.lodNM.toPrecision(2)} nM at equilibrium`);
            } else {
              summary.irreversible = true;
              parts.push('any concentration, given time (irreversible)');
            }
          }
        }
        rows.push(`detection limit: ${parts.join(' · ')}`);
      } else rows.push('detection limit: the first (analyte-free) step is too short for the noise (≥ 5 times)');
    } else if (!noise) rows.push('detection limit: turn on the detector noise (and start with an analyte-free step)');
    else rows.push('detection limit: start the protocol with an analyte-free step (its noise gives σ)');
  }
  if (plan.readout === 'value') rows.unshift(`${qInfo.short} read at ${ax} = ${+plan.at.toPrecision(6)}${plan.along === 'theta' ? '°' : ' nm'}${plan.atAuto ? ' — the resonance at the start' : ''}`);
  rows.push(`${nT} times × ${nX} points of ${ax}${nK > 1 ? ` × ${nK} series` : ''}${noise && nS > 1 ? ` × ${nS} seeds` : ''}${kin.swelling ? '' : `; analyte n = ${plan.nP.toFixed(4)} at ${+plan.lam0.toFixed(1)} nm`}`);
  return { along: plan.along, xs: xsG, W, i0: ex.i0, unit: readU, times: tIdx.map((j) => kin.t[j]), nK, nT, seeds, exact, measured, fields, meta, rows, summary, nP: plan.nP, lam0: plan.lam0, quantity: plan.quantity, at: plan.at, atAuto: plan.atAuto };
}
