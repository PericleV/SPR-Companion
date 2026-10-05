// Binding kinetics at a sensor surface (the Sensorgram page): the bound response R(t) in RU (Biacore convention:
// 1000 RU ≈ 1 ng/mm² of protein, Stenberg et al., J. Colloid Interface Sci. 143, 513 (1991)) along a protocol of
// injections, or the swelling s(t) of a polymer layer. Pure; model/sensorgram.ts turns it into optics.
//
// Models (C = analyte concentration in the flow, M; R in RU):
//   1:1 Langmuir           dR/dt = ka C (Rmax − R) − kd R
//   mass transport (kt)    the same divided by 1 + ka (Rmax − R)/kt (two-compartment model, quasi-steady state;
//                          D. G. Myszka et al., Biophys. J. 75, 583 (1998)); kt in RU M⁻¹ s⁻¹
//   bivalent analyte       A + B ⇌ AB (2·ka1, kd1), AB + B ⇌ AB₂ (ka2 in RU⁻¹ s⁻¹, 2·kd2); B = Rmax − AB − 2AB₂, R = AB + AB₂
//   heterogeneous ligand   two independent 1:1 sites (ka1, kd1, Rmax1), (ka2, kd2, Rmax2)
//   two-state (conform.)   A + B ⇌ AB (ka1, kd1), AB ⇌ AB* (ka2, kd2 in s⁻¹); R = AB + AB*
//   polymer swelling       ds/dt = (s∞ − s)/τ, s∞ set by each step (e.g. a pH or temperature step); no R
// A regeneration step removes the bound analyte at its start; drift adds drift·t to R (0 here: the drift of a
// measurement is a change of the buffer index, set in the Sensorgram).
//
// The surface (1:1 models): either ligand sites (Rmax typed, the free sites Rmax − R), or a free surface on which the
// molecules adsorb at random places and cannot overlap — random sequential adsorption (RSA) of discs: the area left
// for a new molecule is the blocking function Φ(θ) (Schaaf & Talbot, J. Chem. Phys. 91, 4401 (1989)), which vanishes at
// the jamming coverage θ∞ = 0.547 (Hinrichsen, Feder & Jøssang, J. Stat. Phys. 44, 793 (1986)): dR/dt = ka C Rmax Φ − kd R
// with Rmax the jamming capacity. Charged molecules repel each other across the double layer: they behave as hard
// discs of an effective diameter d + h*, where the pair energy (linear superposition, spheres of radius a = d/2)
//   φ(h) = 4π ε ε₀ (kT/e)² Y² a²/(2a + h) · e^(−κh),  Y = 4 tanh(eζ/4kT)
// falls to φch = 1 kT (the effective hard particle of Z. Adamczyk, e.g. Curr. Opin. Colloid Interface Sci. 17, 173
// (2012)); κ⁻¹ = 0.304 nm / √I[M] (1:1 salt, 25 °C).

export type KineticModel = 'langmuir' | 'transport' | 'bivalent' | 'hetero' | 'twostate' | 'swelling';
export type KineticStep = { label: string; t: number; c: number; regen?: boolean; swell?: number }; // t: duration (s), c: M
export type KineticParams = {
  rsa?: boolean; // 1:1 / transport: a free surface (RSA blocking, rmax = the jamming capacity) instead of ligand sites
  model: KineticModel;
  ka: number; // M⁻¹ s⁻¹ (ka1)
  kd: number; // s⁻¹ (kd1)
  rmax: number; // RU (site 1 for 'hetero')
  kt: number; // RU M⁻¹ s⁻¹ (transport)
  ka2: number; // bivalent: RU⁻¹ s⁻¹; hetero: M⁻¹ s⁻¹; two-state: s⁻¹
  kd2: number; // s⁻¹
  rmax2: number; // RU (hetero site 2)
  tau: number; // s (swelling)
  drift: number; // RU / s
};

export const MODEL_TEXT: Record<KineticModel, string> = {
  langmuir: '1:1 Langmuir',
  transport: '1:1 with mass transport (kt)',
  bivalent: 'bivalent analyte',
  hetero: 'heterogeneous ligand (two sites)',
  twostate: 'two-state (conformational change)',
  swelling: 'polymer swelling',
};

// Analytes: molecular weight (Da), refractive index increment dn/dc (mL/g), density (g/cm³; 1 / partial specific
// volume) and the dimensions a ≥ b ≥ c (nm) of the molecule (an ellipsoid). Lying on the surface (side-on) it covers
// an a × b ellipse (the equivalent disc has the diameter √(ab)) and is c high; standing (end-on) it covers b × c and is
// a high. Typical values: proteins dn/dc ≈ 0.185–0.19 mL/g, ρ ≈ 1.35 g/cm³ (L. S. Jung et al., Langmuir 14, 5636
// (1998): 0.188 mL/g, v = 0.77 mL/g); nucleic acids dn/dc ≈ 0.17 mL/g, ρ ≈ 1.7 g/cm³. Dimensions: IgG 14.2 × 8.5 × 3.8
// nm (Silverton et al., PNAS 74, 5140 (1977)), albumin 14 × 4 × 4 (prolate), streptavidin 5.8 × 5.4 × 4.8, lysozyme
// 4.5 × 3 × 3, myoglobin 4.5 × 3.5 × 2.5, fibrinogen 47.5 × 6 × 6 (Hall & Slayter 1959), dsDNA 20 bp a 6.8 × 2 nm rod.
export type Analyte = { name: string; mw: number; dndc: number; rho: number; dims: [number, number, number] };
export const ANALYTES: Record<string, Analyte> = {
  igg: { name: 'IgG antibody', mw: 150000, dndc: 0.188, rho: 1.35, dims: [14.2, 8.5, 3.8] },
  bsa: { name: 'BSA (albumin)', mw: 66500, dndc: 0.187, rho: 1.36, dims: [14, 4, 4] },
  streptavidin: { name: 'streptavidin', mw: 53000, dndc: 0.188, rho: 1.36, dims: [5.8, 5.4, 4.8] },
  lysozyme: { name: 'lysozyme', mw: 14300, dndc: 0.188, rho: 1.4, dims: [4.5, 3, 3] },
  myoglobin: { name: 'myoglobin', mw: 17800, dndc: 0.19, rho: 1.35, dims: [4.5, 3.5, 2.5] },
  fibrinogen: { name: 'fibrinogen', mw: 340000, dndc: 0.188, rho: 1.35, dims: [47.5, 6, 6] },
  ssdna20: { name: 'ssDNA, 20 nt', mw: 6100, dndc: 0.17, rho: 1.7, dims: [3, 3, 3] },
  dsdna20: { name: 'dsDNA, 20 bp', mw: 12300, dndc: 0.168, rho: 1.7, dims: [6.8, 2, 2] },
  small: { name: 'small molecule (~200 Da)', mw: 200, dndc: 0.2, rho: 1.3, dims: [0.8, 0.6, 0.5] },
};

// ---- The surface: footprint, electrostatic repulsion, jamming capacity ----

export const N_A = 6.02214076e23;
export const THETA_JAM = 0.547; // RSA of discs
const PHI_CH = 1; // kT: the energy that defines the effective hard particle

// Height and footprint (equivalent disc diameter) of a molecule lying (side-on) or standing (end-on), nm.
export function footprint(dims: [number, number, number], orient: 'side' | 'end') {
  const [a, b, c] = [...dims].sort((p, q) => q - p);
  return orient === 'end' ? { height: a, foot: Math.sqrt(b * c) } : { height: c, foot: Math.sqrt(a * b) };
}

export const debye = (ionicMM: number) => 0.304 / Math.sqrt(Math.max(1e-9, ionicMM) / 1000); // nm

// The gap h* (nm) at which the double-layer repulsion of two molecules of diameter d (nm; ζ in mV) falls to φch.
export function hardGap(d: number, zeta: number, ionicMM: number) {
  const kT = 1.380649e-23 * 298.15;
  const kTe = kT / 1.602176634e-19; // V
  const Y = 4 * Math.tanh(zeta / 1000 / (4 * kTe));
  const pref = (4 * Math.PI * 78.5 * 8.8541878128e-12 * kTe * kTe * Y * Y) / kT; // kT per m
  const a = (d / 2) * 1e-9;
  const k = 1 / debye(ionicMM);
  const phi = (h: number) => ((pref * a * a) / (2 * a + h * 1e-9)) * Math.exp(-k * h);
  if (!(phi(0) > PHI_CH)) return 0;
  let lo = 0;
  let hi = 1;
  while (phi(hi) > PHI_CH) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (phi(m) > PHI_CH) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export type Surface = {
  height: number; // nm
  foot: number; // nm (equivalent disc)
  gap: number; // h*, nm
  dEff: number; // foot + h*
  debye: number; // nm
  thetaMax: number; // the largest projected area fraction: θ∞ (foot / dEff)²
  mass: number; // g per molecule
  capacity: number; // ng/mm² at jamming (×1000 = RU)
};

export function surfaceOf(an: Analyte, orient: 'side' | 'end', ionicMM: number, zeta: number): Surface {
  const { height, foot } = footprint(an.dims, orient);
  const gap = hardGap(foot, zeta, ionicMM);
  const dEff = foot + gap;
  const thetaMax = THETA_JAM * (foot / dEff) ** 2;
  const mass = an.mw / N_A;
  const capacity = (thetaMax * mass * 1e21) / ((Math.PI / 4) * foot * foot); // g per nm² × 1e21 = ng/mm²
  return { height, foot, gap, dEff, debye: debye(ionicMM), thetaMax, mass, capacity };
}

// The RSA blocking function of discs, x = θ/θ∞ (Schaaf & Talbot 1989; 1 − 4θ at low coverage).
export const blocking = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return (1 - u) ** 3 * (1 + 0.812 * u + 0.4258 * u * u + 0.0716 * u ** 3);
};

export type KineticResult = { t: number[]; R: number[]; c: number[]; s: number[] };

// Rates of the model: state y → dy/dt at concentration C (the response is resp(y)).
function system(p: KineticParams) {
  // the free sites (RU): ligand Rmax − R, or the area left on a randomly covered surface, Rmax Φ(R/Rmax)
  const free = p.rsa ? (R: number) => p.rmax * blocking(R / p.rmax) : (R: number) => p.rmax - R;
  switch (p.model) {
    case 'langmuir':
      return { n: 1, f: (y: number[], C: number) => [p.ka * C * free(y[0]) - p.kd * y[0]], resp: (y: number[]) => y[0] };
    case 'transport':
      return { n: 1, f: (y: number[], C: number) => [(p.ka * C * free(y[0]) - p.kd * y[0]) / (1 + (p.ka * Math.max(0, free(y[0]))) / p.kt)], resp: (y: number[]) => y[0] };
    case 'bivalent':
      return {
        n: 2,
        f: ([ab, ab2]: number[], C: number) => {
          const b = p.rmax - ab - 2 * ab2;
          const r2 = p.ka2 * ab * b - 2 * p.kd2 * ab2;
          return [2 * p.ka * C * b - p.kd * ab - r2, r2];
        },
        resp: (y: number[]) => y[0] + y[1],
      };
    case 'hetero':
      return { n: 2, f: ([r1, r2]: number[], C: number) => [p.ka * C * (p.rmax - r1) - p.kd * r1, p.ka2 * C * (p.rmax2 - r2) - p.kd2 * r2], resp: (y: number[]) => y[0] + y[1] };
    case 'twostate':
      return {
        n: 2,
        f: ([ab, abx]: number[], C: number) => {
          const r2 = p.ka2 * ab - p.kd2 * abx;
          return [p.ka * C * (p.rmax - ab - abx) - p.kd * ab - r2, r2];
        },
        resp: (y: number[]) => y[0] + y[1],
      };
    case 'swelling':
      return { n: 1, f: ([s]: number[], target: number) => [(target - s) / p.tau], resp: () => 0 };
  }
}

// The fastest rate of the model in the protocol (the first integration step).
function fastest(p: KineticParams, cmax: number) {
  if (p.model === 'swelling') return 1 / Math.max(1e-9, p.tau);
  const r = [(p.rsa ? 4 : 2) * p.ka * cmax + p.kd];
  if (p.model === 'bivalent') r.push(p.ka2 * p.rmax + 2 * p.kd2);
  if (p.model === 'hetero') r.push(p.ka2 * cmax + p.kd2);
  if (p.model === 'twostate') r.push(p.ka2 + p.kd2);
  return Math.max(1e-6, ...r.filter(Number.isFinite));
}

// Dormand–Prince 5(4) tableau (the 5th-order solution propagated, the 4th-order one for the error estimate).
const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const DP_B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]; // b5 − b4

// The protocol integrated with an adaptive step (Dormand–Prince 5(4): relative and absolute tolerance 1e-10 of the
// scale of the response), every step of the protocol and every sample time hit exactly, sampled every dt.
export function simulate(p: KineticParams, steps: KineticStep[], dt: number): KineticResult {
  const sys = system(p);
  const cmax = Math.max(0, ...steps.map((s) => s.c));
  const out: KineticResult = { t: [], R: [], c: [], s: [] };
  let y = new Array<number>(sys.n).fill(0);
  let t = 0;
  const swelling = p.model === 'swelling';
  const scale = swelling ? Math.max(1, ...steps.map((s) => Math.abs(s.swell ?? 0))) : Math.max(1, p.rmax, p.model === 'hetero' ? p.rmax2 : 0);
  const atol = 1e-10 * scale;
  const rtol = 1e-10;
  const emit = (C: number) => {
    out.t.push(t);
    out.R.push(sys.resp(y) + p.drift * t);
    out.c.push(swelling ? 0 : C);
    out.s.push(swelling ? y[0] : 0);
  };
  let h = Math.min(dt, 0.05 / fastest(p, cmax)); // (the first step; then the error decides)
  const k: number[][] = new Array(7);
  const yt = new Array<number>(sys.n);
  let next = 0; // the next sample time
  for (const st of steps) {
    if (st.regen && !swelling) y = y.map(() => 0);
    const drive = swelling ? (st.swell ?? 0) : Math.max(0, st.c);
    const t1 = t + Math.max(0, st.t);
    while (t < t1 - 1e-12) {
      if (t >= next - 1e-9) {
        emit(drive);
        next += dt;
      }
      const stop = Math.min(t1, Math.max(t + 1e-9, next));
      // one accepted step towards `stop` (a rejected one: smaller, again)
      for (;;) {
        const hh = Math.min(h, stop - t);
        k[0] = sys.f(y, drive);
        for (let s = 1; s < 7; s++) {
          for (let i = 0; i < sys.n; i++) {
            let v = y[i];
            for (let j = 0; j < s; j++) v += hh * DP_A[s][j] * k[j][i];
            yt[i] = v;
          }
          k[s] = sys.f(yt, drive);
        }
        let err = 0;
        const yn = y.map((v, i) => {
          let a = v;
          let e = 0;
          for (let j = 0; j < 7; j++) {
            a += hh * DP_B[j] * k[j][i];
            e += hh * DP_E[j] * k[j][i];
          }
          err = Math.max(err, Math.abs(e) / (atol + rtol * Math.max(Math.abs(v), Math.abs(a))));
          return a;
        });
        const grow = err > 0 ? 0.9 * err ** -0.2 : 5;
        if (err <= 1 || hh < 1e-12) {
          y = yn;
          t += hh;
          // (a step shortened to reach a sample or the end of a protocol step does not shrink the next one)
          const hn = hh * Math.min(5, Math.max(0.2, grow));
          h = hh < h ? Math.max(h, hn) : hn;
          break;
        }
        h = hh * Math.max(0.1, grow);
      }
    }
  }
  emit(swelling ? (steps.at(-1)?.swell ?? 0) : (steps.at(-1)?.c ?? 0));
  return out;
}

// The equilibrium response (RU) of a 1:1 model (Langmuir, with transport or not) at concentration C (M): the root of
// ka C free(R) = kd R on [0, Rmax] (free sites Rmax − R, or Rmax Φ(R/Rmax) on a free surface).
export function equilibrium(p: KineticParams, C: number) {
  if (!(C > 0)) return 0;
  const free = (R: number) => (p.rsa ? p.rmax * blocking(R / p.rmax) : p.rmax - R);
  let lo = 0;
  let hi = p.rmax;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (p.ka * C * free(m) - p.kd * m > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// Mass-transport coefficient kt (RU M⁻¹ s⁻¹) from km (m/s), the molecular weight and the response of 1 g/m²:
// kt = km · MW · G, G = 1000 RU per ng/mm² = 1e6 RU per g/m²  (Biacore: kt = km·MW·10⁹ with km in m/s).
export const ktOf = (km: number, mw: number) => km * mw * 1e9;
