// Example projects (Examples… in the top bar), each with its notes (Notes in the top bar: the source, what to look at,
// the benchmark values; the user's own notes are kept with the project). The literature benchmarks are checked by
// scripts/check.ts against the values of the papers.
import { defaultField, defaultProject, defaultSim, defaultSweep, fieldsOf, sprMetrics, type ConfigFields, type Project, type SimSettings } from './project.ts';
import { defaultOpt, newObjective, type Objective } from './optimization.ts';
import { newMetric, newZone } from './metrics.ts';
import { withScanParams, type Exposed } from './exposed.ts';
import type { ParamRef } from './params.ts';
import type { Dbr, Film, MatRef } from './structure.ts';
import { newCurve, newPlot } from './sweep.ts';
import type { MaterialDef } from '../physics/materials.ts';
import { newComponent, type ComponentType, type FitComponent } from '../engine/fitmodels.ts';
import { defaultInstrument } from '../engine/instrument.ts';
import type { SgSettings } from './sensorgram.ts';
import { defaultRough, type Rough } from './rough.ts';

const dbr = (over: Partial<Dbr>): Dbr => ({
  kind: 'dbr', id: 'dbr', label: 'DBR', periods: 8, lambda0: 650, closing: false, mirrorAfterCavity: true, cavities: [],
  period: [{ label: 'H', mat: { id: 'TiO2' }, mode: 'qw', d: 0, layers2D: 1 }, { label: 'L', mat: { id: 'SiO2' }, mode: 'qw', d: 0, layers2D: 1 }],
  ...over,
});
const film = (id: string, mat: string | MatRef, d: number, label = ''): Film => ({ kind: 'film', id, label, mat: typeof mat === 'string' ? { id: mat } : mat, d, layers2D: 1 });
const layer = (label: string, id: string, d: number) => ({ label, mat: { id }, mode: 'nm' as const, d, layers2D: 1 });
const sim = (over: Partial<SimSettings>): SimSettings => ({ ...defaultSim(), ...over, field: { ...defaultField(), ...over.field } });
const exposed = (id: string, ref: ParamRef, name: string, from: number, to: number, step: number, integer = false, opt = false): Exposed => ({
  id, ref, name,
  sweep: { mode: 'step', from, to, step, count: Math.round((to - from) / step) + 1, list: '', integer },
  mats: [],
  opt: { on: opt, min: from, max: to, integer },
});
const constant = (id: string, name: string, n: number, color: string, source: string): MaterialDef => ({ id, name, color, model: { type: 'constant', n, k: 0 }, source });
// a fit component with its start values (and the fixed ones)
const comp = (type: ComponentType, values: Record<string, number>, fixed: string[] = []): FitComponent => {
  const c = newComponent(type);
  return { ...c, params: Object.fromEntries(Object.entries(c.params).map(([k, p]) => [k, { value: values[k] ?? p.value, fixed: fixed.includes(k) || p.fixed }])) };
};
// a dispersion fit: the positions of two metrics (branches) vs an axis of their values
const dispersionFit = (id: string, b1: string, b2: string, along: string, model: 'linear' | 'angle', lo: number, hi: number) =>
  newMetric('fit', { id, ref: id, label: 'Dispersion', source: 'metrics:lambda', along, field: `${b1}.pos`, field2: `${b2}.pos`, lo, hi, fit: { comps: [], guess: false, run: true, mode: 'dispersion', model }, expose: ['rabi'] });
// the exposed λ / θ of the interrogation (with their own sweep values where given)
const finish = (p: Project): Project => ({ ...p, params: withScanParams(p.params, p.sim) });

// ---- benchmark values (the papers) ----
export const TAMM_LU2019 = { tppEv: 0.796, tppAnalyticEv: 0.79, peakNm: 1556, kappa8: 7.97, kappaT8: 1.06, kappa12: 1.6 };
export const RABI_JENA = { cavityEv: 2.483, tppEv: 2.477, lowerEv: 2.416, upperEv: 2.541, rabiMeV: 125, anticrossNm: 141 };
export const HE2021 = { dips: [4237.28814, 3500], lorentzFwhm: 60, gaussSigma: 20, thickness: [50, 850] as [number, number], N: [0.4, 4] as [number, number] };
// Sb₂S₃: Cauchy n = A + B/λ² (λ in µm), calibrated so that the Tamm modes fall where the paper measured them
// Varasteanu & Kusko, Appl. Sci. 11, 4353 (2021): configurations of Tables 2, 4 and 5 (Ag nm, semiconductor nm, layers,
// n, 2D material) with their S (deg/RIU) and FWHM (deg)
export const VARASTEANU2021 = {
  table2: [
    { mat: 'graphene', ag: 43, semi: 11, layers: 1, n: 2.6, S: 331, fwhm: 7.1 },
    { mat: 'graphene', ag: 50, semi: 7, layers: 1, n: 2.83, S: 202, fwhm: 3.9 },
    { mat: 'MoS2', ag: 38, semi: 10, layers: 1, n: 2.62, S: 258, fwhm: 8.9 },
    { mat: 'WS2', ag: 44, semi: 8, layers: 1, n: 2.87, S: 333, fwhm: 7 },
  ],
  table4: [
    { mat: 'graphene', ag: 40, semi: 11, layers: 1, n: 2.66, S: 325, fwhm: 7.1 },
    { mat: 'graphene', ag: 47, semi: 8, layers: 1, n: 2.64, S: 200, fwhm: 4.6 },
    { mat: 'WS2', ag: 41, semi: 9, layers: 1, n: 2.64, S: 314, fwhm: 7.9 },
  ],
  table5: [{ mat: 'graphene', ag: 43, semi: 12, layers: 1, n: 2.405, S: 302, fwhm: 7.1 }], // BaTiO₃, R min < 0.5 %
};
export const SREEKANTH2023 ={ amorphous: [738, 1504], crystalline: [738 + 153, 1504 + 295], cauchyAm: [2.779, 0.12], cauchyCr: [3.3375, 0.25625] };

// ---- the notes ----
const NOTE_KRETSCHMANN = `Kretschmann SPR sensor: BK7 prism | 50 nm Ag | water, angular interrogation at 633 nm (TM).

Metrics: the resonance (FWHM, position, depth), the sensitivity S = Δθ/Δn of the water, the penetration depth of the field into the water (1/e of |E|² from the metal surface) and the propagation length of the plasmon L = 1/Δk (Δk = k₀ n_prism cos θ · FWHM in rad).
The plot shows R on the left axis and the phase of r on the right one (a computed quantity: arg(rRe, rIm)). The plot "Field distribution" (its data: the field inside the stack): |E|² through the stack at the resonance, the 1/e line in the water.

Optimization: the Ag thickness (a parameter with Optimize on) for the deepest resonance, its width as a lesser objective.

Expected: the dip near 68°, R → 0 for d ≈ 50 nm; penetration into water = 1/(2 k₀ √(n_p² sin²θ − n_w²)) ≈ 115 nm (checked); L ≈ 10 µm, about half the intrinsic SPP length (≈ 25 µm) near the optimal coupling, where the radiative loss into the prism equals the absorption.`;

const NOTE_LU = `Benchmark — H. Lu et al., "Induced reflection in Tamm plasmon systems", Opt. Express 27, 5383 (2019).

Structure: air | Ag 30 nm (Drude: ε∞ 3.7, ωp 9.1 eV, γ 0.018 eV) | (Si₃N₄ 160 nm, n 2.2 · SiO₂ 275 nm, n 1.45)×24 with an Al₂O₃ defect (258 nm, n 1.76) after M periods | air; TM, 0°, λ 1535–1578 nm.

Paper: Tamm plasmon dip 0.796 eV (TMM; analytic 0.790 eV) without the defect; the defect mode couples to it and opens a narrow induced-reflection peak at 1556 nm; coupled-oscillator fit of the absorption: κ = 7.97·10¹² rad/s and κT = 1.06·10¹² rad/s for M = 8; κ falls with M (Fig. 8b: ≈ 1.6·10¹² rad/s at M = 12).

Here: the metric "Coupled oscillators" fits A = 1 − R − T (baseline + coupled oscillators, start values as in the paper's fit, r fixed at 0 — a dark defect mode) in 1538–1575 nm; its values give κ, κT, γ₁, γ₂ in 10¹² rad/s. The dashed curve is the start, the solid one the fit, the dotted ones each component.
Run the sweep (M = 8 … 16): the plot "κ vs the swept parameter" shows the coupling falling with the distance between the metal and the defect (Fig. 8b); the slider of the Response plot picks the curve whose values the metrics show.

The other panels of Fig. 8 (κ vs one parameter, the others at their nominal values): in Sweep parameters replace M by
 · ds — the defect thickness (Fig. 8a, around 258 nm; set M back to 8 … or the value you want on the Structure page),
 · dB — the Si₃N₄ thickness (Fig. 8c),
 · ns — the defect index (Fig. 8d, the n of the Al₂O₃ material),
 · da — the Ag thickness (Fig. 8e),
then Run; the κ plot follows (choose its X). Fig. 8f (κ vs θ, TM): Mode → Dispersion map, θ 0–12°: the fit runs along λ for every angle, and the κ plot can use θ as X.

Checked (scripts/check.ts): dip 0.796 eV, analytic 0.790 eV, peak 1556 nm, κ(8) = 7.97 ± 2 %, κT(8) = 1.06 ± 0.03, κ(12) ≈ 1.6 ± 5 %.`;

const NOTE_JENA = `Benchmark — S. Jena, R. B. Tokas, S. Thakur, D. V. Udupa, "Rabi-like splitting and refractive index sensing with hybrid Tamm plasmon-cavity modes" (Strong coupling of Tamm plasmons and Fabry–Perot modes in a 1D photonic crystal), arXiv:2105.01888.

Structure: air | Ag 35 nm (Drude: ε∞ 5, ωp 1.36·10¹⁶ rad/s, γ 6.6·10¹³ rad/s) | spacer S (n 1.47, ds swept 115–170 nm) | (H 1.96 · 64 nm, L 1.47 · 85 nm)⁵ C (1.47, 85 nm) (HL)⁵ | glass 1.52; normal incidence, λ 450–560 nm.

Paper: bare cavity 2.483 eV, bare Tamm plasmon 2.477 eV; at ds = 141 nm the hybrid modes are at 2.416 / 2.541 eV → Ω = 125 meV; anticrossing at ds = 141 nm.

Here: press Run (the sweep of ds). The map R(λ, ds) shows the anticrossing; the metrics "Branch 1/2" find the two dips (FWHM in 455–499 and 499–555 nm) for every ds; the metric "Dispersion" — a Fit whose data are the values of those metrics (their positions b1.pos, b2.pos along ds), model "dispersion of two branches" — fits them with the coupled-oscillator dispersion (mode 2 linear in ds) in its ROI ds 125–160 nm: Ω in meV and the zero detuning. The fitted branches are drawn on the map and on the plot of the positions vs ds.

Checked: modes at ds = 141 nm within 4 meV of 2.416 / 2.541 eV, Ω = 125 ± 4 meV, zero detuning at 141 ± 2 nm.`;

const NOTE_HE = `Benchmark — M. He, J. R. Nolen, J. Nordlander et al., "Deterministic inverse design of Tamm plasmon thermal emitters with multi-resonant control", Nat. Mater. 20, 1663 (2021), after their published code.

Structure: air | (Ge 4.0 / SiO 2.25)⁴ Ge | CdO (doped, Drude: ε∞ 5.1, m* 0.1, μ 200 cm²/Vs, carrier density N) | SiO substrate; TE, 0°, λ 2850–6670 nm.

Target (the metric "Match: full spectrum"): R = 1 − a Lorentzian dip at 4237.3 nm (the CO₂ band, FWHM 60 nm) − a Gaussian dip at 3500 nm (σ 20 nm); cost MSE + 0.01·(max error)². The second match counts only the resonances (where the target is < 0.95).

Optimization (their schedule): Adam, 650 steps, 4 starts, lr 0.05 × 0.7 every 100 steps; stage 1 = 200 steps at lr 0.01 on the resonances only, stage 2 = the full spectrum (the stage switches in the Algorithm card). Variables: the ten thicknesses (50–850 nm, start 450) and N (0.4–4·10²⁰ cm⁻³).
Differences from their code: finite-difference gradients (no automatic differentiation), the whole spectrum at each step.

Expected: both dips formed at the target positions (the paper's designs reach R < 0.1 at both); the costs fall by orders of magnitude from the start.`;

const NOTE_SREEKANTH = `Benchmark — K. V. Sreekanth et al., "Tunable Tamm plasmon cavity as a scalable biosensing platform for surface enhanced resonance Raman spectroscopy", Nat. Commun. 14, 7085 (2023).

Structure: air | Au 20 nm | (Sb₂S₃ 170 nm / SiO₂ 100 nm)×5 (Sb₂S₃ next to the gold) | quartz; normal incidence.

Paper: with amorphous Sb₂S₃ two Tamm modes, TPP 2 at 738 nm (second-order band) and TPP 1 at 1504 nm (first-order band); crystallizing Sb₂S₃ red-shifts them by 153 nm and 295 nm.

Optical constants: Sb₂S₃ is not in the library (refractiveindex.info has no entry). Both phases are Cauchy models n = A + B/λ² (λ in µm, k = 0 — the paper uses Sb₂S₃ beyond its absorption edge) calibrated here so that the two Tamm modes fall at the measured wavelengths: amorphous A 2.779, B 0.120 (n ≈ 3.00 at 738 nm, 2.83 at 1504 nm); crystalline A 3.338, B 0.256 (n ≈ 3.66 at 891 nm, 3.42 at 1799 nm) — in the range of published ellipsometry (a-Sb₂S₃ ≈ 2.8–3.0, c-Sb₂S₃ ≈ 3.3–3.7). So this example checks the structure and the shifts, not independent optical constants: replace them by measured data (Materials) when you have them.

Here: the phase is a swept material parameter (amorphous, crystalline): press Run. The metrics TPP 1 / TPP 2 find the two dips with a region that follows the phase.`;

const NOTE_SC = `Strong coupling of an exciton and a cavity (as spr-forge's example): air | (TiO₂/SiO₂) λ₀/4 at 652.5 nm ×6 | exciton layer | ×6 | BK7. The exciton layer: ε∞ 2.56 with one Lorentz oscillator at 1.9 eV (652.5 nm), γ 50 meV, f 0.06.

Press Run: the cavity thickness is swept 150–260 nm; the map R(λ, d) shows the polariton anticrossing. "Upper / Lower polariton" (FWHM of the dips in 590–652.5 and 652.5–720 nm) are the two branches; "Dispersion" fits them with the coupled-oscillator dispersion (mode 2 linear in d, so fitted near the anticrossing, d 170–220 nm): the exciton (mode 1), the splitting Ω (nm and meV), the thickness of zero detuning. The fitted branches and the uncoupled modes are drawn on the map.`;

const NOTE_SC_ANGLE = `Polaritons vs angle: the same microcavity with the cavity at 215 nm (red-detuned at 0°). Tilting blue-shifts the cavity mode, E_c(θ) = E₀/√(1 − sin²θ/n_eff²), through the exciton.

The interrogation is a dispersion map (λ 560–760 nm × θ 0–40°), computed at once. The long-λ branch (lower polariton) is found in a region that follows θ (652.5–705 nm at 0°, 645–690 nm at 40°): a fixed window would catch the edge of the stop band from ~30° on. Edit the zone by dragging its points on the map, or draw one (Draw region in the metric). "Dispersion" (a Fit of the two branch positions along θ, model "cavity vs angle") is fitted in 0–30° (beyond, the exciton-like branch is too weak): λ₀ of the cavity, n_eff, Ω, the angle of zero detuning.`;

const NOTE_MULTIFIT = `Fit of several components: the hybrid Tamm–cavity structure of Jena et al. at ds = 141 nm has two dips (≈ 488 and 513 nm).

The metric "Two Lorentzians" fits R in 470–530 nm with a baseline and two Lorentzians: the start (dashed), the fit (solid) and each component alone (dotted); the Shown switches show or hide each of them. Every parameter is a result of the metric (any result can be a goal of the optimization). "Coupled oscillators" (off: switch it on) fits the same dips as two coupled modes: Ω, κ, γ₁, γ₂.

Try: switch off "Guess on every curve", change a start value and press Fit; the lock (fixed) keeps a value.`;

const NOTE_BRAGG = `Bragg mirror: air | (TiO₂ / SiO₂)×8, λ₀/4 at 650 nm | BK7, spectral at normal incidence.

The metric "Stop band" (a peak / band) gives the band width at half height and its centre. Sweep the number of periods (Sweep a parameter: periods N) to see the band saturate. Expected: the width tends to the analytic Δλ = (4λ₀/π)·asin((nH − nL)/(nH + nL)) for many periods.`;

const NOTE_CAVITY = `DBR microcavity: air | (HL)⁶ 2L (LH)⁶ at 650 nm | BK7 — a cavity mode in the stop band.

Metrics: the mode (FWHM, Q), its sensitivity to the cavity index, the stop band. The plot "Field distribution": |E|² at the mode (the field peaks in the cavity). Optimization: the cavity position and N for the highest Q with a deep mode.`;

const NOTE_TAMM = `Tamm plasmon: BK7 | (LH)⁸ at 650 nm | 40 nm Ag | air, illuminated through the DBR (s-pol). The Tamm mode is a dip in the stop band; the field (the plot "Field distribution") is confined at the metal / mirror interface. The Ag thickness is a parameter.`;

const NOTE_SEBEK = `SPR sensor with 2D materials (M. Sebek et al., ACS Omega 8, 20792 (2023)): CaF₂ | 17 L hBN | 12 nm Al | 28 nm Ag | 17 L hBN | water, angular at 633 nm. The Optimization page, tab "SPR design by layer sequences", runs their genetic algorithm (the fitness can be S, S/FWHM, several objectives or a formula).`;

const NOTE_NSGA = `Benchmark — P. Varasteanu, M. Kusko, "A Multi-Objective Optimization of 2D Materials Modified Surface Plasmon Resonance (SPR) Based Sensors: An NSGA II Approach", Appl. Sci. 11, 4353 (2021).

Structure: BK7 | Ag | thin semiconductor (thickness and index n are variables) | 2D material (graphene, MoS₂ or WS₂; number of layers) | analyte 1.332 → 1.337 (Δn = 0.005); TM, 633 nm, angular. Materials as in the paper: Ag by the Drude formula of λc = 17.614 µm, λp = 0.14541 µm; graphene 3 + i·5.446·λ/3 (0.34 nm per layer); MoS₂ 5.0805 + 1.1724i (0.65 nm); WS₂ 4.8937 + 0.3123i (0.8 nm).

Problem (Table 1): Ag 0–100 nm, semiconductor 0–50 nm (integers), n 1.34–4, 1–10 layers. Objectives: maximize S, minimize the FWHM, minimize R at the resonance. Constraints: S > 200 deg/RIU, FWHM < 10°, R at the resonance < 1 %. NSGA-II with SBX crossover and polynomial mutation (pymoo's defaults: crossover 0.9, η 15; mutation η 20), population 500 in the paper (100 here: change it in the Algorithm card).

Paper's results: Table 2 (S and FWHM only) — graphene 43 nm–11 nm–1 L (n 2.6): S 331 deg/RIU, FWHM 7.1°; WS₂ 44–8–1 L (2.87): 333, 7.0; MoS₂ 38–10–1 L (2.62): 258, 8.9. Table 4 (R at the resonance too) — graphene 40–11–1 L (2.66): 325, 7.1; WS₂ 41–9–1 L (2.64): 314, 7.9. Table 5 — BaTiO₃ (n 2.405) 43–12–1 L graphene: 302, 7.1, R < 0.5 %.

Here: Goals has the three objectives and the three constraints C1–C3: NSGA-II keeps the feasible solutions first (Deb's constrained domination); the Pareto front lists them, choose one and apply it. The structure starts at Table 4's first design. The 2D material: a material parameter (choose it on the Structure page, or switch Optimize on to let NSGA-II choose). For Table 2, switch off the R objective and constraint.

Checked (scripts/check.ts): the paper's designs recomputed here (S, FWHM), and a short NSGA-II run finding feasible designs as good as the paper's.`;

const NOTE_ZONES = `Zones: a metric that adds up regions of the axis where a quantity is to be high or low — here the mean R in 600–700 nm (maximize, green) and in 400–500 nm (minimize, red). Its score (Σ maximized − Σ minimized) is the objective; each zone's value can be one too (Goals on the Optimization page).

The Bragg mirror's H and L thicknesses and its number of periods are optimized (differential evolution): press Start on the Optimization page and apply the result. Any quantity can be used in a zone (T, A, a computed quantity), with its mean, minimum, maximum or integral.`;

const NOTE_COMPARE = `Two configurations in one project (the menu at the top right switches between them): "Tamm plasmon (0°)" — BK7 | (LH)⁸ at 650 nm | 40 nm Ag | air, spectral at normal incidence (s-pol) — and "SPR at 68°" — BK7 | 50 nm Ag | water, spectral at 68° (TM). Each has its own structure, interrogation, metrics and plots.

The Compare page shows both side by side (their stacks, layers, metrics) and the plot "Tamm vs SPR" puts the R of both on the same λ axis, each with its configuration's metrics (the dip, its width): the Tamm mode is a narrow dip in the stop band, the SPR a broad one near 622 nm. Add curves (T, A, the phase, the values of the metrics in a sweep) from either configuration with "Add curve".`;
const NOTE_GH = `Benchmark — L. Han et al., "Giant Goos-Hänchen Shifts in Au-ITO-TMDCs-Graphene Heterostructure and Its Potential for High Performance Sensor", Sensors 20, 1028 (2020).

Structure (as in the paper, at 632.8 nm, TM): SF11 prism (1.7786) | BK7 100 nm (1.5151) | Au 50 nm (0.181 + 3.068i) | ITO 10 nm (1.858 + 0.058i) | graphene × N (3.0 + 1.149i, 0.34 nm per layer) | water (1.330). Two configurations: "Au–ITO" and "Au–ITO–graphene" with N swept 1 … 5 (press Run).

Quantities: the phase of r (φr), its slope along the scan, and the Goos–Hänchen shift GH = −(1/2π) dφr/dθ in wavelengths (the stationary-phase formula of the paper, S = −(λ/2π) dψ/dθ); the beam displacement perpendicular to the beam is λ·GH/n₁. Metrics: the dip, the GH shift (the largest |GH|, ΔGH/Δn) and the phase (the largest slope, Δφ/Δn).

The paper: Au–ITO dip at 59.47°, Rmin 0.0313, GH 51.95 λ; graphene ×1: 59.83°, Rmin 0.0154, 63.89 λ; ×2: 89.06 λ; ×3: 168.5 λ; ×4: Rmin 1.98·10⁻⁶ at 61.01°, −241.2 λ; ×5: −134.7 λ (positive for a Z-shaped phase, negative for a Lorentzian-like one).

Here (scripts/check.ts): the dips (angles, Rmin) as in the paper, the signs of the GH shift, and its ratios between the structures (×1/×0 1.230, ×2/×0 1.714, ×3/×0 3.24, ×5/×0 −2.59) within 0.5 %. The absolute GH values are 3.58 times smaller than the paper's for all five (a normalization the paper does not state; our formula is checked against Artmann's exact result for total internal reflection). ×4 is near-singular (R ≈ 2·10⁻⁶): its GH depends on the angular step (the paper's −241 λ comes from a coarser grid). The GH sensitivity of Au–ITO (Δn = 0.002, the largest change over the angles): with the paper's normalization 5.6 λ, the paper 5.47 λ (2735 λ/RIU).`;

// ---- Sensorgrams: binding kinetics turned into the SPR signal (the Sensorgram page) ----

const NOTE_SG_FIRST = `Your first SPR binding experiment — open the Sensorgram page (left menu). No theory needed; read the cards from top to bottom.

The chip: light (633 nm, TM) goes through a BK7 prism onto 50 nm of gold; on the other side is the buffer (water). At one angle the light excites a surface plasmon — a wave of the gold's electrons, bound to its surface on the water side — and the reflected light drops: the dip (Simulation page). Molecules that bind to the gold change what the plasmon feels: the dip moves to a larger angle. Following the dip in time is the sensorgram.

1 · Analyte and surface: an IgG antibody, lying on the surface. The table below gives its height, its footprint, and how much a full random monolayer holds (Γ∞).
2 · Binding kinetics: the antibody binds one-to-one to sites on the chip, association rate ka, dissociation rate kd, at most Rmax. The protocol: buffer (baseline), the antibody at 50 nM (association), buffer again (dissociation). The card "Bound amount" on the right shows it at once (Add plot, at the bottom of the right column, brings the other plots), in RU (1000 RU = 1 ng/mm²).
3 · Signal and read-out: the bound antibodies form a thin layer on the gold (as high as the molecule); the injected solution itself has a slightly higher index (the bulk effect: a small step when the injection starts and ends). Press Run: the reflectance is recomputed at every time and the dip followed.
4 · The results: the sensorgram (Δθ of the dip vs time), the summary (the largest shift, how much of the gold is covered, the calibration in degrees per ng/mm²), the reflectance curves R(θ) at the end of every step.

Try: a higher concentration or a smaller kd (Binding kinetics), gold 40 or 60 nm (Structure page), TE polarization (Simulation page: the dip disappears), and in Instrument the detector noise — a measured-looking curve and the detection limit.`;

const NOTE_SG_SERIES = `Antibody binding, a concentration series (1:1) — the Sensorgram page.

An IgG antibody binds to its antigen on a gold chip (BK7 | Au 50 nm | buffer, 633 nm, TM): 1:1 kinetics, ka = 2·10⁵ M⁻¹s⁻¹, kd = 5·10⁻⁴ s⁻¹ (KD = 2.5 nM), Rmax = 2500 RU, along baseline → association → dissociation, for five concentrations (Series: 12.5 … 200 nM; each value scales the injection).

Caught by its antigen, the antibody stands on the surface (end-on: 14.2 nm high, a 5.7 nm footprint); a random end-on monolayer holds 5.4 ng/mm², so Rmax is 47 % of it. The bound mass (1000 RU = 1 ng/mm²) fills a layer as high as the molecule (de Feijter), the flowing solution adds its bulk index; the dip is followed exactly at every time.

Look at: the sensorgram (also the coverage, molecules per µm², their spacing — the quantity menu), the steady-state card (R at the end of each injection vs c, a Langmuir fit: the 400 s injections do not reach equilibrium at the low concentrations, so the steady-state KD is biased — the card says so), and "Plan a concentration series" in Binding kinetics: five concentrations around KD and the injection length that reaches 95 % of equilibrium (Apply, then Run).`;

const NOTE_SG_SWELL = `A swelling hydrogel — the Sensorgram page.

A 40 nm hydrogel (collapsed n = 1.50) on BK7 | Au 50 nm in water swells to 2.5× its thickness and collapses again (Binding kinetics: polymer swelling, τ = 40 s; the steps set the swelling s∞, e.g. a pH or a temperature step). The target is the hydrogel film: its thickness grows as d₀(1 + s) and water fills the added volume (Bruggeman).

The layer gets thicker but its index drops toward that of water: here the dilution wins and the dip moves to smaller angles, by several degrees — far from the linear RU picture of a binding experiment. The scan is wide (66–89°) to follow it.`;

const NOTE_SG_SMALL = `A small molecule, measured — the Sensorgram page.

A 200 Da molecule binds with fast kinetics (ka = 5·10⁴ M⁻¹s⁻¹, kd = 0.05 s⁻¹, KD = 1 µM; as in the carbonic anhydrase II – sulfonamide benchmark studies of Myszka et al.) at 5 µM: only ~35 RU, while the bulk index of the injected solution gives a jump of its own.

The instrument adds detector noise (thermal / read-out σ 0.0005 and shot noise, 4 scans averaged); the dip is located on every noisy scan by its centroid (below half depth), not by the 3-point parabola. Five noise seeds: five runs of the same experiment with their own noise. The summary gives the noise σ of the read-out over the analyte-free baseline and the detection limit 3σ in RIU, ng/mm², RU and nM at equilibrium.

The card "Curves over the scan": the measured curves at the end of every step (the exact ones dashed; add or remove times), any seed; its switch shows the map of all the times. Turn the noise off to see the exact sensorgram, or try the parabola to see why the centroid is used.`;

const NOTE_SG_MYO = `Benchmark — protein adsorption on silica: random packing and the double layer. M. Wasilewska et al., Int. J. Environ. Res. Public Health 18, 4944 (2021), myoglobin on silica at pH 3.5 (QCM and OWLS).

Myoglobin (17.8 kDa, 4.5 × 3.5 × 2.5 nm, lying) adsorbs from a 5 mg/L solution (281 nM). Binding kinetics: a free surface — the molecules land at random places and cannot overlap (random sequential adsorption), transport-limited (kt), irreversible (kd = 0).

Two configurations, two buffers with the ζ potential the paper measured: 10 mM NaCl (ζ = 38 mV, Debye length 3.0 nm) and 150 mM (ζ = 15 mV, 0.8 nm). At low salt the molecules repel each other across the double layer and pack as larger discs (the effective hard particle of Adamczyk, 1 kT).

Predicted maximum coverage (Analyte and surface: Γ∞): 0.595 and 1.31 mg/m² (= ng/mm²). Measured (QCM, the irreversibly bound fraction): 0.60 ± 0.1 and 1.3 ± 0.1; OWLS 0.7 and 1.5. Nothing is fitted: the dimensions are those of the crystal structure, ζ from the paper; kt only sets the time scale.

The silica is a 10 nm SiO₂ film on an SPR chip (BK7 | Au 50 nm, 633 nm): the sensorgrams show what an SPR instrument would see. Compare page, card Sensorgrams: Run, then Γ (or the shift) of both buffers on one plot.

Checked (scripts/check.ts): Γ∞ 0.595 / 1.307 mg/m².`;

// BK7 | Au 50 nm (| an extra film) | water at 633 nm (TM), an angular scan around the dip.
const sgChip = (extra: Film[] = [], from = 66, to = 74, step = 0.05) => ({
  structure: { incident: { id: 'BK7' }, blocks: [film('au', 'Au', 50, 'gold'), ...extra], exit: { id: 'Water' } },
  sim: sim({ mode: 'theta', lambda: 633, from, to, points: Math.round((to - from) / step) + 1, pol: 'p' }),
  metrics: sprMetrics(),
});
const HYDROGEL = constant('user-hydrogel', 'hydrogel, collapsed (n = 1.50)', 1.5, '#7fb3a8', 'typical polymer (pNIPAAm-like) value');
export const MYOGLOBIN_WASILEWSKA = { capacity10: 0.6, capacity150: 1.3 };
const myoglobinSg = (ionic: number, zeta: number): Partial<SgSettings> => ({
  analyte: 'myoglobin', orient: 'side', surface: 'rsa', ionic, zeta, model: 'transport', ka: 1e7, kd: 0, kt: 1.5e7,
  steps: [{ label: 'buffer', t: 60, c: 0 }, { label: 'myoglobin 5 mg/L', t: 1800, c: 281 }, { label: 'rinse', t: 1200, c: 0 }],
  dt: 10, maxTimes: 160, show: 'Gamma',
});
const NOTE_ROUGH = `Rough gold (after T. Treebupachatsakul et al., Sensors 21, 6164 (2021): a random height profile, white noise low-pass filtered, its interface cut into slices of an effective medium).

Structure: BK7 | Au 50 nm | water, 633 nm, TM. The gold's bottom interface (towards the water) is rough: the "roughness" button under the gold's name on the Structure page opens its editor — a random profile, RMS 1 nm, correlation length 20 nm, 10 slices mixed by Bruggeman; the drawing shows the profile, the slices and their mixtures. The profile has zero mean around the interface: the gold keeps its 50 nm on average.

Run the sweep (Simulation): the seed of the profile takes 10 values, ten realizations of the same roughness. The plot "Every realization" draws all of them (Seed: all), "Mean of the realizations" their mean at every angle (Seed: mean; median is there too) — the slider "one" shows a single realization. The plot of the metrics gives the dip position and its width for every seed.

Configuration 2 is the same chip with an effective interface layer (2·RMS = 2 nm, Bruggeman 50/50), configuration 3 a smooth chip, configuration 4 the same random profile mixed as lamellae (Wiener: the harmonic mean of ε across the grooves, the arithmetic mean along them — the limit of RCWA on this profile when the correlation length ≪ λ): the Compare page plots the four. Bruggeman and the lamellar slices bracket the effect of the model.

What to expect: in the transfer-matrix picture (1D effective media) 1 nm RMS already moves the dip by about 2° and makes it shallower; other models of the same surface (RCWA of the profile in SPR Forge, a 3D effective medium) give different shifts — treat the size of the effect as model-dependent. The correlation length only shapes the profile here: the transfer matrices see the distribution of the heights. The Optimization page can average every candidate over N realizations (Rough structures: mean / median).`;

const SG_EXAMPLES: { name: string; note: string; make: () => Project }[] = [
  {
    name: 'Sensorgram: your first binding experiment',
    note: 'An antibody binds to a gold chip: the kinetics, the moving dip, the calibration — a step-by-step note, no theory needed',
    make: () => finish({ ...defaultProject(), name: 'My first sensorgram', notes: NOTE_SG_FIRST, ...sgChip(), sg: { analyte: 'igg', orient: 'side', ka: 2e5, kd: 1e-3, rmax: 1000, steps: [{ label: 'baseline', t: 60, c: 0 }, { label: 'association', t: 300, c: 50 }, { label: 'dissociation', t: 600, c: 0 }], dt: 5, maxTimes: 200, cards: ['binding', 'sensorgram', 'summary', 'reflectance'] } }),
  },
  {
    name: 'Sensorgram: antibody binding, concentration series (1:1)',
    note: 'An IgG for five concentrations: the binding layer and the bulk index at every time, the dip followed exactly; coverage, steady state and the series planner',
    make: () => finish({ ...defaultProject(), name: 'Antibody sensorgrams', notes: NOTE_SG_SERIES, ...sgChip(), sg: { analyte: 'igg', orient: 'end', ka: 2e5, kd: 5e-4, rmax: 2500, steps: [{ label: 'baseline', t: 60, c: 0 }, { label: 'association', t: 400, c: 100 }, { label: 'dissociation', t: 900, c: 0 }], dt: 5, seriesOf: 'c', series: [12.5, 25, 50, 100, 200], cards: ['sensorgram', 'summary', 'steady'] } }),
  },
  {
    name: 'Sensorgram: a swelling hydrogel',
    note: 'A hydrogel film on gold swells and collapses: thickness and index change together, and the signal is not proportional to the swelling',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Swelling hydrogel',
        notes: NOTE_SG_SWELL,
        materials: [HYDROGEL],
        ...sgChip([film('gel', HYDROGEL.id, 40, 'hydrogel')], 66, 89),
        sg: { model: 'swelling', tau: 40, steps: [{ label: 'buffer', t: 60, c: 0, swell: 0 }, { label: 'swelling (pH 7)', t: 400, c: 0, swell: 1.5 }, { label: 'collapse (pH 4)', t: 400, c: 0, swell: 0 }], dt: 2, target: 'gel', mixing: 'bruggeman', bulk: false },
      }),
  },
  {
    name: 'Sensorgram: a small molecule with detector noise (centroid)',
    note: 'A few RU of a fast small-molecule binding, the bulk jump and the detector noise; the dip located by its centroid, five noise seeds, the detection limit',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Small molecule, measured',
        notes: NOTE_SG_SMALL,
        ...sgChip(),
        sg: {
          analyte: 'small', ka: 5e4, kd: 0.05, rmax: 40,
          steps: [{ label: 'baseline', t: 30, c: 0 }, { label: 'injection', t: 90, c: 5000 }, { label: 'dissociation', t: 120, c: 0 }],
          dt: 1, track: false, locate: 'centroid', locLevel: 0.5, maxTimes: 300, seeds: [1, 2, 3, 4, 5], cards: ['sensorgram', 'summary', 'reflectance'],
          inst: { ...defaultInstrument(), noise: true, noiseAdd: 0.0005, noiseShot: 1e5, noiseAvg: 4 },
        },
      }),
  },
  {
    name: 'Protein adsorption on silica: random packing and the double layer (Wasilewska 2021, benchmark)',
    note: 'Myoglobin on a silica-coated SPR chip at 10 and 150 mM NaCl (two configurations): the maximum coverage predicted without fitting, 0.595 / 1.31 vs 0.60 / 1.3 mg/m² measured',
    make: () => {
      const base = { ...defaultProject(), ...sgChip([film('si', 'SiO2', 10, 'silica')], 66, 80) };
      const c10: ConfigFields = { ...fieldsOf(base), sg: myoglobinSg(10, 38) };
      const c150: ConfigFields = { ...fieldsOf(base), sg: myoglobinSg(150, 15) };
      return finish({
        ...base,
        ...c10,
        name: 'Myoglobin on silica (Wasilewska 2021)',
        notes: NOTE_SG_MYO,
        configs: [
          { id: 'myo10', name: '10 mM NaCl (ζ 38 mV)', ...c10 },
          { id: 'myo150', name: '150 mM NaCl (ζ 15 mV)', ...c150 },
        ],
        configId: 'myo10',
        compare: { plots: [], sg: { configs: ['myo10', 'myo150'], show: 'Gamma', series: 'last', same: false } },
      });
    },
  },
];

export const EXAMPLES: { name: string; note: string; make: () => Project }[] = [
  {
    name: 'Kretschmann SPR sensor',
    note: 'BK7 | 50 nm Ag | water at 633 nm: resonance, sensitivity, penetration depth, propagation length, phase on a second axis',
    make: () =>
      finish({
        ...defaultProject(),
        notes: NOTE_KRETSCHMANN,
        sim: sim({ field: { ...defaultField(), on: true, at: 'metric', metric: 'res', zIn: 300, zOut: 400 } }),
        metrics: [...sprMetrics(), newMetric('penetration', { id: 'pen', ref: 'pen', label: 'Penetration into water' }), newMetric('propagation', { id: 'prop', ref: 'prop', label: 'Propagation length' })],
        derived: [{ id: 'd1', name: 'phase_r', expr: 'arg(rRe, rIm)', unit: '°' }],
        sweep: { ...defaultSweep(), plots: [newPlot({ id: 'main', title: 'Response', x: 'theta', left: ['R'], right: ['phase_r'] })] },
        params: [exposed('dAg', { kind: 'film', block: 'ag', prop: 'd' }, 'Ag thickness', 30, 70, 2, false, true)],
        // the deepest resonance (R at the dip as small as possible), its width as a lesser objective
        opt: { ...defaultOpt(), objectives: [newObjective('res', 'R', { goal: 'min', scale: 0.01 }), newObjective('res', 'width', { goal: 'min', weight: 0.1, scale: 0 })] },
      }),
  },
  ...SG_EXAMPLES,
  {
    name: 'Rough gold SPR: realizations, mean and an interface layer',
    note: 'BK7 | Au 50 nm (rough bottom, random profile RMS 1 nm) | water: ten realizations swept by the seed, all of them or their mean; an effective interface layer, a smooth chip and lamellar (Wiener) slices as configurations',
    make: () => {
      const rough = (r: Partial<Rough>): ConfigFields => {
        const base = { ...defaultProject() };
        return {
          ...fieldsOf(base),
          structure: { incident: { id: 'BK7' }, blocks: [{ ...film('au', 'Au', 50, 'gold'), rough: { bottom: defaultRough(r) } }], exit: { id: 'Water' } },
          sim: sim({ mode: 'theta', lambda: 633, from: 66, to: 80, points: 701, pol: 'p' }),
          metrics: sprMetrics(),
        };
      };
      const seed: Exposed = { ...exposed('seed', { kind: 'rough', block: 'au', part: 'film', index: 0, side: 'bottom', prop: 'seed' }, 'roughness seed', 1, 10, 1, true) };
      const cfg1: ConfigFields = {
        ...rough({ size: 1, cl: 20, seed: 1 }),
        params: [seed],
        sweep: {
          ...defaultSweep(),
          axes: ['seed'],
          plots: [
            newPlot({ id: 'all', title: 'Every realization', x: 'theta', left: ['R'], seedStat: 'all' }),
            newPlot({ id: 'mean', title: 'Mean of the realizations', x: 'theta', left: ['R'], seedStat: 'mean' }),
            newPlot({ id: 'met', title: 'The dip of every realization', source: 'metrics:theta', x: 'seed', left: ['res.pos'] }),
          ],
        },
      };
      const cfg2: ConfigFields = { ...rough({ type: 'effective', size: 1 }) };
      const cfg3: ConfigFields = { ...rough({ size: 0 }), structure: { incident: { id: 'BK7' }, blocks: [film('au', 'Au', 50, 'gold')], exit: { id: 'Water' } } };
      const cfg4: ConfigFields = { ...rough({ size: 1, cl: 20, seed: 1, mix: 'wiener' }) };
      const cmp = newPlot({ id: 'cmp', title: 'Rough, interface layer, smooth, lamellar', source: 'compare', x: 'theta', left: [], curves: [newCurve('r1', {}, 0), newCurve('r2', {}, 1), newCurve('r3', {}, 2), newCurve('r4', {}, 3)] });
      return finish({
        ...defaultProject(),
        ...cfg1,
        name: 'Rough gold SPR',
        notes: NOTE_ROUGH,
        configs: [
          { id: 'r1', name: 'Random profile, RMS 1 nm', ...cfg1 },
          { id: 'r2', name: 'Effective layer, 2 nm', ...cfg2 },
          { id: 'r3', name: 'Smooth gold', ...cfg3 },
          { id: 'r4', name: 'Lamellar (Wiener), RMS 1 nm', ...cfg4 },
        ],
        configId: 'r1',
        compare: { plots: [cmp] },
      });
    },
  },
  {
    name: 'Tamm plasmon induced reflection (Lu 2019, benchmark)',
    note: 'Ag | Si₃N₄/SiO₂ mirror with an Al₂O₃ defect: coupled-oscillator fit (κ, κT) vs the defect position',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Tamm induced reflection (Lu 2019)',
        notes: NOTE_LU,
        materials: [
          { id: 'user-ag-lu2019', name: 'Ag (Drude, Lu 2019)', color: '#b8bcc6', model: { type: 'drude-lorentz', epsInf: 3.7, wp: 9.1, gamma: 0.018, osc: [] }, source: 'Drude fit of Johnson & Christy used by H. Lu et al., Opt. Express 27, 5383 (2019)' },
          constant('user-si3n4-22', 'Si₃N₄ (n = 2.2)', 2.2, '#8fb3d9', 'H. Lu et al. (2019)'),
          constant('user-sio2-145', 'SiO₂ (n = 1.45)', 1.45, '#3a6fb0', 'H. Lu et al. (2019)'),
          constant('user-al2o3-176', 'Al₂O₃ (n = 1.76)', 1.76, '#f2c9a0', 'H. Lu et al. (2019)'),
        ],
        structure: {
          incident: { id: 'Air' },
          blocks: [
            film('ag', 'user-ag-lu2019', 30, 'Ag film'),
            dbr({ label: 'mirror + defect', periods: 24, lambda0: 1556, mirrorAfterCavity: false, period: [layer('Si₃N₄', 'user-si3n4-22', 160), layer('SiO₂', 'user-sio2-145', 275)], cavities: [{ mat: { id: 'user-al2o3-176' }, after: 8, mode: 'nm', d: 258, m: 1, layers2D: 1 }] }),
          ],
          exit: { id: 'Air' },
        },
        sim: sim({ mode: 'lambda', lambda: 1556, theta: 0, from: 1535, to: 1578, points: 861, pol: 'p' }),
        metrics: [
          newMetric('fit', {
            id: 'co', ref: 'co', label: 'Coupled oscillators', field: 'A', lo: 1538, hi: 1575,
            fit: { comps: [comp('baseline', { c: 0, s: 0 }), comp('coupled', { A: 1, x1: 1555.9, w1: 5.4, x2: 1555.7, w2: 0.05, W: 4, r: 0 }, ['r'])], guess: false, run: true, parts: true },
            expose: ['C1_kappa'],
          }),
        ],
        // the parameters of Fig. 8 (the sweep: one of them)
        params: [
          exposed('M', { kind: 'cavity', block: 'dbr', index: 0, prop: 'after' }, 'M (periods before the defect)', 8, 16, 1, true),
          exposed('ds', { kind: 'cavity', block: 'dbr', index: 0, prop: 'd' }, 'ds (defect thickness)', 238, 278, 2),
          exposed('dB', { kind: 'period', block: 'dbr', index: 0, prop: 'd' }, 'dB (Si₃N₄ thickness)', 140, 180, 2),
          exposed('ns', { kind: 'cavity', block: 'dbr', index: 0, prop: 'param' }, 'ns (defect index)', 1.66, 1.86, 0.01),
          exposed('da', { kind: 'film', block: 'ag', prop: 'd' }, 'da (Ag thickness)', 20, 40, 1),
        ],
        sweep: {
          ...defaultSweep(),
          axes: ['M'],
          plots: [
            newPlot({ id: 'main', title: 'Response', x: 'lambda', left: ['A'], right: ['R'] }),
            newPlot({ id: 'map', title: 'R map', x: 'lambda', mode: 'map', y: 'M', color: 'R' }),
            newPlot({ id: 'kappa', title: 'κ vs the swept parameter (Fig. 8)', source: 'metrics:lambda', x: 'M', left: ['co.C1_kappa', 'co.C1_kappaT'] }),
          ],
        },
      }),
  },
  {
    name: 'Rabi-like splitting, Tamm plasmon + cavity (Jena 2021, benchmark)',
    note: 'Ag | spacer | (HL)⁵ C (HL)⁵: the anticrossing vs the spacer, the dispersion fit (Ω in meV)',
    make: () => jenaProject(),
  },
  {
    name: 'Inverse design of a Tamm emitter, Adam (He 2021, benchmark)',
    note: '(Ge/SiO)⁴ Ge | CdO | SiO: two reflection dips designed by Adam in two stages on a target',
    make: () => heProject(),
  },
  {
    name: 'Tunable Tamm plasmon with Sb₂S₃ (Sreekanth 2023, benchmark)',
    note: 'Au | (Sb₂S₃/SiO₂)×5 | quartz: the two Tamm modes, amorphous vs crystalline Sb₂S₃',
    make: () => {
      const am = 'user-sb2s3-am';
      const cr = 'user-sb2s3-cr';
      const phase = 'phase';
      return finish({
        ...defaultProject(),
        name: 'Tunable Tamm plasmon (Sreekanth 2023)',
        notes: NOTE_SREEKANTH,
        materials: [
          { id: am, name: 'Sb₂S₃ amorphous (Cauchy, calibrated)', color: '#c9a227', model: { type: 'formula', formula: 5, coefficients: [SREEKANTH2023.cauchyAm[0], SREEKANTH2023.cauchyAm[1], -2], k: 0 }, source: 'Cauchy model calibrated on the Tamm modes of K. V. Sreekanth et al., Nat. Commun. 14, 7085 (2023) (see the notes)' },
          { id: cr, name: 'Sb₂S₃ crystalline (Cauchy, calibrated)', color: '#7a5c12', model: { type: 'formula', formula: 5, coefficients: [SREEKANTH2023.cauchyCr[0], SREEKANTH2023.cauchyCr[1], -2], k: 0 }, source: 'Cauchy model calibrated on the Tamm modes of K. V. Sreekanth et al., Nat. Commun. 14, 7085 (2023) (see the notes)' },
        ],
        structure: {
          incident: { id: 'Air' },
          blocks: [film('au', 'Au', 20, 'Au'), dbr({ label: 'Sb₂S₃ / SiO₂', periods: 5, lambda0: 1000, period: [layer('Sb₂S₃', am, 170), layer('SiO₂', 'SiO2', 100)] })],
          exit: { id: 'SiO2' },
        },
        sim: sim({ mode: 'lambda', lambda: 800, theta: 0, from: 550, to: 2300, points: 3501, pol: 'p', field: { ...defaultField(), at: 'metric', metric: 'tpp2' } }),
        metrics: [
          newMetric('fwhm', { id: 'tpp2', ref: 'tpp2', label: 'TPP 2 (visible)', lo: 700, hi: 770, follow: { param: phase, pts: [{ y: 0, lo: 700, hi: 770 }, { y: 1, lo: 850, hi: 920 }] } }),
          newMetric('fwhm', { id: 'tpp1', ref: 'tpp1', label: 'TPP 1 (NIR)', lo: 1400, hi: 1600, follow: { param: phase, pts: [{ y: 0, lo: 1400, hi: 1600 }, { y: 1, lo: 1700, hi: 1900 }] } }),
        ],
        params: [{ ...exposed(phase, { kind: 'period', block: 'dbr', index: 0, prop: 'mat' }, 'Sb₂S₃ phase', 0, 1, 1), mats: [am, cr] }],
        sweep: {
          ...defaultSweep(),
          axes: [phase],
          plots: [newPlot({ id: 'main', title: 'Response', x: 'lambda', left: ['R'], series: phase }), newPlot({ id: 'pos', title: 'Tamm modes vs the phase', source: 'metrics:lambda', x: phase, left: ['tpp2.pos', 'tpp1.pos'] })],
        },
      });
    },
  },
  {
    name: 'NSGA-II with constraints: 2D-material SPR sensor (Varasteanu 2021, benchmark)',
    note: 'BK7 | Ag | semiconductor | graphene / MoS₂ / WS₂ | analyte: S, FWHM, R at the resonance with constraints, the models of the paper',
    make: () => nsgaProject('paper'),
  },
  {
    name: 'NSGA-II with constraints: the same with the library materials',
    note: 'Ag (Johnson & Christy), graphene, MoS₂, WS₂ of the library instead of the paper’s models',
    make: () => nsgaProject('library'),
  },
  {
    name: 'Zones: high R in one band, low R in another (DE)',
    note: 'A Bragg mirror whose layers and periods are optimized so that R is high in 600–700 nm and low in 400–500 nm',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Zones',
        notes: NOTE_ZONES,
        structure: { incident: { id: 'Air' }, blocks: [dbr({ label: 'mirror', periods: 6, period: [layer('H', 'TiO2', 60), layer('L', 'SiO2', 100)] })], exit: { id: 'BK7' } },
        sim: sim({ mode: 'lambda', lambda: 650, theta: 0, from: 400, to: 1000, points: 601, pol: 's' }),
        metrics: [newMetric('zones', { id: 'zones', ref: 'zones', label: 'Zones', zones: [newZone({ lo: 600, hi: 700, goal: 'max' }), newZone({ lo: 400, hi: 500, goal: 'min' })], expose: ['score', 'z1', 'z2'] })],
        params: [
          exposed('dH', { kind: 'period', block: 'dbr', index: 0, prop: 'd' }, 'H thickness', 30, 150, 5, false, true),
          exposed('dL', { kind: 'period', block: 'dbr', index: 1, prop: 'd' }, 'L thickness', 50, 250, 5, false, true),
          exposed('N', { kind: 'dbr', block: 'dbr', prop: 'periods' }, 'periods N', 3, 12, 1, true, true),
        ],
        opt: { ...defaultOpt(), algorithm: 'de', iterations: 40, population: 24, objectives: [newObjective('zones', 'score', { goal: 'max', scale: 1 })] },
      }),
  },
  {
    name: 'Strong coupling: polaritons vs cavity thickness',
    note: 'An excitonic layer as the cavity of a TiO₂/SiO₂ microcavity: the anticrossing and its dispersion fit',
    make: () => strongCouplingProject(),
  },
  {
    name: 'Strong coupling: polaritons vs angle',
    note: 'The same microcavity at 215 nm: the branches vs θ (a region following θ), the cavity-vs-angle dispersion',
    make: () => {
      const p = strongCouplingProject();
      const dbrB = p.structure.blocks[0] as Dbr;
      return finish({
        ...p,
        name: 'Polaritons vs angle',
        notes: NOTE_SC_ANGLE,
        structure: { ...p.structure, blocks: [{ ...dbrB, cavities: dbrB.cavities.map((c) => ({ ...c, d: 215 })) }] },
        // a dispersion map: λ 560–760 nm × θ 0–40°, computed at once (no Run)
        sim: { ...p.sim, mode: 'map', from: 560, to: 760, points: 401, tFrom: 0, tTo: 40, tPoints: 81 },
        params: p.params.filter((x) => x.id !== 'dc'),
        metrics: p.metrics.map((m) =>
          m.id === 'lg'
            ? { ...m, lo: 652.5, hi: 705, follow: { param: 'theta', pts: [{ y: 0, lo: 652.5, hi: 705 }, { y: 40, lo: 645, hi: 690 }] } }
            : m.fit?.mode === 'dispersion'
              ? { ...m, along: 'theta', lo: 0, hi: 30, fit: { ...m.fit, model: 'angle' as const } }
              : m,
        ),
        sweep: { ...p.sweep, axes: [], plots: [newPlot({ id: 'map', title: 'R(λ, θ)', x: 'lambda', mode: 'map', y: 'theta', color: 'R' }), newPlot({ id: 'branches', title: 'Branches vs θ', source: 'metrics:lambda', x: 'theta', left: ['sh.pos', 'lg.pos'] })] },
      });
    },
  },
  {
    name: 'Fit of several components (two Lorentzians, coupled oscillators)',
    note: 'Two dips fitted with a baseline and two Lorentzians, each component drawn; the coupled-oscillator alternative',
    make: () => {
      const p = jenaProject();
      return finish({
        ...p,
        name: 'Fit of several components',
        notes: NOTE_MULTIFIT,
        structure: { ...p.structure, blocks: p.structure.blocks.map((b) => (b.id === 'sp' && b.kind === 'film' ? { ...b, d: 141 } : b)) },
        sim: { ...p.sim, from: 460, to: 545, points: 851 },
        metrics: [
          newMetric('fit', { id: 'two', ref: 'two', label: 'Two Lorentzians', lo: 470, hi: 530, fit: { comps: [comp('baseline', {}), comp('lorentz', {}), comp('lorentz', {})], guess: true, run: true, parts: true } }),
          newMetric('fit', { id: 'cpl', ref: 'cpl', label: 'Coupled oscillators', on: false, lo: 470, hi: 530, fit: { comps: [comp('baseline', {}), comp('coupled', {})], guess: true, run: true, parts: true } }),
        ],
        sweep: { ...defaultSweep(), axes: [], plots: [newPlot({ id: 'main', title: 'Response', x: 'lambda', left: ['R'] })] },
      });
    },
  },
  {
    name: 'Bragg mirror',
    note: 'air | (TiO2 / SiO2) ×8, λ₀/4 at 650 nm | BK7, spectral at normal incidence; the number of periods exposed',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Bragg mirror',
        notes: NOTE_BRAGG,
        structure: { incident: { id: 'Air' }, blocks: [dbr({})], exit: { id: 'BK7' } },
        sim: sim({ mode: 'lambda', lambda: 650, from: 400, to: 1000, points: 1201, pol: 's' }),
        metrics: [newMetric('fwhm', { id: 'band', ref: 'band', label: 'Stop band', feature: 'peak', lo: 500, hi: 850 })],
        params: [exposed('N', { kind: 'dbr', block: 'dbr', prop: 'periods' }, 'periods N', 2, 16, 1, true)],
      }),
  },
  {
    name: 'DBR microcavity',
    note: 'air | (HL)⁶ 2L (LH)⁶ at 650 nm | BK7: a cavity mode in the stop band; the cavity position and N exposed',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'DBR microcavity',
        notes: NOTE_CAVITY,
        structure: { incident: { id: 'Air' }, blocks: [dbr({ periods: 12, cavities: [{ mat: { id: 'SiO2' }, after: 6, mode: 'half', d: 0, m: 1, layers2D: 1 }] })], exit: { id: 'BK7' } },
        sim: sim({ mode: 'lambda', lambda: 650, from: 500, to: 850, points: 3501, pol: 's', field: { ...defaultField(), on: true, at: 'metric', metric: 'mode', zIn: 200, zOut: 200 } }),
        metrics: [
          newMetric('fwhm', { id: 'mode', ref: 'mode', label: 'Cavity mode', lo: 630, hi: 670, expose: ['q', 'R'] }),
          newMetric('sens', { id: 'modeS', ref: 'modeS', label: 'Mode sensitivity (cavity)', lo: 630, hi: 670, target: { kind: 'cavity', block: 'dbr', index: 0 }, expose: ['S'] }),
          newMetric('fwhm', { id: 'band', ref: 'band', label: 'Stop band', feature: 'peak', lo: 520, hi: 820, expose: ['width'] }),
        ],
        // the highest Q with a deep mode (≤ 0.1)
        opt: { ...defaultOpt(), objectives: [newObjective('mode', 'q', { goal: 'max', scale: 0 }), newObjective('mode', 'R', { goal: 'le', target: 0.1, scale: 0.1 })] },
        params: [exposed('pos', { kind: 'cavity', block: 'dbr', index: 0, prop: 'after' }, 'cavity position', 0, 12, 1, true, true), exposed('N', { kind: 'dbr', block: 'dbr', prop: 'periods' }, 'periods N', 6, 20, 1, true, true)],
      }),
  },
  {
    name: 'Tamm plasmon',
    note: 'BK7 | (LH)⁸ at 650 nm | 40 nm Ag | air, illuminated through the DBR; the Ag thickness exposed',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'Tamm plasmon',
        notes: NOTE_TAMM,
        structure: {
          incident: { id: 'BK7' },
          blocks: [dbr({ period: [{ label: 'L', mat: { id: 'SiO2' }, mode: 'qw', d: 0, layers2D: 1 }, { label: 'H', mat: { id: 'TiO2' }, mode: 'qw', d: 0, layers2D: 1 }] }), film('ag', 'Ag', 40, 'metal')],
          exit: { id: 'Air' },
        },
        sim: sim({ mode: 'lambda', lambda: 650, from: 500, to: 850, points: 3501, pol: 's', field: { ...defaultField(), on: true, at: 'metric', metric: 'tamm', zIn: 200, zOut: 100 } }),
        metrics: [newMetric('fwhm', { id: 'tamm', ref: 'tamm', label: 'Tamm mode', lo: 560, hi: 760 })],
        params: [exposed('dAg', { kind: 'film', block: 'ag', prop: 'd' }, 'Ag thickness', 20, 80, 2, false, true)],
      }),
  },
  {
    name: 'Compare: a Tamm plasmon and an SPR sensor (two configurations)',
    note: 'Two configurations in one project — a Tamm plasmon at normal incidence and a Kretschmann SPR at 68°, both spectral — and a compare plot of their R',
    make: () => {
      const tamm = EXAMPLES.find((e) => e.name === 'Tamm plasmon')!.make();
      const k = EXAMPLES.find((e) => e.name === 'Kretschmann SPR sensor')!.make();
      // the SPR sensor read spectrally at a fixed angle (its metrics: the dip, its width and sensitivity in nm)
      const spr: ConfigFields = {
        ...fieldsOf(k),
        sim: { ...k.sim, mode: 'lambda', theta: 68, from: 500, to: 850, points: 3501, field: { ...k.sim.field, on: false } },
        metrics: sprMetrics(0.005),
        derived: [],
        sweep: { ...defaultSweep(), plots: [newPlot({ id: 'main', title: 'Response', x: 'lambda', left: ['R'] })] },
        opt: defaultOpt(),
      };
      const plots = [newPlot({ id: 'main', title: 'Response', x: 'lambda', left: ['R'] })];
      const cmp = newPlot({ id: 'cmp', title: 'Tamm vs SPR', source: 'compare', x: 'lambda', left: [], curves: [newCurve('tamm', { marks: true }, 0), newCurve('spr', { marks: true }, 1)] });
      const t: ConfigFields = { ...fieldsOf(tamm), sim: { ...tamm.sim, field: { ...tamm.sim.field, on: false } }, sweep: { ...tamm.sweep, plots } };
      return finish({
        ...tamm,
        ...t,
        name: 'Tamm plasmon and SPR',
        notes: NOTE_COMPARE,
        materials: [...tamm.materials, ...k.materials.filter((m) => !tamm.materials.some((x) => x.id === m.id))],
        configs: [
          { id: 'tamm', name: 'Tamm plasmon (0°)', ...t },
          { id: 'spr', name: 'SPR at 68°', ...spr },
        ],
        configId: 'tamm',
        compare: { plots: [cmp] },
      });
    },
  },  {
    name: 'Goos–Hänchen shift: Au–ITO–graphene (Han 2020, benchmark)',
    note: 'SF11 | BK7 100 nm | Au 50 nm | ITO 10 nm | graphene ×N | water, TM 632.8 nm: R, the phase of r and the GH shift; N = 0 … 5 (L. Han et al., Sensors 20, 1028 (2020))',
    make: () => {
      const mats: MaterialDef[] = [
        { id: 'han-sf11', name: 'SF11 (1.7786)', color: '#a6b4c4', model: { type: 'constant', n: 1.7786, k: 0 }, source: 'Han 2020: SF11 at 632.8 nm' },
        { id: 'han-bk7', name: 'BK7 (1.5151)', color: '#c9d6e3', model: { type: 'constant', n: 1.5151, k: 0 }, source: 'Han 2020: BK7 at 632.8 nm' },
        { id: 'han-au', name: 'Au (0.181 + 3.068i)', color: '#c9a227', model: { type: 'constant', n: 0.181, k: 3.068 }, source: 'Han 2020: Au (Drude) at 632.8 nm' },
        { id: 'han-ito', name: 'ITO (1.858 + 0.058i)', color: '#8fb8a8', model: { type: 'constant', n: 1.858, k: 0.058 }, source: 'Han 2020: ITO at 632.8 nm' },
        { id: 'han-gr', name: 'graphene (3.0 + 1.149i)', color: '#3b3b3b', model: { type: 'constant', n: 3, k: 1.149 }, monolayer: 0.34, source: 'Han 2020: 3 + iC₁λ/3 at 632.8 nm, 0.34 nm per layer' },
        { id: 'han-water', name: 'water (1.330)', color: '#7fb6d9', model: { type: 'constant', n: 1.33, k: 0 }, source: 'Han 2020: water at 632.8 nm' },
      ];
      const s = sim({ mode: 'theta', lambda: 632.8, from: 55, to: 68, points: 13001, pol: 'p' });
      const metrics = () => [
        newMetric('fwhm', { id: 'res', ref: 'res', label: 'SPR dip', lo: 56, hi: 66 }),
        newMetric('gh', { id: 'gh', ref: 'gh', label: 'GH shift', lo: 56, hi: 66, dn: 0.002 }),
        newMetric('phase', { id: 'ph', ref: 'ph', label: 'Phase', lo: 56, hi: 66, dn: 0.002 }),
      ];
      const auIto = [film('bk7', 'han-bk7', 100, 'BK7 slide'), film('au', 'han-au', 50, 'Au'), film('ito', 'han-ito', 10, 'ITO')];
      const plotsOf = (series = '') => [
        newPlot({ id: 'main', title: 'R and the GH shift', x: 'theta', left: ['R'], right: ['gh'], series }),
        newPlot({ id: 'phase', title: 'Phase of r', x: 'theta', left: ['phiR'], series }),
      ];
      const one: ConfigFields = {
        structure: { incident: { id: 'han-sf11' }, blocks: auIto, exit: { id: 'han-water' } },
        sim: s,
        params: withScanParams([], s),
        metrics: metrics(),
        derived: [],
        sweep: { ...defaultSweep(), plots: plotsOf() },
        opt: defaultOpt(),
      };
      const withG: ConfigFields = {
        ...one,
        structure: { incident: { id: 'han-sf11' }, blocks: [...auIto, { ...film('gr', 'han-gr', 0, 'graphene'), layers2D: 1 }], exit: { id: 'han-water' } },
        params: withScanParams([exposed('N', { kind: 'film', block: 'gr', prop: 'layers2D' }, 'graphene layers N', 1, 5, 1, true)], s),
        metrics: metrics(),
        sweep: { ...defaultSweep(), axes: ['N'], fields: ['R', 'phiR', 'gh'], plots: plotsOf('N') },
      };
      return finish({
        ...defaultProject(),
        name: 'Goos–Hänchen shift (Han 2020)',
        notes: NOTE_GH,
        materials: mats,
        ...one,
        configs: [
          { id: 'auito', name: 'Au–ITO', ...one },
          { id: 'graphene', name: 'Au–ITO–graphene (N = 1 … 5)', ...withG },
        ],
        configId: 'auito',
        compare: {
          plots: [newPlot({ id: 'ghcmp', title: 'GH shift: Au–ITO vs Au–ITO–graphene (N = 1)', source: 'compare', x: 'theta', left: [], curves: [newCurve('auito', { y: 'gh', marks: true }, 0), newCurve('graphene', { y: 'gh', marks: true }, 1)] })],
          views: [],
        },
      });
    },
  },
  {
    name: 'SPR sensor with 2D materials (Sebek 2023)',
    note: 'CaF2 | 17 L hBN | 12 nm Al | 28 nm Ag | 17 L hBN | water, angular at 633 nm (M. Sebek et al., ACS Omega 8, 20792 (2023))',
    make: () =>
      finish({
        ...defaultProject(),
        name: 'SPR sensor with 2D materials',
        notes: NOTE_SEBEK,
        structure: {
          incident: { id: 'CaF2' },
          blocks: [
            { kind: 'film', id: 'h1', label: '', mat: { id: 'hBN' }, d: 0, layers2D: 17 },
            film('al', 'Al', 12),
            film('ag', 'Ag', 28),
            { kind: 'film', id: 'h2', label: '', mat: { id: 'hBN' }, d: 0, layers2D: 17 },
          ],
          exit: { id: 'Water' },
        },
        sim: sim({ from: 70, to: 89.9, points: 4001 }),
        metrics: sprMetrics(0.005),
      }),
  },
];

// Jena et al.: the spacer swept, the two branches and their dispersion.
function jenaProject(): Project {
  const HBAR = 6.582119569e-16; // eV·s
  return finish({
    ...defaultProject(),
    name: 'Tamm–cavity Rabi splitting (Jena 2021)',
    notes: NOTE_JENA,
    materials: [
      { id: 'user-ag-jena', name: 'Ag (Drude, Jena 2021)', color: '#b8bcc6', model: { type: 'drude-lorentz', epsInf: 5, wp: 1.36e16 * HBAR, gamma: 6.6e13 * HBAR, osc: [] }, source: 'Drude model of S. Jena et al., arXiv:2105.01888: ε∞ = 5, ωp = 1.36·10¹⁶ rad/s, γ = 6.6·10¹³ rad/s' },
      constant('user-n147', 'L / spacer / cavity (n = 1.47)', 1.47, '#9ec5e8', 'S. Jena et al. (2021)'),
      constant('user-n196', 'H (n = 1.96)', 1.96, '#3f6fb5', 'S. Jena et al. (2021)'),
      constant('user-glass152', 'glass (n = 1.52)', 1.52, '#dfe7ee', 'assumed (glass substrate)'),
    ],
    structure: {
      incident: { id: 'Air' },
      blocks: [
        film('ag', 'user-ag-jena', 35, 'Ag'),
        film('sp', 'user-n147', 141, 'spacer S'),
        dbr({ label: '(HL)⁵ C (HL)⁵', periods: 10, lambda0: 500, mirrorAfterCavity: false, period: [layer('H', 'user-n196', 64), layer('L', 'user-n147', 85)], cavities: [{ mat: { id: 'user-n147' }, after: 5, mode: 'nm', d: 85, m: 1, layers2D: 1 }] }),
      ],
      exit: { id: 'user-glass152' },
    },
    sim: sim({ mode: 'lambda', lambda: 500, theta: 0, from: 450, to: 560, points: 1101, pol: 'p' }),
    metrics: [
      newMetric('fwhm', { id: 'b1', ref: 'b1', label: 'Branch 1 (upper energy)', lo: 455, hi: 499 }),
      newMetric('fwhm', { id: 'b2', ref: 'b2', label: 'Branch 2 (lower energy)', lo: 499, hi: 555 }),
      dispersionFit('disp', 'b1', 'b2', 'ds', 'linear', 125, 160),
    ],
    params: [exposed('ds', { kind: 'film', block: 'sp', prop: 'd' }, 'ds (spacer)', 115, 170, 1)],
    sweep: {
      ...defaultSweep(),
      axes: ['ds'],
      plots: [newPlot({ id: 'map', title: 'R(λ, ds)', x: 'lambda', mode: 'map', y: 'ds', color: 'R' }), newPlot({ id: 'branches', title: 'Branches vs ds', source: 'metrics:lambda', x: 'ds', left: ['b1.pos', 'b2.pos'] })],
    },
  });
}

// The excitonic microcavity of spr-forge's strong-coupling example: the cavity thickness swept.
function strongCouplingProject(): Project {
  return finish({
    ...defaultProject(),
    name: 'Strong coupling: polaritons',
    notes: NOTE_SC,
    materials: [
      { id: 'user-exciton', name: 'Exciton layer (Lorentz)', color: '#c24fbd', model: { type: 'drude-lorentz', epsInf: 2.56, wp: 0, gamma: 0, osc: [{ f: 0.06, w0: 1.9, g: 0.05 }] }, source: 'Example material: ε∞ = 2.56 with one Lorentz oscillator, E₀ = 1.9 eV (652.5 nm), γ = 50 meV' },
    ],
    structure: { incident: { id: 'Air' }, blocks: [dbr({ label: 'Microcavity', periods: 12, lambda0: 652.5, cavities: [{ mat: { id: 'user-exciton' }, after: 6, mode: 'nm', d: 200, m: 1, layers2D: 1 }] })], exit: { id: 'BK7' } },
    sim: sim({ mode: 'lambda', lambda: 650, theta: 0, from: 560, to: 760, points: 401, pol: 'p' }),
    metrics: [
      newMetric('fwhm', { id: 'sh', ref: 'sh', label: 'Upper polariton (short λ)', lo: 590, hi: 652.5 }),
      newMetric('fwhm', { id: 'lg', ref: 'lg', label: 'Lower polariton (long λ)', lo: 652.5, hi: 720 }),
      dispersionFit('disp', 'sh', 'lg', 'dc', 'linear', 170, 220),
    ],
    params: [exposed('dc', { kind: 'cavity', block: 'dbr', index: 0, prop: 'd' }, 'cavity d', 150, 260, 5)],
    sweep: {
      ...defaultSweep(),
      axes: ['dc'],
      plots: [newPlot({ id: 'map', title: 'R(λ, d)', x: 'lambda', mode: 'map', y: 'dc', color: 'R' }), newPlot({ id: 'branches', title: 'Branches vs d', source: 'metrics:lambda', x: 'dc', left: ['sh.pos', 'lg.pos'] })],
    },
  });
}

// Varasteanu & Kusko 2021: BK7 | Ag | semiconductor (n a variable) | 2D material | analyte at 633 nm; NSGA-II on S, FWHM and
// R at the resonance, with the constraints of the paper.
function nsgaProject(variant: 'paper' | 'library'): Project {
  const V = VARASTEANU2021;
  const paper = variant === 'paper';
  const HC = 1.23984198; // eV·µm
  const mats: MaterialDef[] = [
    { id: 'user-semi', name: 'semiconductor (n: a variable)', color: '#c98b3a', model: { type: 'constant', n: 2.6, k: 0 }, source: 'the hypothetical semiconductor of the paper (n 1.34–4, k 0)' },
    constant('user-analyte', 'analyte (n = 1.332)', 1.332, '#cfe8f7', 'the sensing medium of the paper (1.332 → 1.337)'),
    constant('user-batio3', 'BaTiO₃ (n = 2.405)', 2.405, '#d9a441', 'the BaTiO₃ of the paper (n = 2.405)'),
    ...(paper
      ? ([
          { id: 'user-ag-v', name: 'Ag (Drude, λc / λp)', color: '#b8bcc6', model: { type: 'drude-lorentz', epsInf: 1, wp: HC / 0.14541, gamma: HC / 17.614, osc: [] }, source: 'n² = 1 − λ²λc / (λp²(λc + iλ)), λc = 17.614 µm, λp = 0.14541 µm (as in the paper)' },
          { id: 'user-gr-v', name: 'graphene (3 + iC₁λ/3)', color: '#444444', model: { type: 'constant', n: 3, k: (5.446 * 0.633) / 3 }, monolayer: 0.34, source: 'n = 3 + i·5.446 µm⁻¹·λ/3 at 633 nm, 0.34 nm per layer (as in the paper)' },
          { id: 'user-mos2-v', name: 'MoS₂ (5.0805 + 1.1724i)', color: '#5b6a8a', model: { type: 'constant', n: 5.0805, k: 1.1724 }, monolayer: 0.65, source: 'at 633 nm, 0.65 nm per layer (as in the paper)' },
          { id: 'user-ws2-v', name: 'WS₂ (4.8937 + 0.3123i)', color: '#6b8a5b', model: { type: 'constant', n: 4.8937, k: 0.3123 }, monolayer: 0.8, source: 'at 633 nm, 0.8 nm per layer (as in the paper)' },
        ] as MaterialDef[])
      : []),
  ];
  const ag = paper ? 'user-ag-v' : 'Ag';
  const twoD = paper ? ['user-gr-v', 'user-mos2-v', 'user-ws2-v'] : ['Graphene', 'MoS2', 'WS2'];
  const t = V.table4[0]; // graphene 40 nm – 11 nm – 1 L (2.66)
  const sRow = (id: string, metric: string, key: string, over: Partial<Objective>) => newObjective(metric, key, { id, scale: 0, ...over });
  return finish({
    ...defaultProject(),
    name: paper ? 'NSGA-II 2D SPR (Varasteanu 2021)' : 'NSGA-II 2D SPR (library materials)',
    notes: paper ? NOTE_NSGA : `${NOTE_NSGA}\n\nThis copy uses the library materials (Ag of Johnson & Christy, the library's graphene, MoS₂, WS₂) instead of the paper's models: the optimum moves a little.`,
    materials: mats,
    structure: {
      incident: { id: 'BK7' },
      blocks: [film('ag', ag, t.ag, 'Ag'), film('semi', { id: 'user-semi', param: t.n }, t.semi, 'semiconductor'), { kind: 'film', id: 'twoD', label: '2D material', mat: { id: twoD[0] }, d: 0, layers2D: t.layers }],
      exit: { id: 'user-analyte' },
    },
    sim: sim({ mode: 'theta', lambda: 633, from: 50, to: 89.5, points: 3951, pol: 'p' }),
    metrics: [newMetric('fwhm', { id: 'res', ref: 'res', label: 'Resonance', expose: ['width', 'R'] }), newMetric('sens', { id: 'sens', ref: 'sens', label: 'Sensitivity', dn: 0.005, expose: ['S'] })],
    params: [
      exposed('dAg', { kind: 'film', block: 'ag', prop: 'd' }, 'Ag thickness', 0, 100, 1, true, true),
      exposed('dSemi', { kind: 'film', block: 'semi', prop: 'd' }, 'semiconductor thickness', 0, 50, 1, true, true),
      exposed('nSemi', { kind: 'film', block: 'semi', prop: 'param' }, 'semiconductor n', 1.34, 4, 0.01, false, true),
      exposed('N2D', { kind: 'film', block: 'twoD', prop: 'layers2D' }, '2D layers', 1, 10, 1, true, true),
      { ...exposed('mat2D', { kind: 'film', block: 'twoD', prop: 'mat' }, '2D material', 0, 2, 1), mats: twoD },
    ],
    opt: {
      ...defaultOpt(),
      algorithm: 'nsga2',
      iterations: 100,
      population: 100,
      seed: 1,
      params: { nsga2: { crossover: { type: 'sbx', prob: 0.9, eta: 15, alpha: 0.5 }, mutation: { type: 'polynomial', prob: NaN, eta: 20, sigma: 0.1 } } },
      objectives: [
        sRow('oS', 'sens', 'S', { goal: 'max' }),
        sRow('oW', 'res', 'width', { goal: 'min' }),
        sRow('oR', 'res', 'R', { goal: 'min', scale: 0.01 }),
        sRow('cS', 'sens', 'S', { role: 'constraint', goal: 'ge', target: 200 }),
        sRow('cW', 'res', 'width', { role: 'constraint', goal: 'le', target: 10 }),
        sRow('cR', 'res', 'R', { role: 'constraint', goal: 'le', target: 0.01 }),
      ],
    },
    sweep: { ...defaultSweep(), plots: [newPlot({ id: 'main', title: 'Response (n and n + Δn)', x: 'theta', left: ['R'] })] },
  });
}

// He et al.: ten layers and the CdO carrier density as variables, two matches to the target, Adam in two stages.
function heProject(): Project {
  const names = ['Ge', 'SiO', 'Ge', 'SiO', 'Ge', 'SiO', 'Ge', 'SiO', 'Ge', 'CdO'];
  const mat = (n: string) => (n === 'Ge' ? 'user-ge-4' : n === 'SiO' ? 'user-sio-225' : 'user-cdo-nolen');
  // the target of their code: R = 1 − L/L(grid max) − G/G(grid max) on the grid 1500 … 3499 cm⁻¹
  const grid = Array.from({ length: 2000 }, (_, i) => 1e7 / (1500 + i));
  const lMax = Math.max(...grid.map((l) => 1 / (1 + ((l - HE2021.dips[0]) / (HE2021.lorentzFwhm / 2)) ** 2)));
  const gMax = Math.max(...grid.map((l) => Math.exp(-(((l - HE2021.dips[1]) / HE2021.gaussSigma) ** 2) / 2)));
  const target = [
    comp('baseline', { c: 1, s: 0 }),
    comp('lorentz', { A: -1 / lMax, x0: HE2021.dips[0], w: HE2021.lorentzFwhm }),
    comp('gauss', { A: -1 / gMax, x0: HE2021.dips[1], w: 2 * Math.sqrt(2 * Math.LN2) * HE2021.gaussSigma }),
  ];
  const blocks = names.map((n, i) => film(`l${i + 1}`, n === 'CdO' ? { id: mat(n), param: 2.2 } : mat(n), 450, n));
  const oAll = newObjective('mAll', 'cost', { id: 'oAll', goal: 'min', scale: 1 });
  const oRes = newObjective('mRes', 'cost', { id: 'oRes', goal: 'min', scale: 1 });
  return finish({
    ...defaultProject(),
    name: 'Tamm emitter by Adam (He 2021)',
    notes: NOTE_HE,
    materials: [
      constant('user-ge-4', 'Ge (n = 4.0)', 4.0, '#7b7f86', 'M. He et al. (2021), published code: Ge = 4.0'),
      constant('user-sio-225', 'SiO (n = 2.25)', 2.25, '#9ec5e8', 'M. He et al. (2021), published code: SiO = 2.25 (layers and substrate)'),
      {
        id: 'user-cdo-nolen',
        name: 'CdO (doped, Drude)',
        color: '#c98b3a',
        model: { type: 'drude-carrier', epsInf: 5.1, N: 2.2, mStar0: 0.1, C: 1.47 * (3.14 / (Math.PI * Math.PI)) ** (2 / 3), mobility: 200 },
        source: 'J. R. Nolen et al., Phys. Rev. Mater. 4, 025202 (2020), as in the code of M. He et al. (2021): ε∞ = 5.1, m0* = 0.1, μ = 200 cm²/(V·s), non-parabolicity 1.47 with (3πn)^⅔ (here C = 1.47·(3.14/π²)^⅔ in the (3π²n)^⅔ form)',
      },
    ],
    structure: { incident: { id: 'Air' }, blocks, exit: { id: 'user-sio-225' } },
    sim: sim({ mode: 'lambda', lambda: 4237, theta: 0, from: 2850, to: 6670, points: 1911, pol: 's' }),
    metrics: [
      newMetric('match', { id: 'mAll', ref: 'mAll', label: 'Match: full spectrum', match: { comps: target, cost: 'msemax', lambdaMax: 0.01, below: 1 }, expose: ['cost'] }),
      newMetric('match', { id: 'mRes', ref: 'mRes', label: 'Match: the resonances', match: { comps: target, cost: 'msemax', lambdaMax: 0.01, below: 0.95 }, expose: ['cost'] }),
      newMetric('min', { id: 'd1', ref: 'd1', label: 'Dip at 4237 nm', lo: 4000, hi: 4500 }),
      newMetric('min', { id: 'd2', ref: 'd2', label: 'Dip at 3500 nm', lo: 3300, hi: 3700 }),
    ],
    params: [
      ...names.map((n, i) => exposed(`d${i + 1}`, { kind: 'film', block: `l${i + 1}`, prop: 'd' }, `d${i + 1} ${n}`, HE2021.thickness[0], HE2021.thickness[1], 10, false, true)),
      exposed('N', { kind: 'film', block: 'l10', prop: 'param' }, 'N CdO (10²⁰ cm⁻³)', HE2021.N[0], HE2021.N[1], 0.1, false, true),
    ],
    opt: {
      ...defaultOpt(),
      algorithm: 'adam',
      iterations: 650,
      seed: 1,
      params: { adam: { lr: 0.05, decay: 0.7, decaySteps: 100, stage1Iter: 200, stage1Lr: 0.01, starts: 4, stall: 0, stage1Obj: [oRes.id], stage2Obj: [oAll.id] } },
      objectives: [oAll, oRes],
    },
  });
}
