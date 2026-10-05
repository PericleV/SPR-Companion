// Physics and algorithm checks (npm run check). Each check prints its result and throws when it fails.
// The TMM, field and optimizer checks are taken from spr-forge's scripts/check-tmm.ts; the structure checks are new.
import { makeLibrary, modelsOf } from '../src/physics/library.ts';
import { emaEps, kuboSigma, refractiveIndex, type MaterialDef } from '../src/physics/materials.ts';
import { resample } from '../src/model/materials.ts';
import * as CX from '../src/physics/complex.ts';
import { c, type C } from '../src/physics/complex.ts';
import { interfaceCoeffs, nCos, tmmPoint, type Layer, type Polarization } from '../src/physics/tmm.ts';
import { fieldProfile, profileGrid } from '../src/physics/field.ts';
import { extremum, halfWidth } from '../src/engine/metrics.ts';
import { differentialEvolution, fromScalar, genetic, levenbergMarquardtBatch, nsga2, particleSwarm, rng, Tracker, type Box, type Control, type Evaluate } from '../src/engine/optimize.ts';
import { evaluateSensor, runSprGa, sprClassOf, type SprMaterial, type SprProblem, type SprStructure } from '../src/engine/sprDesign.ts';
import { describe, expand, realization, type Dbr, type Structure } from '../src/model/structure.ts';
import { corrLength, defaultRough, heightsOf, statsOf as roughStats, type RoughMix, type Roughs } from '../src/model/rough.ts';
import { linspace, scan, stackAt } from '../src/model/compute.ts';
import { analyze, fieldStats, interrogationOf, metricsOn, profileAt, type Interrogation } from '../src/model/analysis.ts';
import { evalMetrics, newMetric, newZone, polyOfZone, polyRoi } from '../src/model/metrics.ts';
import { COMPONENTS } from '../src/engine/fitmodels.ts';
import { exposeDefaults, sweepValues } from '../src/model/exposed.ts';
import { addConfig, addConfigsFrom, configsOf, defaultProject, parseProject, removeConfig, renameConfig, stringifyProject, switchConfig } from '../src/model/project.ts';
import { applyParams, listParams, paramKey } from '../src/model/params.ts';
import { boxOf, evaluateCandidates, newObjective, optRecordOf, rankSolutions, rowValues, sampledValues, valuesAt, variablesOf, type EvalJob } from '../src/model/optimization.ts';
import { defaultSprDesign, describeSpr, problemOf, structureOf } from '../src/model/sprGa.ts';
import { layout, placeBlock, runSweepChunk, sizeOf, type SweepJob } from '../src/model/sweep.ts';
import { analyzeSweep, type SweepData } from '../src/model/sweepAnalysis.ts';
import { guessSpectrum, newComponent } from '../src/engine/fitmodels.ts';
import { fitSpectrum } from '../src/engine/fitrun.ts';
import { adam, paretoRanks } from '../src/engine/optimize.ts';
import { EXAMPLES, MYOGLOBIN_WASILEWSKA, RABI_JENA, SREEKANTH2023, TAMM_LU2019, VARASTEANU2021 } from '../src/model/examples.ts';
import { paramInfos, simulate, simulateCore, toleranceRows } from '../src/model/run.ts';
import { newVariation, statsOf, tolSamples } from '../src/model/tolerance.ts';
import { ANALYTES, blocking, simulate as kinSimulate, surfaceOf, THETA_JAM, type KineticParams } from '../src/engine/kinetics.ts';
import { applySeriesPlan, defaultSg, kineticsOf, planSeries, sgCalibrate, sgCompute, sgFinish, sgOf, sgPlan, type SgResult, type SgSettings } from '../src/model/sensorgram.ts';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
}
const e = (v: number, d = 1) => v.toExponential(d);

const lib = makeLibrary([]);
const models = modelsOf(lib);
const n = (id: string, l = 633) => refractiveIndex(id, models, l);
const argmin = (a: ArrayLike<number>) => {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] < a[k]) k = i;
  return k;
};

// ---- Fresnel, Brewster, energy conservation ----
{
  const nb = n('BK7').re;
  const g = [{ n: c(1), d: 0 }, { n: n('BK7'), d: 0 }];
  const R0 = tmmPoint(g, 633, 0, 'p').R;
  check('Fresnel at normal incidence', Math.abs(R0 - ((1 - nb) / (1 + nb)) ** 2) < 1e-14, `R ${R0.toFixed(6)}`);
  const Rb = tmmPoint(g, 633, (Math.atan(nb) * 180) / Math.PI, 'p').R;
  check('R_p at Brewster', Rb < 1e-15, `R ${e(Rb)}`);
  const d = [{ n: n('BK7'), d: 0 }, { n: c(n('SiO2').re), d: 200 }, { n: n('Water'), d: 0 }];
  const A = Math.abs(tmmPoint(d, 633, 20, 'p').A);
  check('lossless stack absorbs nothing', A < 1e-14, `A ${e(A)}`);
}

// ---- The fast real-arithmetic TMM = the complex-object reference (random stacks: metals, TIR, thick layers) ----
{
  type M2 = [C, C, C, C];
  function tmmRef(input: Layer[], lambda: number, theta: number, pol: Polarization) {
    const layers = [{ ...input[0], n: c(input[0].n.re) }, ...input.slice(1)];
    const N = layers.length;
    const kx = CX.mul(layers[0].n, c(Math.sin((theta * Math.PI) / 180)));
    const q = layers.map((L) => nCos(L.n, kx));
    const k0 = (2 * Math.PI) / lambda;
    const scaled = (r: C, t: C): M2 => {
      const it = CX.div(c(1), t);
      return [it, CX.mul(r, it), CX.mul(r, it), it];
    };
    let { r, t } = interfaceCoeffs(pol, layers[0].n, layers[1].n, q[0], q[1]);
    let M = scaled(r, t);
    for (let j = 1; j < N - 1; j++) {
      const delta = CX.mul(q[j], c(k0 * layers[j].d));
      const P: M2 = [CX.exp(CX.mul(c(0, -1), delta)), c(0), c(0), CX.exp(CX.mul(c(0, 1), delta))];
      ({ r, t } = interfaceCoeffs(pol, layers[j].n, layers[j + 1].n, q[j], q[j + 1]));
      M = CX.matmul(M, CX.matmul(P, scaled(r, t)));
    }
    const rr = CX.div(M[2], M[0]);
    const tt = CX.div(c(1), M[0]);
    const [nf, qf, n0, q0] = [layers[N - 1].n, q[N - 1], layers[0].n, q[0]];
    const T = pol === 's' ? (CX.abs2(tt) * qf.re) / q0.re : (CX.abs2(tt) * CX.mul(nf, CX.conj(CX.div(qf, nf))).re) / CX.mul(n0, CX.conj(CX.div(q0, n0))).re;
    return { R: CX.abs2(rr), T };
  }
  const rnd = rng(42);
  let dRT = 0;
  for (let k = 0; k < 400; k++) {
    const layers: Layer[] = [{ n: c(1 + rnd() * 0.8), d: 0 }];
    const count = 1 + Math.floor(rnd() * 12);
    for (let j = 0; j < count; j++) {
      const metal = rnd() < 0.2;
      layers.push({ n: metal ? c(0.05 + rnd() * 0.5, 2 + rnd() * 5) : c(1.3 + rnd() * 1.4, rnd() < 0.3 ? rnd() * 0.05 : 0), d: metal ? 5 + rnd() * 60 : 10 + rnd() * 900 });
    }
    layers.push({ n: rnd() < 0.2 ? c(0.2, 3.5) : c(1 + rnd() * 1.2, rnd() < 0.2 ? 0.01 : 0), d: 0 });
    const lam = 350 + rnd() * 1200;
    const th = rnd() * 85;
    for (const pol of ['s', 'p'] as const) {
      const a = tmmPoint(layers, lam, th, pol);
      const b = tmmRef(layers, lam, th, pol);
      dRT = Math.max(dRT, Math.abs(a.R - b.R), Math.abs(a.T - b.T));
    }
  }
  check('fast TMM = complex-object reference (800 random cases)', dRT < 1e-12, `max |ΔR|, |ΔT| ${e(dRT)}`);
}

// ---- Field profile: R, T as the TMM, energy balance, continuity of the tangential fields ----
{
  const cases: [string, Layer[], number, number, Polarization][] = [
    ['SPR BK7/Ag 50/Water, p, 67.7°', [{ n: n('BK7'), d: 0 }, { n: n('Ag'), d: 50 }, { n: n('Water'), d: 0 }], 633, 67.73, 'p'],
    ['Cr/Au/TiO2 on BK7, p, 30°', [{ n: n('BK7', 550), d: 0 }, { n: n('Cr', 550), d: 3 }, { n: n('Au', 550), d: 40 }, { n: n('TiO2', 550), d: 80 }, { n: n('Air', 550), d: 0 }], 550, 30, 'p'],
  ];
  for (const [name, layers, lam, th, pol] of cases) {
    const g = profileGrid(layers.map((L) => L.d), 300, 400, 4000);
    const p = fieldProfile(layers, lam, th, pol, g.z, g.layer);
    const ref = tmmPoint(layers, lam, th, pol);
    let jump = 0;
    const [tE, tH] = pol === 's' ? (['Ey', 'Hx'] as const) : (['Ex', 'Hy'] as const);
    for (let i = 1; i < p.z.length; i++)
      if (p.z[i] === p.z[i - 1] && p.layer[i] !== p.layer[i - 1])
        for (const f of [tE, tH]) jump = Math.max(jump, Math.hypot(p.fields[f].re[i] - p.fields[f].re[i - 1], p.fields[f].im[i] - p.fields[f].im[i - 1]));
    const balance = p.R + p.T + p.layerAbs.slice(1, -1).reduce((a, b) => a + b, 0);
    const ok = Math.abs(p.R - ref.R) < 1e-12 && Math.abs(p.T - ref.T) < 1e-9 && Math.abs(balance - 1) < 1e-9 && jump < 1e-9;
    check(`field profile, ${name}`, ok, `R ${p.R.toFixed(6)}, R+T+ΣA ${balance.toFixed(10)}, tangential jumps ${e(jump)}`);
  }
}

// ---- Effective media: the three rules give the constituents at p = 0 and 1 ----
{
  const e1 = c(1);
  const e2 = c(11.9, 0.1);
  let err = 0;
  for (const m of ['bruggeman', 'maxwell-garnett', 'looyenga'] as const) {
    const a = emaEps(m, e1, e2, 0);
    const b = emaEps(m, e1, e2, 1);
    err = Math.max(err, Math.hypot(a.re - e2.re, a.im - e2.im), Math.hypot(b.re - e1.re, b.im - e1.im));
  }
  check('EMA end points (Bruggeman, Maxwell Garnett, Looyenga)', err < 1e-9, `max |Δε| ${e(err)}`);
}

// ---- Graphene by the Kubo conductivity: universal absorption πα of a free-standing layer; Pauli blocking below 2μ ----
{
  const g = { type: 'kubo', mu: 0, T: 300, gamma: 0.01, d: 0.34, epsBg: 1 } as const;
  const gm = { ...models, gk: g };
  const film = (l: number) => [{ n: c(1), d: 0 }, { n: refractiveIndex('gk', gm, l), d: 0.34 }, { n: c(1), d: 0 }];
  const A = tmmPoint(film(550), 550, 0, 's').A;
  const pa = Math.PI / 137.036;
  const ref = pa / (1 + pa / 2) ** 2; // thin conducting sheet with σ = σ₀: A = πα/(1 + πα/2)²
  const blocked = kuboSigma({ ...g, mu: 0.5 }, 0.6).re;
  check('graphene (Kubo): absorption πα, Pauli blocking', Math.abs(A / ref - 1) < 0.02 && blocked < 0.1, `A(550 nm) ${(100 * A).toFixed(3)} % (sheet ${(100 * ref).toFixed(3)} %), Re σ/σ₀ at 0.6 eV with μ = 0.5 eV: ${blocked.toFixed(3)}`);
}

// ---- Tabulated data resampled by a cubic spline ----
{
  const t = { lambda: Array.from({ length: 21 }, (_, i) => 0.4 + i * 0.03), n: [] as number[], k: [] as number[] };
  t.n = t.lambda.map((l) => 1.5 + 0.1 * Math.sin(10 * l));
  t.k = t.lambda.map((l) => 0.2 + 0.1 * Math.cos(10 * l));
  // the natural spline (zero curvature at the ends) is exact to O(h⁴) inside, less so in the end intervals
  const errOf = (r: ReturnType<typeof resample>, inner: boolean) =>
    Math.max(...r.lambda.map((l, i) => (inner && (l < 0.52 || l > 0.88) ? 0 : Math.max(Math.abs(r.n[i] - (1.5 + 0.1 * Math.sin(10 * l))), Math.abs(r.k[i] - (0.2 + 0.1 * Math.cos(10 * l)))))));
  const sp = resample(t, 301, 'spline');
  const li = resample(t, 301, 'linear');
  const [eIn, eAll, eLin] = [errOf(sp, true), errOf(sp, false), errOf(li, true)];
  check('cubic-spline resampling', eIn < eLin / 50 && eAll < 1e-3 && sp.lambda.length === 301, `21 rows → 301: spline ${e(eIn)} inside (${e(eAll)} with the end intervals), linear ${e(eLin)}`);
}

// ---- Structures: constant materials for exact references ----
const consts: MaterialDef[] = [
  { id: 'H', name: 'H', color: '#c33', model: { type: 'constant', n: 2.3, k: 0 } },
  { id: 'L', name: 'L', color: '#33c', model: { type: 'constant', n: 1.46, k: 0 } },
  { id: 'S', name: 'S', color: '#999', model: { type: 'constant', n: 1.52, k: 0 } },
  { id: 'M', name: 'M', color: '#da0', model: { type: 'constant', n: 0.2, k: 3.5 } },
];
const clib = makeLibrary(consts);
const cmodels = modelsOf(clib);
const dbr = (over: Partial<Dbr> = {}): Dbr => ({
  kind: 'dbr', id: 'dbr', label: 'DBR', periods: 6, lambda0: 650, closing: false, mirrorAfterCavity: true, cavities: [],
  period: [{ label: 'H', mat: { id: 'H' }, mode: 'qw', d: 0, layers2D: 1 }, { label: 'L', mat: { id: 'L' }, mode: 'qw', d: 0, layers2D: 1 }],
  ...over,
});

// quarter-wave mirror: R(λ₀) = ((1 − Y)/(1 + Y))², Y = (nH/nL)^2N · nS
{
  const s: Structure = { incident: { id: 'Air' }, blocks: [dbr()], exit: { id: 'S' } };
  const ex = expand(s, clib, cmodels);
  const R = scan(ex, cmodels, { lambda: [650], theta: [0], pol: 's' }).fields.R[0];
  const Y = (2.3 / 1.46) ** 12 * 1.52;
  const ref = ((1 - Y) / (1 + Y)) ** 2;
  check('DBR block, quarter-wave mirror R(λ₀) = analytic', Math.abs(R - ref) < 1e-12, `${R.toFixed(9)} vs ${ref.toFixed(9)}`);
}

// layer sequence: cavities after periods 0 and 2, mirrored after each, closing layer; clamped position
{
  const s: Structure = {
    incident: { id: 'Air' },
    blocks: [dbr({ periods: 3, closing: true, cavities: [{ mat: { id: 'M' }, after: 2, mode: 'nm', d: 10, m: 1, layers2D: 1 }, { mat: { id: 'S' }, after: 0, mode: 'nm', d: 5, m: 1, layers2D: 1 }] })],
    exit: { id: 'S' },
  };
  const seq = expand(s, clib, cmodels).layers.map((L) => L.mat.id).join('');
  const clamped = expand({ ...s, blocks: [dbr({ periods: 2, cavities: [{ mat: { id: 'M' }, after: 5, mode: 'nm', d: 10, m: 1, layers2D: 1 }] })] }, clib, cmodels);
  const ok = seq === 'SLHLHMHLH' && clamped.warnings.length === 1 && clamped.layers.at(-1)!.mat.id === 'M';
  check('DBR block, cavities / mirror / closing / clamped position', ok, `sequence ${seq} (expected SLHLHMHLH: cavity 0, LH ×2 mirrored, cavity, HL, closing H)`);
}

// a half-wave cavity between mirrored quarter-wave mirrors, same medium on both sides: T(λ₀) = 1
{
  // (HL)³ C (LH)³: a palindrome, so lossless and between equal media it transmits fully at its mode
  const sym: Structure = { incident: { id: 'S' }, blocks: [dbr({ periods: 6, cavities: [{ mat: { id: 'L' }, after: 3, mode: 'half', d: 0, m: 1, layers2D: 1 }] })], exit: { id: 'S' } };
  const ex = expand(sym, clib, cmodels);
  const lam = linspace(600, 700, 2001);
  const d = scan(ex, cmodels, { lambda: lam, theta: [0], pol: 's' });
  const T0 = d.fields.T[1000];
  const k = argmin(d.fields.R);
  check('DBR microcavity: T(λ₀) = 1, the mode at λ₀', Math.abs(T0 - 1) < 1e-12 && Math.abs(lam[k] - 650) < 0.06, `T(650) = ${T0.toFixed(12)}, R minimum at ${lam[k].toFixed(2)} nm; ${describe(ex, clib)}`);
}

// reversed illumination: T is the same from both sides at normal incidence (reciprocity), R is not with a metal
{
  const s: Structure = { incident: { id: 'S' }, blocks: [{ kind: 'film', id: 'f', label: '', mat: { id: 'M' }, d: 30, layers2D: 1 }, dbr({ periods: 3 })], exit: { id: 'Air' } };
  const a = scan(expand(s, clib, cmodels), cmodels, { lambda: [600], theta: [0], pol: 's' });
  const b = scan(expand({ ...s, reversed: true }, clib, cmodels), cmodels, { lambda: [600], theta: [0], pol: 's' });
  const ok = Math.abs(a.fields.T[0] - b.fields.T[0]) < 1e-12 && Math.abs(a.fields.R[0] - b.fields.R[0]) > 1e-3;
  check('reversed illumination (reciprocity)', ok, `T ${a.fields.T[0].toFixed(6)} / ${b.fields.T[0].toFixed(6)}, R ${a.fields.R[0].toFixed(4)} / ${b.fields.R[0].toFixed(4)}`);
}

// 2D materials: thickness = monolayers × monolayer thickness
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'g', label: '', mat: { id: 'Graphene' }, d: 0, layers2D: 3 }], exit: { id: 'Water' } };
  const d = expand(s, lib, models).layers[0].d;
  check('2D material thickness', Math.abs(d - 3 * lib.get('Graphene')!.monolayer!) < 1e-12, `3 layers of graphene = ${d} nm`);
}

// ---- SPR: Kretschmann dip and sensitivity vs the surface-plasmon condition ----
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'ag', label: '', mat: { id: 'Ag' }, d: 50, layers2D: 1 }], exit: { id: 'Water' } };
  const ex = expand(s, lib, models);
  const th = linspace(60, 80, 4001);
  const R0 = scan(ex, models, { lambda: [633], theta: th, pol: 'p' }).fields.R;
  const R1 = scan(ex, models, { lambda: [633], theta: th, pol: 'p', perturb: { targets: [2], dn: 1e-3 } }).fields.R;
  const a = extremum(th, R0, 0, th.length - 1, 'min');
  const b = extremum(th, R1, 0, th.length - 1, 'min');
  const S = (b.x - a.x) / 1e-3;
  // semi-infinite metal: n_p sin θ = Re √(εm εd / (εm + εd))
  const np = n('BK7').re;
  const em = CX.mul(n('Ag'), n('Ag'));
  const thetaOf = (nd: number) => {
    const ed = c(nd * nd);
    return (Math.asin(CX.sqrt(CX.div(CX.mul(em, ed), CX.add(em, ed))).re / np) * 180) / Math.PI;
  };
  const nd = n('Water').re;
  const Sa = (thetaOf(nd + 1e-4) - thetaOf(nd - 1e-4)) / 2e-4;
  const w = halfWidth(th, R0, 0, th.length - 1, 'dip', 'local');
  check('SPR sensitivity vs the analytic plasmon condition', Math.abs(S / Sa - 1) < 0.05, `dip ${a.x.toFixed(3)}° (R ${a.y.toFixed(4)}), FWHM ${w.width.toFixed(3)}°, S ${S.toFixed(1)} °/RIU, analytic ${Sa.toFixed(1)}`);
  const stack = stackAt(ex, models, 633, { targets: [2], dn: 1e-3 });
  check('perturbation Δn of the exit medium', Math.abs(stack[2].n.re - nd - 1e-3) < 1e-15, `n ${stack[2].n.re.toFixed(6)}`);
}

// ---- Analysis: ROI metrics and sensitivity = the direct computation; DBR band width = the analytic stop band ----
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'ag', label: '', mat: { id: 'Ag' }, d: 50, layers2D: 1 }], exit: { id: 'Water' } };
  const ex = expand(s, lib, models);
  const it: Interrogation = { mode: 'theta', lambda: 633, theta: 0, from: 60, to: 80, points: 4001, pol: 'p' };
  const a = analyze(ex, models, it, [newMetric('fwhm', { id: 'w' }), newMetric('sens', { id: 's' }), newMetric('fom', { id: 'f' }), newMetric('min', { id: 'n' }), newMetric('max', { id: 'x', lo: 60, hi: 65 })]);
  const th = linspace(60, 80, 4001);
  const R0 = scan(ex, models, { lambda: [633], theta: th, pol: 'p' }).fields.R;
  const R1 = scan(ex, models, { lambda: [633], theta: th, pol: 'p', perturb: { targets: [2], dn: 1e-3 } }).fields.R;
  const S = (extremum(th, R1, 0, th.length - 1, 'min').x - extremum(th, R0, 0, th.length - 1, 'min').x) / 1e-3;
  const [w, sv, f, mn, mx] = a.metrics.map((r) => r.values);
  const ok = Math.abs(sv.S - S) < 1e-6 && Math.abs(f.fom - Math.abs(S) / w.width) < 1e-9 && Math.abs(mn.pos - w.pos) < 1e-12 && mx.pos <= 65 && a.shifts.length === 1;
  check('metrics: FWHM, S, FOM, min, max = the direct computation (one perturbed scan shared)', ok, `S ${sv.S.toFixed(3)} °/RIU, FWHM ${w.width.toFixed(4)}°, FOM ${f.fom.toFixed(2)} 1/RIU, max in 60–65° at ${mx.pos.toFixed(2)}°`);

  // quarter-wave stop band: in frequency symmetric about ω₀ with relative width Δg = (4/π)·asin((nH − nL)/(nH + nL)),
  // so its edges are λ₀/(1 ± Δg/2). The width at half height tends to it for many periods (230 nm at N = 8, 193 at 40)
  const peak = (lo: number, hi: number) => newMetric('fwhm', { feature: 'peak', lo, hi });
  const mirror: Structure = { incident: { id: 'Air' }, blocks: [dbr({ periods: 100 })], exit: { id: 'S' } };
  const am = analyze(expand(mirror, clib, cmodels), cmodels, { mode: 'lambda', lambda: 650, theta: 0, from: 450, to: 950, points: 20001, pol: 's' }, [peak(520, 850)]);
  const dg = (4 / Math.PI) * Math.asin((2.3 - 1.46) / (2.3 + 1.46));
  const [l1, l2] = [650 / (1 + dg / 2), 650 / (1 - dg / 2)];
  const b = am.metrics[0].marks;
  check('DBR stop band edges (band width, 100 periods) vs analytic', Math.abs(b.x1! - l1) < 1 && Math.abs(b.x2! - l2) < 1 && b.y! > 0.999999, `${b.x1!.toFixed(2)}–${b.x2!.toFixed(2)} nm vs ${l1.toFixed(2)}–${l2.toFixed(2)} nm, R max ${b.y!.toFixed(8)}`);

  // microcavity: the dip at λ₀ in its ROI, the sensitivity to the cavity index ≈ λ₀ · (energy fraction in the cavity) / n
  const cav: Structure = { incident: { id: 'S' }, blocks: [dbr({ periods: 10, cavities: [{ mat: { id: 'L' }, after: 5, mode: 'half', d: 0, m: 1, layers2D: 1 }] })], exit: { id: 'S' } };
  const ac = analyze(expand(cav, clib, cmodels), cmodels, { mode: 'lambda', lambda: 650, theta: 0, from: 600, to: 700, points: 20001, pol: 's' }, [newMetric('fwhm', { lo: 640, hi: 660 }), newMetric('sens', { lo: 640, hi: 660, target: { kind: 'cavity', block: 'dbr', index: 0 } })]);
  const [m, ms] = ac.metrics.map((r) => r.values);
  check('microcavity mode and its sensitivity to the cavity', Math.abs(m.pos - 650) < 0.01 && ms.S > 0 && ms.S < 650 / 1.46, `mode ${m.pos.toFixed(3)} nm, Q ${m.q.toFixed(0)}, S ${ms.S.toFixed(1)} nm/RIU (< λ₀/n = ${(650 / 1.46).toFixed(0)})`);
  // its stop band: the mode inside it does not cut it
  const band = analyze(expand(cav, clib, cmodels), cmodels, { mode: 'lambda', lambda: 650, theta: 0, from: 450, to: 950, points: 10001, pol: 's' }, [peak(520, 850)]).metrics[0];
  check('stop band with a cavity mode inside (not cut by it)', band.marks.x1! < 620 && band.marks.x2! > 680 && band.values.width > 150, `edges ${band.marks.x1!.toFixed(1)}–${band.marks.x2!.toFixed(1)} nm around the mode at 650 nm (5 periods on each side)`);

  // a ROI following a parameter: the zone at the parameter's value replaces the fixed ROI
  const fol = newMetric('min', { lo: 60, hi: 62, follow: { param: 'p', pts: [{ y: 0, lo: 60, hi: 62 }, { y: 10, lo: 66, hi: 70 }] } });
  const [r1, r2] = [metricsOn(a.xs, a.curves, [], [fol], false)[0], metricsOn(a.xs, a.curves, [], [fol], false, { p: 10 })[0]];
  check('ROI following a parameter (zone)', r1.values.pos <= 62 && Math.abs(r2.values.pos - w.pos) < 1e-9, `fixed ROI: ${r1.values.pos.toFixed(2)}°, zone at the parameter's 10: ${r2.values.pos.toFixed(3)}° (the dip)`);
}

// ---- Parameters and sweeps: applied values = structures edited by hand; sweep chunks = direct computations ----
{
  const base: Structure = { incident: { id: 'Air' }, blocks: [dbr({ periods: 4, cavities: [{ mat: { id: 'L' }, after: 2, mode: 'half', d: 0, m: 1, layers2D: 1 }] })], exit: { id: 'S' } };
  const it: Interrogation = { mode: 'lambda', lambda: 650, theta: 0, from: 550, to: 750, points: 201, pol: 's' };
  const { structure } = applyParams(base, it, [
    [{ kind: 'dbr', block: 'dbr', prop: 'periods' }, 6],
    [{ kind: 'cavity', block: 'dbr', index: 0, prop: 'after' }, 3],
    [{ kind: 'period', block: 'dbr', index: 1, prop: 'mat' }, 'M'],
  ]);
  const seq = expand(structure, clib, cmodels).layers.map((L) => L.mat.id).join('');
  const params = listParams(base, it, clib);
  check('parameters applied (periods, cavity position, material)', seq === 'HMHMHMLMHMHMH' && params.some((p) => p.ref.kind === 'cavity' && p.ref.prop === 'after'), `sequence ${seq}; ${params.length} parameters listed`);

  // an N-D sweep: θ × N × λ (λ and θ inner loops, in any place among the axes), with a perturbed R
  const job: SweepJob = {
    structure: base,
    base: { lambda: 650, theta: 0, pol: 's' },
    axes: [{ id: 'theta', ref: { kind: 'scan', prop: 'theta' }, values: [0, 30] }, { id: 'N', ref: { kind: 'dbr', block: 'dbr', prop: 'periods' }, values: [3, 5] }, { id: 'lambda', ref: { kind: 'scan', prop: 'lambda' }, values: [600, 650, 700] }],
    fields: ['R', 'T'],
    shifts: [{ key: 'k', target: { kind: 'exit' }, dn: 0.01 }],
  };
  const n = sizeOf(job);
  const full: Partial<Record<'R' | 'T', Float64Array>> = { R: new Float64Array(n), T: new Float64Array(n) };
  const sh = [new Float64Array(n)];
  for (const b of runSweepChunk(job, clib, cmodels, [0, 1])) placeBlock(job, b, full, sh);
  let err = 0;
  [0, 30].forEach((th, i) =>
    [3, 5].forEach((N, j) =>
      [600, 650, 700].forEach((lam, k) => {
        const ex = expand({ ...base, blocks: [dbr({ periods: N, cavities: base.blocks[0].kind === 'dbr' ? base.blocks[0].cavities : [] })] }, clib, cmodels);
        const at = i * 6 + j * 3 + k;
        const d = scan(ex, cmodels, { lambda: [lam], theta: [th], pol: 's' }).fields;
        const dp = scan(ex, cmodels, { lambda: [lam], theta: [th], pol: 's', perturb: { targets: [ex.layers.length + 1], dn: 0.01 } }).fields;
        err = Math.max(err, Math.abs(d.R[0] - full.R![at]), Math.abs(d.T[0] - full.T![at]), Math.abs(dp.R[0] - sh[0][at]));
      }),
    ),
  );
  check('N-D sweep (θ × periods × λ, perturbed R) = direct computations', err < 1e-14 && layout(job).outerCount === 2, `${n} points, max |ΔR|, |ΔT| ${e(err)}`);

  // sweep values: by step, by number of values, a list; integers rounded and deduplicated; within the bounds
  const info = listParams(base, it, clib).find((p) => p.ref.kind === 'dbr' && p.ref.prop === 'lambda0')!;
  const x = exposeDefaults(info);
  const v = (sweep: Partial<typeof x.sweep>) => sweepValues({ ...x, sweep: { ...x.sweep, ...sweep } }, info).join(' ');
  const got = [v({ mode: 'step', from: 600, to: 700, step: 25, integer: false }), v({ mode: 'count', from: 600, to: 601, count: 5, integer: true }), v({ mode: 'list', list: '650, 640 x 660', integer: false })];
  const exp = ['600 625 650 675 700', '600 601', '640 650 660'];
  check('sweep values (step, number of values with integers, list)', got.join('|') === exp.join('|'), got.map((g) => `[${g}]`).join(' '));

  // analyses of a sweep: along λ for every N, the ROI following N (a zone) = the analysis of each curve with that ROI
  const lam = linspace(550, 750, 201);
  const job1: SweepJob = { structure: base, base: { lambda: 650, theta: 0, pol: 's' }, axes: [{ id: 'N', ref: { kind: 'dbr', block: 'dbr', prop: 'periods' }, values: [3, 5] }, { id: 'lambda', ref: { kind: 'scan', prop: 'lambda' }, values: lam }], fields: ['R'], shifts: [] };
  const R1 = { R: new Float64Array(sizeOf(job1)) };
  for (const b of runSweepChunk(job1, clib, cmodels, [0, 1])) placeBlock(job1, b, R1, []);
  const data: SweepData = { axes: [{ id: 'N', label: 'N', unit: '', values: [3, 5] }, { id: 'lambda', label: 'λ', unit: 'nm', values: lam }], fields: R1, shifts: [], size: sizeOf(job1) };
  const groups = analyzeSweep(data, [newMetric('min', { ref: 'mn', along: 'lambda', lo: 550, hi: 600, follow: { param: 'N', pts: [{ y: 3, lo: 640, hi: 660 }, { y: 5, lo: 640, hi: 660 }] } }), newMetric('fwhm', { ref: 'band', along: 'lambda', feature: 'peak', lo: 560, hi: 740 })], 'lambda');
  const g = groups[0];
  const pos = Array.from(g.dataset.fields['mn.pos']);
  const direct = [3, 5].map((N) => {
    const ex = expand({ ...base, blocks: [dbr({ periods: N, cavities: base.blocks[0].kind === 'dbr' ? base.blocks[0].cavities : [] })] }, clib, cmodels);
    const R = scan(ex, cmodels, { lambda: lam, theta: [0], pol: 's' }).fields.R;
    const [i0, i1] = [lam.findIndex((x) => x >= 640), lam.findLastIndex((x) => x <= 660)];
    return extremum(lam, R, i0, i1, 'min').x;
  });
  const ok = groups.length === 1 && g.dataset.axes.map((x) => x.id).join() === 'N' && pos.every((p, i) => Math.abs(p - direct[i]) < 1e-12) && g.dataset.fields['band.width'].length === 2;
  check('sweep analyses along λ (ROI following N) = analyses of each curve', ok, `minima ${pos.map((p) => p.toFixed(3)).join(', ')} nm; band widths ${Array.from(g.dataset.fields['band.width'], (v) => v.toFixed(1)).join(', ')} nm`);
}

// ---- Fit and custom metrics: the fit of a dip; formulas of the other metrics = the built-in FOM and Q ----
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 48, layers2D: 1 }], exit: { id: 'Water' } };
  const ex = expand(s, lib, models);
  const it: Interrogation = { mode: 'lambda', lambda: 700, theta: 72, from: 560, to: 820, points: 1301, pol: 'p' };
  const fit = newMetric('fit', { ref: 'fit', fit: { comps: [newComponent('baseline'), newComponent('lorentz')], guess: true, run: true } });
  const ms = [newMetric('fwhm', { ref: 'res' }), newMetric('sens', { ref: 'sens' }), newMetric('fom', { ref: 'fom' }), fit, newMetric('custom', { ref: 'f1', expr: 'abs(sens.S) / res.width' }), newMetric('custom', { ref: 'q', expr: 'res.pos / res.width' }), newMetric('custom', { ref: 'bad', expr: 'res.nothing + 1' })];
  const a = analyze(ex, models, it, ms);
  const [res, , fom, fr, f1, q, bad] = a.metrics;
  const ok = Math.abs(f1.values.value - fom.values.fom) < 1e-12 && Math.abs(q.values.value - res.values.q) < 1e-12 && fr.values.r2 > 0.98 && Math.abs(fr.values.L1_x0 - res.values.pos) < 0.05 * res.values.width && !!fr.marks.fit && fr.marks.fit.start.length === fr.marks.fit.fitted.length && !!bad.error;
  // before Fit: only the start model (no fitted curve), its values = the start
  const startOnly = evalMetrics([{ ...fit, fit: { ...fit.fit!, run: false } }], a.xs, a.curves, [], true)[0];
  const okStart = startOnly.marks.fit?.fitted.length === 0 && (startOnly.marks.fit?.start.length ?? 0) > 0 && Number.isFinite(startOnly.values.L1_x0);
  check('fit before Fit: the start model only', okStart, `start L1 x₀ ${startOnly.values.L1_x0?.toFixed(2)} nm, R² of the start ${startOnly.values.r2?.toFixed(3)}`);
  check('fit metric (start and fitted curves) and custom formulas', ok, `fit L1 x₀ ${fr.values.L1_x0.toFixed(2)} nm, Γ ${fr.values.L1_w.toFixed(1)} nm, R² ${fr.values.r2.toFixed(4)}; formula |S|/FWHM ${f1.values.value.toFixed(4)} = FOM ${fom.values.fom.toFixed(4)}; pos/FWHM ${q.values.value.toFixed(2)} = Q; “${bad.error}”`);
}

// ---- Coupled oscillators: a synthetic anticrossing spectrum (on λ, computed in energy) fitted back ----
{
  const xs = linspace(600, 700, 801);
  const truth = { A: -0.03, x1: 648, w1: 9, x2: 652, w2: 7, W: 16, r: 0 };
  const ctx = { energy: true, xref: 650 };
  const ys = xs.map((x) => 1 + COMPONENTS.coupled.f(x, truth, ctx));
  const b = newComponent('baseline');
  const co = newComponent('coupled');
  const m = newMetric('fit', { ref: 'co', fit: { comps: [b, co], guess: true, run: true } });
  const r = evalMetrics([m], xs, ys, [], true)[0];
  const ok = r.values.r2 > 0.999 && Math.abs(r.values.C1_W - truth.W) < 1.5;
  check('coupled-oscillator fit (anticrossing on a λ axis)', ok, `Ω ${r.values.C1_W?.toFixed(2)} nm (truth ${truth.W}), modes ${r.values.C1_x1?.toFixed(1)} / ${r.values.C1_x2?.toFixed(1)} nm, R² ${r.values.r2?.toFixed(5)}${r.error ? `; ${r.error}` : ''}`);
}

// ---- Optimization of the project: variables, objectives, the optimizers on the real evaluation ----
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'ag', label: '', mat: { id: 'Ag' }, d: 35, layers2D: 1 }], exit: { id: 'Water' } };
  const it: Interrogation = { mode: 'theta', lambda: 633, theta: 0, from: 60, to: 80, points: 801, pol: 'p' };
  const metrics = [newMetric('fwhm', { id: 'res', ref: 'res' })];
  const infos = new Map(listParams(s, it, lib).map((p) => [p.key, p]));
  const dx = exposeDefaults(infos.get(paramKey({ kind: 'film', block: 'ag', prop: 'd' }))!);
  const vars = variablesOf([{ ...dx, opt: { on: true, min: 20, max: 80, integer: false } }], s, infos);
  const job: EvalJob = { structure: s, it, metrics, vars, objectives: [newObjective('res', 'R', { goal: 'min', scale: 1 })] };
  const evaluate: Evaluate = async (xs, residuals) => {
    const ev = evaluateCandidates(job, lib, models, xs);
    return { merits: ev.map((e) => e.merit), parts: ev.map((e) => e.parts), residuals: residuals ? ev.map((e) => e.residuals) : undefined };
  };
  const t = new Tracker(evaluate, boxOf(vars));
  const octl: Control = { stopped: () => false, waitIfPaused: async () => {}, report: () => {} };
  await differentialEvolution(t, boxOf(vars), [35], { iterations: 25, population: 12, seed: 2 }, octl);
  const best = evaluateCandidates(job, lib, models, [t.bestX])[0];
  check('optimization (DE): the Ag thickness of zero reflectance at the resonance', best.values[0] < 2e-3 && t.bestX[0] > 40 && t.bestX[0] < 60, `d = ${t.bestX[0].toFixed(2)} nm, R at the dip ${best.values[0].toExponential(2)} (start 35 nm: ${evaluateCandidates(job, lib, models, [[35]])[0].values[0].toFixed(3)}), ${t.evaluations} evaluations`);

  // a target with Levenberg-Marquardt: the resonance moved to 70° by the incident angle's … wavelength (a scan variable)
  const lx = exposeDefaults(infos.get(paramKey({ kind: 'scan', prop: 'lambda' }))!);
  const vl = variablesOf([{ ...lx, opt: { on: true, min: 550, max: 900, integer: false } }], s, infos);
  const jobT: EvalJob = { ...job, vars: vl, objectives: [newObjective('res', 'pos', { goal: 'target', target: 66, scale: 1 })] };
  const tl = new Tracker(async (xs, residuals) => {
    const ev = evaluateCandidates(jobT, lib, models, xs);
    return { merits: ev.map((e) => e.merit), parts: ev.map((e) => e.parts), residuals: residuals ? ev.map((e) => e.residuals) : undefined };
  }, boxOf(vl));
  await levenbergMarquardtBatch(tl, boxOf(vl), [633], { iterations: 40 }, octl);
  const pos = evaluateCandidates(jobT, lib, models, [tl.bestX])[0].values[0];
  check('optimization (LM): a target for the resonance angle through λ', Math.abs(pos - 66) < 0.02, `λ = ${tl.bestX[0].toFixed(2)} nm puts the dip at ${pos.toFixed(3)}° (target 66°)`);

  // a material variable: the index of its candidate
  const mx = exposeDefaults(infos.get(paramKey({ kind: 'film', block: 'ag', prop: 'mat' }))!);
  const vm = variablesOf([{ ...mx, mats: ['Au', 'Ag', 'Al'], opt: { ...mx.opt, on: true } }], s, infos);
  const decoded = valuesAt(vm, [0.2]).concat(valuesAt(vm, [1.7]));
  check('optimization: a material variable', vm[0].integer && vm[0].hi === 2 && vm[0].start === 1 && decoded.map((d) => d[1]).join() === 'Au,Al', `candidates Au, Ag, Al: start index ${vm[0].start}, 0.2 → ${decoded[0][1]}, 1.7 → ${decoded[1][1]}`);
}

// ---- SPR design by layer sequences: the settings → the problem; the best structure applied = the same sensitivity ----
{
  const d = { ...defaultSprDesign(), ga: { population: 16, generations: 6, elite: 0.1, mutation: 0.33, seed: 3 } };
  const p = problemOf(d, lib, models);
  if (typeof p === 'string') check('layer GA problem', false, p);
  else {
    const ga = await runSprGa(p, d.ga, () => {}, { stopped: () => false, tick: async () => {} });
    const best = ga.best!;
    const st = structureOf(p, best.s, d.medium);
    const ex = expand(st, lib, models);
    // the structure computed by the project's analysis: S over a fine scan around the GA's dip
    const th0 = best.ev.a.theta;
    const a = analyze(ex, models, { mode: 'theta', lambda: d.lambda, theta: 0, from: th0 - 3, to: Math.min(89.99, th0 + 6), points: 9001, pol: 'p' }, [newMetric('sens', { dn: d.dn, lo: th0 - 1.5, hi: th0 + 1.5 })]);
    const S = a.metrics[0].values.S;
    check('layer GA: the best structure applied gives the same S', Math.abs(S / best.ev.S - 1) < 0.02 && ex.errors.length === 0, `${describeSpr(p, best.s)}: S ${best.ev.S.toFixed(1)} (GA) vs ${S.toFixed(1)} deg/RIU (project analysis)`);
  }
}

// ---- Projects: a version 1 file (ROIs + one sensitivity, sweep axes) becomes metrics and exposed parameters ----
{
  const v1 = {
    version: 1, name: 'old', materials: [], structure: { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'ag', label: '', mat: { id: 'Ag' }, d: 50, layers2D: 1 }], exit: { id: 'Water' } },
    sim: { mode: 'theta', lambda: 633, theta: 0, from: 60, to: 80, points: 501, pol: 'p', rois: [{ id: 'r0', label: 'ROI 1', lo: null, hi: 75, kind: 'dip' }], sens: { on: true, dn: 0.002, target: { kind: 'exit' } }, field: { on: false, at: 'roi', roi: 0, value: 0, zIn: 300, zOut: 300 }, fit: { roi: 0, comps: [] } },
    sweep: { axes: [{ ref: { kind: 'film', block: 'ag', prop: 'd' }, mode: 'range', from: 40, to: 60, steps: 11, list: '', mats: [] }], inner: 'scan' },
  };
  const p = parseProject(JSON.stringify(v1));
  const film = p?.params.find((x) => x.ref.kind === 'film');
  const ok = !!p && p.version === 2 && p.metrics.length === 2 && p.metrics[1].kind === 'sens' && p.metrics[1].dn === 0.002 && Number.isNaN(p.metrics[0].lo) && p.metrics[0].hi === 75 && p.params.length === 3 && p.params[0].id === 'lambda' && p.params[1].id === 'theta' && !!film && p.sweep.axes[0] === film.id && sweepValues(film, undefined).length === 11 && p.metrics.every((m) => /^\w+$/.test(m.ref));
  const back = p && parseProject(stringifyProject(p));
  // a fit of the first version 2 (sim.fit) becomes a Fit metric
  const v2 = { ...defaultProject(), sim: { ...defaultProject().sim, fit: { lo: 60, hi: 70, comps: [newComponent('lorentz')] } } };
  const p2 = parseProject(JSON.stringify(v2));
  const ok2 = !!p2 && p2.metrics.some((m) => m.kind === 'fit' && m.fit?.comps.length === 1 && m.lo === 60);
  check('projects: version 1 → 2, an old fit → a Fit metric, λ and θ always exposed, NaN bounds through JSON', ok && ok2 && !!back && Number.isNaN(back.metrics[0].lo), p ? `${p.metrics.map((m) => `${m.kind} “${m.label}” (${m.ref})`).join(', ')}; exposed: ${p.params.map((x) => x.name).join(', ')}` : 'not read');
}

// ---- Fit: a Lorentzian (with a baseline) fitted to an SPR dip recovers its FWHM ----
{
  const s: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 48, layers2D: 1 }], exit: { id: 'Water' } };
  const ex = expand(s, lib, models);
  const it: Interrogation = { mode: 'lambda', lambda: 700, theta: 72, from: 560, to: 820, points: 1301, pol: 'p' };
  const a = analyze(ex, models, it, [newMetric('fwhm')]);
  const xs = a.xs;
  const ys = Array.from(a.curves.R);
  const comps = guessSpectrum([newComponent('baseline'), newComponent('lorentz')], xs, ys);
  const fit = fitSpectrum(comps, xs, ys, { energy: false, xref: (xs[0] + xs[xs.length - 1]) / 2 });
  const w = fit.comps[1].params.w.value;
  const x0 = fit.comps[1].params.x0.value;
  const r = a.metrics[0].values;
  check('Lorentz fit of an SPR dip', fit.stats.r2 > 0.98 && Math.abs(x0 - r.pos) < 0.05 * r.width, `x₀ ${x0.toFixed(2)} nm (dip ${r.pos.toFixed(2)}), Γ ${w.toFixed(1)} nm (FWHM ${r.width.toFixed(1)}), R² ${fit.stats.r2.toFixed(4)}`);
}

// ---- Metrics on a Lorentzian dip ----
{
  const x0 = 50.123;
  const w = 2.5;
  const xs = Array.from({ length: 2001 }, (_, i) => i * 0.05);
  const ys = xs.map((x) => 1 - 0.9 / (1 + ((x - x0) / (w / 2)) ** 2));
  const m = extremum(xs, ys, 0, xs.length - 1, 'min');
  const h = halfWidth(xs, ys, 0, xs.length - 1, 'dip', 'absolute', 1 - 0.45);
  check('Lorentzian centre and FWHM', Math.abs(m.x - x0) < 1e-3 && Math.abs(h.width - w) < 1e-3, `centre ${m.x.toFixed(5)}, FWHM ${h.width.toFixed(5)}`);
}

// ---- Optimizers ----
const ctl: Control = { stopped: () => false, waitIfPaused: async () => {}, report: () => {} };
const box = (d: number, lo: number, hi: number, integer = false): Box => ({ lo: Array(d).fill(lo), hi: Array(d).fill(hi), integer: Array(d).fill(integer) });
{
  const rastrigin = (x: number[]) => 10 * x.length + x.reduce((s, v) => s + v * v - 10 * Math.cos(2 * Math.PI * v), 0);
  for (const [name, algo] of [['GA', genetic], ['PSO', particleSwarm], ['DE', differentialEvolution]] as const) {
    const b = box(4, -5.12, 5.12);
    const t = new Tracker(fromScalar(rastrigin), b);
    await algo(t, b, [3, 3, 3, 3], { iterations: 300, population: 40, seed: 5 }, ctl);
    check(`${name} on Rastrigin 4D`, t.best < 3, `best ${e(t.best, 2)} after ${t.evaluations} evaluations`);
  }
  const quad = (x: number[]) => x.reduce((s, v, i) => s + (v - (i + 1)) ** 2, 0);
  const t = new Tracker(fromScalar(quad), box(3, -10, 10, true));
  await differentialEvolution(t, box(3, -10, 10, true), [0, 0, 0], { iterations: 100, population: 20, seed: 3 }, ctl);
  check('DE with integer variables', t.best === 0 && t.bestX.every(Number.isInteger), `best ${t.best} at [${t.bestX.join(', ')}]`);

  // NSGA-II, ZDT1: the front follows f2 = 1 − √f1
  const d = 10;
  const zdt1: Evaluate = async (xs) => {
    const parts = xs.map((x) => {
      const g = 1 + (9 * x.slice(1).reduce((s, v) => s + v, 0)) / (d - 1);
      return [x[0], g * (1 - Math.sqrt(x[0] / g))];
    });
    return { merits: parts.map((q) => q[0] + q[1]), parts };
  };
  const front = await nsga2(new Tracker(zdt1, box(d, 0, 1)), box(d, 0, 1), Array(d).fill(0.5), { iterations: 250, population: 60, seed: 3 }, ctl);
  const err = Math.max(...front.map((q) => Math.abs(q.f[1] - (1 - Math.sqrt(q.f[0])))));
  const f1 = front.map((q) => q.f[0]);
  check('NSGA-II on ZDT1', err < 0.1 && Math.max(...f1) - Math.min(...f1) > 0.9, `${front.length} points, max |f2 − (1 − √f1)| ${e(err, 2)}`);

  // Levenberg-Marquardt on residuals
  const xsData = Array.from({ length: 30 }, (_, i) => i * 0.2);
  const model = (q: number[], x: number) => q[0] * Math.exp(-q[1] * x) + q[2];
  const lmEval: Evaluate = async (xs) => {
    const residuals = xs.map((q) => xsData.map((x) => model(q, x) - model([2, 1.3, 0.5], x)));
    const merits = residuals.map((r) => r.reduce((s, v) => s + v * v, 0));
    return { merits, parts: merits.map((m) => [m]), residuals };
  };
  const tl = new Tracker(lmEval, box(3, 0, 5));
  await levenbergMarquardtBatch(tl, box(3, 0, 5), [1, 0.5, 0], { iterations: 100 }, ctl);
  check('Levenberg-Marquardt', tl.best < 1e-12, `best ${e(tl.best, 2)} at [${tl.bestX.map((v) => v.toFixed(5)).join(', ')}]`);
}

// ---- SPR sensor design by layer sequences (Sebek et al., ACS Omega 8, 20792 (2023)) ----
{
  const SEBEK = { ns: 1.332, dn: 0.005, S633: 578, theta633: 85.0 };
  const ids = ['Ag', 'Au', 'Al', 'Cr', 'SiO2', 'TiO2', 'GeO2', 'MgF2', 'Graphene', 'hBN', 'MoS2', 'WS2'];
  const mats: SprMaterial[] = ids.map((id) => {
    const nn = n(id);
    const mono = lib.get(id)!.monolayer;
    const cls = sprClassOf(nn, mono);
    return { key: `${cls}:${id}`, id, name: id, n: nn, cls, monolayer: mono, lo: cls === 'twoD' ? 1 : 5, hi: cls === 'twoD' ? 50 : 100 };
  });
  const k = (id: string) => ids.indexOf(id);
  const p: SprProblem = {
    lambda: 633, ns: SEBEK.ns, dn: SEBEK.dn, prisms: [{ key: 'CaF2', id: 'CaF2', name: 'CaF2', n: n('CaF2').re }], mats,
    counts: { plasmonic: [1, 3], dielectric: [0, 3], twoD: [0, 4], metal: [0, 1] }, holdCounts: false, maxLayers: 12,
    thetaMin: 40, thetaMax: 89.9, step: 0.1, objective: 'S', maxTheta: 90, single: { on: true, minDepth: 0.4, maxAsym: 1.25, smooth: true }, trace: true,
  };
  const pub: SprStructure = { p: 0, genes: [{ m: k('hBN'), t: 17 }, { m: k('Al'), t: 12 }, { m: k('Ag'), t: 28 }, { m: k('hBN'), t: 17 }] };
  const ev = evaluateSensor(p, pub);
  const ok = ev.ok && ev.S > 380 && ev.S < 620 && Math.abs(ev.a.theta - SEBEK.theta633) < 1.5;
  check('published 633 nm SPR sensor (library data)', ok, ev.ok ? `S ${ev.S.toFixed(1)} °/RIU at ${ev.a.theta.toFixed(2)}° (article ${SEBEK.S633}, ${SEBEK.theta633}°)` : ev.why);
  const quiet = { stopped: () => false, tick: async () => {} };
  const settings = { population: 20, generations: 8, elite: 0.1, mutation: 0.33, seed: 1 };
  const t0 = performance.now();
  const ga = await runSprGa(p, settings, () => {}, quiet);
  const again = await runSprGa(p, settings, () => {}, quiet);
  const monotone = ga.history.every((v, i) => i === 0 || v >= ga.history[i - 1] - 1e-9);
  const same = JSON.stringify(ga.best?.s) === JSON.stringify(again.best?.s);
  check('layer-sequence GA: elitist and reproducible', monotone && same && !!ga.best, `best S ${ga.best?.ev.S.toFixed(1)} °/RIU after ${ga.evaluations} structures (${((performance.now() - t0) / 2000).toFixed(1)} s per run)`);
}

// ---- The examples: literature benchmarks through the whole Simulation (sweep → metrics → dispersion fits) ----
{
  const HC = 1239.84193;
  const example = (prefix: string) => {
    const ex = EXAMPLES.find((x) => x.name.startsWith(prefix));
    if (!ex) throw new Error(`no example “${prefix}”`);
    const p = parseProject(stringifyProject(ex.make()))!; // as the app opens it
    const elib = makeLibrary(p.materials);
    return { p, elib, emodels: modelsOf(elib) };
  };
  // a metric's result on the first curve of its data (metrics of metrics included)
  const resultOf = (r: ReturnType<typeof simulate>, ref: string) => {
    const g = r.groups.find((x) => x.metrics.some((m) => m.ref === ref))!;
    return g.results[0][g.metrics.findIndex((m) => m.ref === ref)];
  };
  const valuesOf = (r: ReturnType<typeof simulate>, curve: number, ref: string) => {
    const g = r.groups.find((x) => x.along === r.data.axes[r.data.axes.length - 1].id)!;
    const k = g.metrics.findIndex((m) => m.ref === ref);
    return g.results[curve][k];
  };

  // Kretschmann: the penetration depth = the evanescent decay at the resonance; the propagation length ≈ half the
  // intrinsic SPP length (critical coupling); the phase of r as a computed quantity = φr
  {
    const { p, elib, emodels } = example('Kretschmann');
    const r = simulate(p, elib, emodels);
    const pen = valuesOf(r, 0, 'pen').values;
    const prop = valuesOf(r, 0, 'prop').values;
    const k0 = (2 * Math.PI) / 633;
    const [np, nw] = [refractiveIndex('BK7', emodels, 633).re, refractiveIndex('Water', emodels, 633).re];
    const depth = 1 / (2 * k0 * Math.sqrt((np * Math.sin((pen.pos * Math.PI) / 180)) ** 2 - nw ** 2));
    const em = CX.mul(refractiveIndex('Ag', emodels, 633), refractiveIndex('Ag', emodels, 633));
    const ed = nw * nw;
    const beta = CX.mul(c(k0), CX.sqrt(CX.div(CX.mul(em, c(ed)), CX.add(em, c(ed)))));
    const Lint = 1 / (2 * beta.im) / 1000;
    const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
    const ph = r.data.fields.phase_r;
    let dph = 0;
    for (let i = 0; i < ph.length; i++) dph = Math.max(dph, Math.abs(wrap(ph[i] - r.data.fields.phiR[i])));
    const ok = Math.abs(pen.depth / depth - 1) < 0.01 && prop.L / Lint > 0.35 && prop.L / Lint < 0.7 && dph < 1e-9;
    check('Kretschmann example: penetration depth, propagation length, the phase as a formula', ok, `1/e depth in water ${pen.depth.toFixed(1)} nm (evanescent decay ${depth.toFixed(1)} nm); L ${prop.L.toFixed(2)} µm (intrinsic SPP ${Lint.toFixed(1)} µm); arg(rRe, rIm) − φr ${e(dph)}°`);

    // the Field metric: at the dip the Ag film absorbs 1 − R (total internal reflection: nothing transmitted into the
    // water, the metric's "absorbed" there = 0); R + every medium's fraction = 1; |E|² enhanced at the interface
    const ex = expand(p.structure, elib, emodels);
    const it = interrogationOf(p.sim);
    const agId = p.structure.blocks[0].id;
    const inAg = fieldStats(ex, emodels, it, pen.pos, { kind: 'block', block: agId });
    const inWater = fieldStats(ex, emodels, it, pen.pos, { kind: 'exit' });
    const R = tmmPoint(stackAt(ex, emodels, it.lambda), it.lambda, pen.pos, it.pol === 's' ? 's' : 'p').R;
    const prof = profileAt(ex, emodels, it, pen.pos, 0, 0);
    const balance = R + prof.layerAbs.reduce((s, v) => s + v, 0);
    const okF = Math.abs(inAg.absorbed - (1 - R)) < 2e-3 && Math.abs(inWater.absorbed) < 1e-6 && Math.abs(balance - 1) < 2e-3 && inAg.E2max > 5 && Math.abs(pen.absorbed - inWater.absorbed) < 1e-9 && Math.abs(pen.E2max - inAg.E2max) / inAg.E2max < 0.02;
    check('the Field metric: absorbed in Ag = 1 − R at the dip, energy balance, |E|² enhancement', okF, `R ${R.toFixed(4)}, absorbed in Ag ${inAg.absorbed.toFixed(4)}, transmitted ${e(inWater.absorbed)}; R + Σ ${balance.toFixed(5)}; largest |E|² ${inAg.E2max.toFixed(1)} (metric: ${pen.E2max.toFixed(1)})`);
  }

  // Lu et al. 2019
  {
    const { p, elib, emodels } = example('Tamm plasmon induced');
    const B = TAMM_LU2019;
    const bare = simulate({ ...p, structure: { ...p.structure, blocks: p.structure.blocks.map((b) => (b.kind === 'dbr' ? { ...b, cavities: [] } : b)) }, sweep: { ...p.sweep, axes: [] }, metrics: [] }, elib, emodels);
    const R0 = bare.data.fields.R;
    const lam = bare.data.axes[0].values;
    const dipEv = HC / lam[argmin(R0)];
    const w0 = (Math.PI * 197.3269804) / (2.2 * 160 + 1.45 * 275);
    const wT = w0 / (1 + (2 * w0 * (2.2 - 1.45)) / (Math.PI * 9.1));
    const r = simulate(p, elib, emodels);
    const nl = lam.length;
    const R = r.data.fields.R;
    let kp = -1;
    for (let i = 1; i < nl - 1; i++) {
      const v = R[4 * nl + i];
      if (v > R[4 * nl + i - 1] && v >= R[4 * nl + i + 1] && v < 0.995 && (kp < 0 || v > R[4 * nl + kp])) kp = i;
    }
    const [k8, k12] = [valuesOf(r, 0, 'co').values, valuesOf(r, 4, 'co').values];
    const ok =
      Math.abs(dipEv - B.tppEv) < 0.002 && Math.abs(wT - B.tppAnalyticEv) < 0.002 && Math.abs(lam[kp] - B.peakNm) < 1 &&
      Math.abs(k8.C1_kappa / B.kappa8 - 1) < 0.02 && Math.abs(k8.C1_kappaT - B.kappaT8) < 0.03 && Math.abs(k12.C1_kappa / B.kappa12 - 1) < 0.05 && k8.r2 > 0.99 && k12.r2 > 0.99;
    check('benchmark Lu et al. 2019 (Tamm induced reflection, coupled-oscillator fit)', ok, `TPP dip ${dipEv.toFixed(4)} eV (paper ${B.tppEv}), analytic ${wT.toFixed(4)} eV (${B.tppAnalyticEv}), peak ${lam[kp].toFixed(2)} nm (${B.peakNm}); M = 8: κ ${k8.C1_kappa.toFixed(2)}, κT ${k8.C1_kappaT.toFixed(2)} (${B.kappa8}, ${B.kappaT8}); M = 12: κ ${k12.C1_kappa.toFixed(2)} (≈ ${B.kappa12}) ×10¹² rad/s`);
  }

  // Jena et al. 2021
  {
    const { p, elib, emodels } = example('Rabi-like');
    const B = RABI_JENA;
    const r = simulate(p, elib, emodels);
    const g = r.groups[0];
    const k = r.data.axes[0].values.indexOf(141);
    const [up, lo] = [HC / g.dataset.fields['b1.pos'][k], HC / g.dataset.fields['b2.pos'][k]];
    const d = resultOf(r, 'disp');
    const ok = Math.abs(up - B.upperEv) < 0.004 && Math.abs(lo - B.lowerEv) < 0.004 && Math.abs(d.values.rabi - B.rabiMeV) < 4 && Math.abs(d.values.crossing - B.anticrossNm) < 2 && d.values.r2 > 0.999;
    check('benchmark Jena et al. 2021 (Tamm–cavity Rabi splitting, dispersion fit)', ok, `ds = 141 nm: ${lo.toFixed(4)} / ${up.toFixed(4)} eV (paper ${B.lowerEv} / ${B.upperEv}); Ω ${d.values.rabi?.toFixed(1)} meV (${B.rabiMeV}), zero detuning ${d.values.crossing?.toFixed(1)} nm (${B.anticrossNm}), R² ${d.values.r2?.toFixed(5)}${d.error ? `; ${d.error}` : ''}`);
  }

  // strong coupling vs thickness and vs angle (the long-λ branch in a region following θ)
  {
    const a = example('Strong coupling: polaritons vs cavity');
    const ra = simulate(a.p, a.elib, a.emodels);
    const da = resultOf(ra, 'disp').values;
    const b = example('Strong coupling: polaritons vs angle');
    const rb = simulate(b.p, b.elib, b.emodels);
    const db = resultOf(rb, 'disp').values;
    const lg = Array.from(rb.groups[0].dataset.fields['lg.pos']);
    // (mode 1 of the fit is the exciton as the cavity sees it: the Lorentz layer's own index dispersion moves it by ≲ 1 %)
    const ok = da.r2 > 0.999 && Math.abs(da.x1 / 652.5 - 1) < 0.01 && da.rabi > 0 && db.r2 > 0.999 && Math.abs(db.x1 / 652.5 - 1) < 0.01 && db.n > 1.3 && db.n < 2.2 && Math.max(...lg) < 685;
    check('strong coupling examples (dispersion vs thickness and vs angle)', ok, `vs d: exciton ${da.x1?.toFixed(1)} nm, Ω ${da.W?.toFixed(1)} nm = ${da.rabi?.toFixed(1)} meV, zero detuning at d = ${da.crossing?.toFixed(1)} nm, R² ${da.r2?.toFixed(5)}; vs θ: exciton ${db.x1?.toFixed(1)} nm, cavity λ₀ ${db.a?.toFixed(1)} nm, n_eff ${db.n?.toFixed(3)}, Ω ${db.rabi?.toFixed(1)} meV, R² ${db.r2?.toFixed(5)}; long-λ branch ${Math.min(...lg).toFixed(1)}–${Math.max(...lg).toFixed(1)} nm`);
  }

  // Sreekanth et al. 2023: the Tamm modes of both phases (Cauchy models calibrated on them)
  {
    const { p, elib, emodels } = example('Tunable Tamm');
    const r = simulate(p, elib, emodels);
    const B = SREEKANTH2023;
    const got = [0, 1].map((i) => [valuesOf(r, i, 'tpp2').values.pos, valuesOf(r, i, 'tpp1').values.pos]);
    const want = [B.amorphous, B.crystalline];
    const ok = got.every((g, i) => g.every((v, j) => Math.abs(v - want[i][j]) < 3));
    check('benchmark Sreekanth et al. 2023 (Sb₂S₃ Tamm modes, amorphous → crystalline)', ok, `amorphous ${got[0].map((v) => v.toFixed(1)).join(' / ')} nm (paper ${B.amorphous.join(' / ')}), crystalline ${got[1].map((v) => v.toFixed(1)).join(' / ')} nm (${B.crystalline.join(' / ')}): shifts ${(got[1][0] - got[0][0]).toFixed(0)} / ${(got[1][1] - got[0][1]).toFixed(0)} nm (153 / 295)`);
  }

  // the fit of several components: two Lorentzians on the two hybrid modes, each part drawn
  {
    const { p, elib, emodels } = example('Fit of several');
    const r = simulate(p, elib, emodels);
    const f = valuesOf(r, 0, 'two');
    const x0 = [f.values.L1_x0, f.values.L2_x0].sort((u, v) => u - v);
    const want = [HC / RABI_JENA.upperEv, HC / RABI_JENA.lowerEv];
    const ok = f.values.r2 > 0.99 && f.marks.fit?.parts?.length === 3 && x0.every((v, i) => Math.abs(v - want[i]) < 2);
    check('example: fit of several components (parts)', ok, `x₀ ${x0.map((v) => v.toFixed(2)).join(' / ')} nm (modes ${want.map((v) => v.toFixed(1)).join(' / ')}), R² ${f.values.r2?.toFixed(4)}, ${f.marks.fit?.parts?.length} parts`);
  }

  // He et al. 2021: the target, the two matches, and Adam in two stages lowering the cost
  {
    const { p, elib, emodels } = example('Inverse design of a Tamm');
    const r = simulate(p, elib, emodels);
    const all = valuesOf(r, 0, 'mAll');
    const tgt = all.marks.fit!;
    const at = (x: number) => tgt.start[tgt.x.reduce((k, v, i) => (Math.abs(v - x) < Math.abs(tgt.x[k] - x) ? i : k), 0)];
    const infos = paramInfos(p, elib);
    const vars = variablesOf(p.params, p.structure, infos);
    const job: EvalJob = { structure: p.structure, it: p.sim, metrics: p.metrics, derived: p.derived, vars, objectives: p.opt.objectives };
    const t = new Tracker(async (xs) => {
      const ev = evaluateCandidates(job, elib, emodels, xs);
      return { merits: ev.map((x) => x.merit), parts: ev.map((x) => x.parts) };
    }, boxOf(vars));
    const quiet: Control = { stopped: () => false, waitIfPaused: async () => {}, report: () => {} };
    const x0 = vars.map((v) => v.start);
    const start = evaluateCandidates(job, elib, emodels, [x0])[0];
    await adam(t, boxOf(vars), x0, { iterations: 40, lr: 0.05, starts: 1, seed: 1, stall: 0, stage1: { iterations: 15, lr: 0.01, mask: [false, true] }, stage2Mask: [true, false] }, quiet);
    const best = evaluateCandidates(job, elib, emodels, [t.bestX])[0];
    const ok = vars.length === 11 && Math.abs(at(4237.29)) < 0.01 && Math.abs(at(3500)) < 0.01 && Math.abs(at(6000) - 1) < 0.01 && best.merit < start.merit;
    check('example He et al. 2021: the target and Adam in two stages', ok, `target ${at(4237.29).toFixed(4)} at 4237 nm, ${at(3500).toFixed(4)} at 3500 nm, ${at(6000).toFixed(4)} at 6000 nm; ${vars.length} variables; cost ${start.parts.map((v) => v.toFixed(4)).join(' + ')} → ${best.parts.map((v) => v.toFixed(4)).join(' + ')} after 40 Adam steps (15 on the resonances)`);
  }

  // the layer GA's fitness of several objectives and of a formula
  {
    const d = { ...defaultSprDesign(), objective: 'multi' as const, terms: [{ q: 'S', goal: 'max' as const, weight: 1 }, { q: 'FWHM', goal: 'min' as const, weight: 0.5 }] };
    const pm = problemOf(d, lib, models);
    const pc = problemOf({ ...d, objective: 'custom', expr: 'S * depth' }, lib, models);
    if (typeof pm === 'string' || typeof pc === 'string') check('layer GA objectives', false, String(pm));
    else {
      const k = (id: string, cls: string) => pm.mats.findIndex((m) => m.id === id && m.cls === cls);
      const s: SprStructure = { p: 0, genes: [{ m: k('Ag', 'plasmonic'), t: 45 }] };
      const [em, ec, es] = [evaluateSensor(pm, s), evaluateSensor(pc, s), evaluateSensor({ ...pm, objective: 'S' }, s)];
      const ok = em.ok && ec.ok && es.ok && Math.abs(em.fitness - es.S / Math.sqrt(es.fwhm)) < 1e-9 * em.fitness && Math.abs(ec.fitness - es.S * es.a.depth) < 1e-9 * ec.fitness && typeof problemOf({ ...d, objective: 'custom', expr: 'S * nothing' }, lib, models) === 'string';
      check('layer GA: several objectives (S / √FWHM) and a formula (S·depth)', ok, em.ok && ec.ok ? `fitness ${em.fitness.toFixed(2)} = S/√FWHM, ${ec.fitness.toFixed(2)} = S·depth; an unknown name refused` : 'not evaluated');
    }
  }
}

// ---- The modular metrics: zones, ROIs drawn as regions, metrics of metrics, dispersion maps, constraints ----
{
  // zones: the mean / min / max / integral of a quantity in each zone, the score
  const xs = linspace(400, 1000, 601);
  const R = xs.map((x) => (x >= 600 && x <= 700 ? 0.9 : 0.1));
  const zm = newMetric('zones', { zones: [newZone({ lo: 600, hi: 700, goal: 'max' }), newZone({ lo: 400, hi: 500, goal: 'min', stat: 'max' }), newZone({ lo: 600, hi: 700, goal: 'max', stat: 'int' })] });
  const zr = evalMetrics([zm], xs, { R }, [], true)[0];
  const okZ = Math.abs(zr.values.z1 - 0.9) < 1e-12 && Math.abs(zr.values.z2 - 0.1) < 1e-12 && Math.abs(zr.values.z3 - 90) < 1e-9 && Math.abs(zr.values.score - (0.9 - 0.1 + 90)) < 1e-9 && zr.marks.zones?.length === 3;
  check('zones metric (mean, max, integral; score)', okZ, `z1 ${zr.values.z1}, z2 ${zr.values.z2}, ∫ ${zr.values.z3?.toFixed(3)}, score ${zr.values.score?.toFixed(3)}`);

  // a region drawn on a map: the ROI on each line through it
  const tri: [number, number][] = [[600, 0], [700, 0], [650, 10]];
  const [a, b] = polyRoi(tri, 5);
  const out = polyRoi(tri, 20);
  // zone points (old projects, examples) as a closed region: its top and bottom edges belong to it
  const zreg = polyOfZone([{ y: 0, lo: 700, hi: 770 }, { y: 1, lo: 850, hi: 920 }]);
  const [t0, t1] = polyRoi(zreg, 1);
  const [m0, m1] = polyRoi(zreg, 0.5);
  const okP = Math.abs(a - 625) < 1e-9 && Math.abs(b - 675) < 1e-9 && out[0] > out[1] && t0 === 850 && t1 === 920 && Math.abs(m0 - 775) < 1e-9 && Math.abs(m1 - 845) < 1e-9 && polyRoi(zreg, 1.5)[0] > polyRoi(zreg, 1.5)[1];
  // outside the region: no value (not the whole curve)
  const outside = evalMetrics([newMetric('fwhm', { follow: { param: 'p', pts: [], poly: zreg } })], xs, { R }, [], true, { p: 2 })[0];
  check('ROI from a polygon (drawn region; zone points as a closed region)', okP && !Number.isFinite(outside.values.width), `triangle at y = 5: ${a}–${b}, outside: empty; zone region at its top ${t0}–${t1}, middle ${m0}–${m1}, beyond: empty`);

  // the zones example: DE raises the score
  const ze = EXAMPLES.find((x) => x.name.startsWith('Zones'))!;
  const zp = parseProject(stringifyProject(ze.make()))!;
  const zinfos = paramInfos(zp, lib);
  const zvars = variablesOf(zp.params, zp.structure, zinfos);
  const zjob: EvalJob = { structure: zp.structure, it: zp.sim, metrics: zp.metrics, derived: zp.derived, vars: zvars, objectives: zp.opt.objectives };
  const zt = new Tracker(async (pts) => {
    const ev = evaluateCandidates(zjob, lib, models, pts);
    return { merits: ev.map((x) => x.merit), parts: ev.map((x) => x.parts) };
  }, boxOf(zvars));
  const zq: Control = { stopped: () => false, waitIfPaused: async () => {}, report: () => {} };
  const z0 = evaluateCandidates(zjob, lib, models, [zvars.map((v) => v.start)])[0];
  await differentialEvolution(zt, boxOf(zvars), zvars.map((v) => v.start), { iterations: 15, population: 16, seed: 1 }, zq);
  const z1 = evaluateCandidates(zjob, lib, models, [zt.bestX])[0];
  check('zones example: DE makes R high in 600–700 nm and low in 400–500 nm', z1.values[0] > z0.values[0] && z1.values[0] > 0.5, `score ${z0.values[0].toFixed(3)} → ${z1.values[0].toFixed(3)} (H ${zt.bestX[0].toFixed(0)} nm, L ${zt.bestX[1].toFixed(0)} nm, N ${zt.bestX[2]})`);

  // a dispersion map = one spectral scan per angle
  const sm = simulateCore({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 48, layers2D: 1 }], exit: { id: 'Water' } }, { ...defaultProject().sim, mode: 'map', from: 550, to: 900, points: 351, tFrom: 66, tTo: 80, tPoints: 8 }, [newMetric('fwhm', { ref: 'res' }), newMetric('max', { ref: 'mx', source: 'metrics:lambda', field: 'res.pos', along: 'theta' })], [], lib, models);
  const one = simulateCore({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 48, layers2D: 1 }], exit: { id: 'Water' } }, { ...defaultProject().sim, mode: 'lambda', theta: 72, from: 550, to: 900, points: 351 }, [], [], lib, models);
  let dmap = 0;
  for (let i = 0; i < 351; i++) dmap = Math.max(dmap, Math.abs(sm.data.fields.R[3 * 351 + i] - one.data.fields.R[i]));
  const posVsTheta = Array.from(sm.groups[0].dataset.fields['res.pos']);
  const mx = sm.groups.find((g) => g.source === 'metrics:lambda')!.results[0][0].values;
  check('dispersion map = spectral scans per angle; a metric of metrics (max of the resonance over θ)', dmap < 1e-14 && Math.abs(mx.R - Math.max(...posVsTheta)) < 1e-9, `|ΔR| ${e(dmap)}; resonance ${posVsTheta[0].toFixed(1)} → ${posVsTheta[7].toFixed(1)} nm over 66–80°, its max ${mx.R.toFixed(1)} nm at ${mx.pos.toFixed(1)}°`);

  // constrained domination: feasible points first, then the smaller violation
  const F = [[1, 1], [0, 0], [2, 2], [0.5, 3]];
  const V = [0, 1, 0, 0.5];
  const rk = paretoRanks(F, V);
  check('NSGA-II constrained domination (Deb)', rk[0] === 0 && rk[2] === 1 && rk[3] === 2 && rk[1] === 3, `ranks ${rk.join(', ')} (the infeasible [0, 0] last)`);

  // old projects: a dispersion metric becomes a dispersion fit of metrics; a θ sweep of a spectral scan, a map
  const old = { ...defaultProject(), sim: { ...defaultProject().sim, mode: 'lambda', from: 560, to: 760, points: 201 }, params: [...defaultProject().params.filter((x) => x.id !== 'theta'), { ...defaultProject().params.find((x) => x.id === 'theta')!, sweep: { mode: 'step', from: 0, to: 40, step: 10, count: 5, list: '', integer: false } }], sweep: { ...defaultProject().sweep, axes: ['theta'] }, metrics: [newMetric('fwhm', { ref: 'a' }), newMetric('fwhm', { ref: 'b' }), { ...newMetric('fit', { ref: 'd' }), kind: 'dispersion', disp: { lower: 'a', upper: 'b', axis: 'theta', model: 'angle', lo: 0, hi: 30 } }] };
  const mig = parseProject(JSON.stringify(old))!;
  const md = mig.metrics[2];
  check('projects: an old dispersion metric → a dispersion fit of metrics; a θ sweep → a dispersion map', md.kind === 'fit' && md.fit?.mode === 'dispersion' && md.field === 'a.pos' && md.along === 'theta' && mig.sim.mode === 'map' && mig.sim.tPoints === 5 && mig.sweep.axes.length === 0, `${md.kind}/${md.fit?.mode} of ${md.field}, ${md.field2} along ${md.along}; mode ${mig.sim.mode} θ ${mig.sim.tFrom}–${mig.sim.tTo} (${mig.sim.tPoints})`);
}

// ---- Sensitivity on a multilayer (the layer GA's structures): the shifted dip = the dip of the direct computation ----
{
  const s: Structure = {
    incident: { id: 'CaF2' },
    blocks: [
      { kind: 'film', id: 'g1', label: '', mat: { id: 'GeO2' }, d: 67, layers2D: 1 },
      { kind: 'film', id: 'a1', label: '', mat: { id: 'Ag' }, d: 27, layers2D: 1 },
      { kind: 'film', id: 'g2', label: '', mat: { id: 'GeO2' }, d: 76, layers2D: 1 },
      { kind: 'film', id: 'a2', label: '', mat: { id: 'Ag' }, d: 25, layers2D: 1 },
    ],
    exit: { id: 'Water' },
  };
  for (const dn of [0.001, 0.01]) {
    const sim = { ...defaultProject().sim, mode: 'theta' as const, lambda: 633, from: 40, to: 85, points: 2001 };
    const r = simulateCore(s, sim, [newMetric('sens', { ref: 'sens', dn })], [], lib, models);
    const v = r.groups[0].results[0][0];
    // direct: the deepest dip with n and with n + Δn of the water
    const th = linspace(40, 85, 2001);
    const ex0 = expand(s, lib, models);
    const R0 = scan(ex0, models, { lambda: [633], theta: th, pol: 'p' }).fields.R;
    const R1 = scan(ex0, models, { lambda: [633], theta: th, pol: 'p', perturb: { targets: [ex0.layers.length + 1], dn } }).fields.R;
    const [p0, p1] = [extremum(th, R0, 0, th.length - 1, 'min').x, extremum(th, R1, 0, th.length - 1, 'min').x];
    // (Δn 0.01: the dip leaves the scan at 85° — no S, an error instead of a ripple taken for the dip)
    const lost = p1 >= 85 - 1e-9;
    const ok = lost ? !Number.isFinite(v.values.S) && !!v.error : Math.abs(v.values.pos - p0) < 0.02 && Math.abs(v.values.shifted - p1) < 0.05 && Math.abs(v.values.S - (p1 - p0) / dn) / Math.abs((p1 - p0) / dn) < 0.03;
    check(`sensitivity on a two-metal multilayer (Δn ${dn})`, ok, lost ? `the dip moves past the scan end (direct minimum at ${p1.toFixed(2)}°): “${v.error}”` : `dip ${v.values.pos.toFixed(3)}° → ${v.values.shifted.toFixed(3)}° (direct ${p0.toFixed(3)}° → ${p1.toFixed(3)}°), S ${v.values.S.toFixed(1)} vs ${((p1 - p0) / dn).toFixed(1)} °/RIU`);
  }
}

// ---- Benchmark: NSGA-II with constraints, Varasteanu & Kusko, Appl. Sci. 11, 4353 (2021) ----
{
  const ex = EXAMPLES.find((x) => x.name.startsWith('NSGA-II with constraints: 2D'))!;
  const p = parseProject(stringifyProject(ex.make()))!;
  const vlib = makeLibrary(p.materials);
  const vmodels = modelsOf(vlib);
  const V = VARASTEANU2021;
  const matOf: Record<string, string> = { graphene: 'user-gr-v', MoS2: 'user-mos2-v', WS2: 'user-ws2-v' };
  const designOf = (d: (typeof V.table2)[number], bto = false): Structure => ({
    ...p.structure,
    blocks: [
      { kind: 'film', id: 'ag', label: '', mat: { id: 'user-ag-v' }, d: d.ag, layers2D: 1 },
      { kind: 'film', id: 'semi', label: '', mat: bto ? { id: 'user-batio3' } : { id: 'user-semi', param: d.n }, d: d.semi, layers2D: 1 },
      { kind: 'film', id: 'twoD', label: '', mat: { id: matOf[d.mat] }, d: 0, layers2D: d.layers },
    ],
  });
  const valuesFor = (st: Structure) => {
    const r = simulateCore(st, p.sim, p.metrics, [], vlib, vmodels);
    const res = r.groups[0].results[0];
    return { S: res[1].values.S, W: res[0].values.width, R: res[0].values.R };
  };
  const rows = [...V.table2.map((d) => ({ d, bto: false, t: 'T2' })), ...V.table4.map((d) => ({ d, bto: false, t: 'T4' })), ...V.table5.map((d) => ({ d, bto: true, t: 'T5' }))].map((x) => ({ ...x, v: valuesFor(designOf(x.d, x.bto)) }));
  const worst = Math.max(...rows.map((x) => Math.abs(x.v.S / x.d.S - 1)));
  const worstW = Math.max(...rows.map((x) => Math.abs(x.v.W - x.d.fwhm)));
  check('Varasteanu 2021: the published designs recomputed (S, FWHM)', worst < 0.06 && worstW < 1, rows.map((x) => `${x.t} ${x.d.mat} ${x.d.ag}–${x.d.semi}–${x.d.layers}L(${x.bto ? 'BTO' : x.d.n}): S ${x.v.S.toFixed(0)}/${x.d.S}, FWHM ${x.v.W.toFixed(2)}/${x.d.fwhm}°, R ${(100 * x.v.R).toFixed(2)} %`).join('; '));

  // a short NSGA-II run with the constraints (graphene): feasible designs reaching the paper's
  const infos = paramInfos(p, vlib);
  const vars = variablesOf(p.params, p.structure, infos);
  const job: EvalJob = { structure: p.structure, it: p.sim, metrics: p.metrics, derived: p.derived, vars, objectives: p.opt.objectives.map((o) => (o.scale > 0 ? o : { ...o, scale: o.role === 'constraint' ? Math.abs(o.target) || 1 : o.key === 'S' ? 300 : 7 })) };
  const t = new Tracker(async (xs) => {
    const ev = evaluateCandidates(job, vlib, vmodels, xs);
    return { merits: ev.map((x) => x.merit), parts: ev.map((x) => x.parts), violations: ev.map((x) => x.violation) };
  }, boxOf(vars));
  const quiet: Control = { stopped: () => false, waitIfPaused: async () => {}, report: () => {} };
  const t0 = performance.now();
  const front = await nsga2(t, boxOf(vars), vars.map((v) => v.start), { iterations: 40, population: 60, seed: 3 }, quiet);
  const evs = evaluateCandidates(job, vlib, vmodels, front.map((f) => f.x));
  const feas = evs.map((ev, i) => ({ ev, x: front[i].x })).filter((q) => q.ev.violation === 0);
  const best = feas.reduce((a, b) => (b.ev.values[0] > a.ev.values[0] ? b : a), feas[0]);
  const T4 = V.table4[0];
  const ok = feas.length > 0 && feas.every((q) => q.ev.values[0] >= 200 && q.ev.values[1] <= 10 && q.ev.values[2] <= 0.01) && best.ev.values[0] >= 0.97 * T4.S;
  check('Varasteanu 2021: NSGA-II with the constraints (S > 200, FWHM < 10°, R < 1 %)', ok, best ? `${feas.length}/${front.length} front points feasible; the most sensitive: Ag ${best.x[0]} nm, semiconductor ${best.x[1]} nm (n ${best.x[2].toFixed(2)}), ${best.x[3]} L: S ${best.ev.values[0].toFixed(0)} deg/RIU, FWHM ${best.ev.values[1].toFixed(2)}°, R ${(100 * best.ev.values[2]).toFixed(2)} % (paper, Table 4: ${T4.S}, ${T4.fwhm}°); ${t.evaluations} evaluations in ${((performance.now() - t0) / 1000).toFixed(0)} s` : 'no feasible point');
}

// Configurations: each keeps its own structure, interrogation, metrics, plots; the current one is the edited fields
{
  const thick = (p: { structure: Structure }) => (p.structure.blocks[0] as { d: number }).d;
  let p = parseProject(stringifyProject(defaultProject()))!;
  const one = p.configs.length === 1 && p.configId === p.configs[0].id;
  p = addConfig(p, 'copy');
  const copyId = p.configId;
  p = { ...p, structure: { ...p.structure, blocks: [{ ...(p.structure.blocks[0] as object), d: 30 } as Structure['blocks'][number]] }, sim: { ...p.sim, mode: 'lambda' as const, theta: 60 } };
  p = renameConfig(p, copyId, 'SPR at 60°');
  const first = p.configs[0].id;
  const q = switchConfig(p, first);
  const back = switchConfig(q, copyId);
  // a file: written and read again, the current one kept
  const r = parseProject(stringifyProject(back))!;
  const rFirst = switchConfig(r, first);
  const removed = removeConfig(r, copyId);
  const fresh = addConfig(r, 'new');
  // an older project: no configurations, one made of its fields
  const { configs: _c, configId: _i, ...old } = defaultProject();
  void _c;
  void _i;
  const o = parseProject(JSON.stringify(old))!;
  const ok =
    one &&
    thick(q) === 50 && q.sim.mode === 'theta' &&
    thick(back) === 30 && back.sim.mode === 'lambda' && back.sim.theta === 60 &&
    r.configs.length === 2 && r.configId === copyId && thick(r) === 30 && configsOf(r)[1].name === 'SPR at 60°' &&
    thick(rFirst) === 50 &&
    removed.configs.length === 1 && removed.configId === first && thick(removed) === 50 &&
    fresh.configs.length === 3 && fresh.configId !== copyId && fresh.configs[2].id === fresh.configId &&
    o.configs.length === 1 && thick(o) === 50;
  check('configurations: switch, file round trip, duplicate / new / remove, older projects', ok, `copy ${thick(back)} nm spectral at ${back.sim.theta}°, first ${thick(q)} nm angular; after a file: ${r.configs.map((c) => c.name).join(', ')} (current ${r.configs.find((c) => c.id === r.configId)?.name}); removed → ${removed.configs.length}; new → ${fresh.configs.length}; older → ${o.configs.length}`);
}
// The compare example: two configurations, each simulated with its own structure, interrogation and metrics
{
  const ex = EXAMPLES.find((e) => e.name.startsWith('Compare: a Tamm plasmon'))!;
  const p = parseProject(stringifyProject(ex.make()))!;
  const libC = makeLibrary(p.materials);
  const modelsC = modelsOf(libC);
  const dip = (q: typeof p, ref: string) => {
    const r = simulate(q, libC, modelsC);
    const g = r.groups.find((x) => x.source === 'response')!;
    return g.results[0][g.metrics.findIndex((m) => m.ref === ref)]?.values.pos ?? NaN;
  };
  const tamm = dip(p, 'tamm');
  const sprP = switchConfig(p, 'spr');
  const spr = dip(sprP, 'res');
  const cmp = p.compare.plots.find((x) => x.source === 'compare');
  const ok = p.configs.length === 2 && p.configId === 'tamm' && sprP.sim.mode === 'lambda' && sprP.sim.theta === 68 && tamm > 560 && tamm < 760 && Math.abs(spr - 622.5) < 2 && !!cmp && cmp.curves!.map((c) => c.config).join() === 'tamm,spr';
  check('compare example: two configurations, each its own dip (Tamm at 0°, SPR at 68°), a compare plot of both', ok, `Tamm mode ${tamm.toFixed(1)} nm, SPR dip ${spr.toFixed(1)} nm; compare curves: ${cmp?.curves?.map((c) => `${c.config}:${c.y}`).join(', ')}`);
}
// Compare plots of the first version (inside a configuration): moved to the project's Compare page; the record of an
// applied optimization (each variable before → after, each goal at the start and at the end, a constraint met or not)
{
  const base = defaultProject();
  const withCmp = { ...base, sweep: { ...base.sweep, plots: [{ ...base.sweep.plots[0], id: 'cmpOld', source: 'compare', curves: [] }] } };
  const q = parseProject(stringifyProject(withCmp as typeof base))!;
  const moved = q.compare.plots.length === 1 && q.compare.plots[0].id === 'cmpOld' && q.sweep.plots.length === 1 && q.sweep.plots[0].source === 'response';
  const vars = [
    { id: 'd', name: 'Ag thickness', ref: { kind: 'film', block: 'ag', prop: 'd' } as const, lo: 30, hi: 70, integer: false, start: 50, unit: 'nm' },
    { id: 'm', name: 'Prism', ref: { kind: 'medium', which: 'incident', prop: 'mat' } as const, lo: 0, hi: 1, integer: true, mats: ['BK7', 'SF10'], start: 0, unit: '' },
  ];
  const oS = newObjective('sens', 'S', { goal: 'max' });
  const oW = newObjective('res', 'width', { role: 'constraint', goal: 'le', target: 5, scale: 1 });
  const rec = optRecordOf('Differential evolution', vars, [43.21234, 1], [
    { o: oS, label: 'S', unit: '°/RIU', start: 110, end: 140 },
    { o: oW, label: 'FWHM', unit: '°', start: 4.5, end: 6 },
  ], (id) => (id === 'SF10' ? 'SF10 glass' : id));
  const okRec = rec.vars[0].from === 50 && rec.vars[0].to === 43.2123 && rec.vars[1].from === 'BK7' && rec.vars[1].to === 'SF10 glass' && rec.goals[0].role === 'objective' && rec.goals[0].end === 140 && rec.goals[1].role === 'constraint' && rec.goals[1].met === false && !!Date.parse(rec.date);
  check('compare plots moved to the project; the record of an applied optimization', moved && okRec, `moved ${moved}; Ag ${rec.vars[0].from} → ${rec.vars[0].to} nm, prism ${rec.vars[1].from} → ${rec.vars[1].to}; FWHM ≤ 5: ${rec.goals[1].end} (met ${rec.goals[1].met})`);
}
// An example added as a configuration of the open project: nothing replaced, the example's configurations (fresh ids)
// and compare plots (on them), its materials (one whose id is taken by a different material renamed, in its configs)
{
  const ex = (name: string) => EXAMPLES.find((e) => e.name.startsWith(name))!.make();
  const k = parseProject(stringifyProject(ex('Kretschmann')))!;
  const a = addConfigsFrom(k, ex('Tamm plasmon'), 'Tamm plasmon');
  const tammHere = a.configs.length === 2 && a.configId !== k.configId && a.structure.blocks.some((b) => b.kind === 'dbr') && a.configs.find((c) => c.id === a.configId)!.name === 'Tamm plasmon';
  const kept = switchConfig(a, k.configId);
  const keptOk = kept.structure.blocks.length === 1 && kept.structure.exit.id === 'Water' && kept.name === k.name;
  const b = addConfigsFrom(a, ex('Compare'));
  const newIds = b.configs.map((c) => c.id).slice(2);
  const cmp = b.compare.plots.at(-1);
  const plotsOk = b.configs.length === 4 && !!cmp && cmp.curves!.every((c) => newIds.includes(c.config));
  // a clash: the project's own "Mine" differs from the example's "Mine"
  const mine = { id: 'mine', name: 'Mine', color: '#888888', model: { type: 'constant' as const, n: 1.5, k: 0 } };
  const theirs = { ...k, materials: [{ ...mine, model: { type: 'constant' as const, n: 2.1, k: 0 } }], structure: { ...k.structure, blocks: [{ kind: 'film' as const, id: 'f', label: '', mat: { id: 'mine' }, d: 10, layers2D: 1 }] } };
  const c = addConfigsFrom({ ...k, materials: [mine] }, theirs, 'Theirs');
  const clashOk = c.materials.length === 2 && c.materials[1].id === 'mine-2' && (c.structure.blocks[0] as { mat: { id: string } }).mat.id === 'mine-2' && switchConfig(c, k.configId).materials[0].id === 'mine';
  check('an example added as a configuration (nothing replaced; its compare plots; a material clash renamed)', tammHere && keptOk && plotsOk && clashOk, `Tamm added ${tammHere}, Kretschmann kept ${keptOk}; compare example → ${b.configs.length} configurations, its plot on them ${plotsOk}; clash → ${c.materials.map((m) => m.id).join(', ')}`);
}
// Ranking the solutions of a front: max S with min R, a filter R <= 0.1; the methods differ as they should (the ideal
// point prefers the balanced A; the weighted sum the slightly better B; lexicographic the largest S first)
{
  const vals = [
    [300, 0.01], // A
    [250, 0.001], // B
    [200, 0.0005], // C
    [310, 0.02], // D
    [100, 0.5], // E: filtered out
  ];
  const crit = [{ q: 0, goal: 'max' as const, weight: 1 }, { q: 1, goal: 'min' as const, weight: 1 }];
  const filt = [{ q: 1, op: 'le' as const, value: 0.1 }];
  const ideal = rankSolutions(vals, crit, filt, 'ideal');
  const sum = rankSolutions(vals, crit, filt, 'sum');
  const lex = rankSolutions(vals, crit, filt, 'lex');
  const none = rankSolutions(vals, [], filt, 'ideal');
  const ok = ideal.order.slice(0, 2).join() === '0,1' && Math.abs(ideal.score[0] - 0.3503) < 1e-3 && sum.order.slice(0, 2).join() === '1,0' && lex.order.join() === '3,0,1,2' && Number.isNaN(ideal.score[4]) && !ideal.order.includes(4) && none.order.join() === '0,1,2,3';
  check('ranking a front: ideal point, weighted sum, lexicographic, a filter', ok, `ideal ${ideal.order.map((i) => 'ABCDE'[i]).join('')} (A ${ideal.score[0].toFixed(4)}), sum ${sum.order.map((i) => 'ABCDE'[i]).join('')}, lex ${lex.order.map((i) => 'ABCDE'[i]).join('')}`);
}
// The Compare page's views (one configuration each): kept in files, remapped when an example is added
{
  const ex = EXAMPLES.find((e) => e.name.startsWith('Compare'))!.make();
  const withViews = { ...ex, compare: { ...ex.compare, views: [{ ...ex.sweep.plots[0], id: 'v1', source: 'field', config: 'spr' }] } };
  const p = parseProject(stringifyProject(withViews))!;
  const kept = p.compare.views?.length === 1 && p.compare.views[0].config === 'spr' && p.compare.views[0].source === 'field';
  const k = parseProject(stringifyProject(EXAMPLES.find((e) => e.name.startsWith('Kretschmann'))!.make()))!;
  const added = addConfigsFrom(k, withViews);
  const v = added.compare.views?.at(-1);
  const remapped = !!v && v.config !== 'spr' && added.configs.some((c) => c.id === v.config && c.name === 'SPR at 68°');
  check('Compare views: kept in a file, remapped with an added example', kept && remapped, `kept ${kept}; remapped to ${v?.config}`);
}
// The Goos–Hänchen shift: (1) Artmann's exact result for total internal reflection (BK7 | water, TE and TM):
// GH·(n₁... ) = sinθ/(π√(sin²θ − n²)) (TE), × n²/((1+n²)sin²θ − n²) (TM); (2) Han et al. 2020 (Au–ITO–graphene): the
// dips, the signs of the GH shift and its ratios between the structures
{
  const libT = makeLibrary([]);
  const modelsT = modelsOf(libT);
  const n1 = refractiveIndex('BK7', modelsT, 633).re;
  const nn = refractiveIndex('Water', modelsT, 633).re / n1;
  const base = defaultProject();
  let worst = 0;
  const rows: string[] = [];
  for (const pol of ['s', 'p'] as const) {
    const p = { ...base, structure: { incident: { id: 'BK7' }, blocks: [], exit: { id: 'Water' } }, sim: { ...base.sim, mode: 'theta' as const, lambda: 633, from: 64, to: 84, points: 2001, pol }, metrics: [] };
    const r = simulate(p, libT, modelsT);
    const xs = r.data.axes[r.data.axes.length - 1].values;
    for (const th of [66, 70, 75, 80]) {
      const i = xs.findIndex((x) => Math.abs(x - th) < 1e-9);
      const s = Math.sin((th * Math.PI) / 180);
      let a = s / Math.sqrt(s * s - nn * nn) / Math.PI;
      if (pol === 'p') a *= (nn * nn) / ((1 + nn * nn) * s * s - nn * nn);
      worst = Math.max(worst, Math.abs(r.data.fields.gh[i] / a - 1));
      if (th === 70) rows.push(`${pol === 's' ? 'TE' : 'TM'} 70°: ${r.data.fields.gh[i].toFixed(4)} vs ${a.toFixed(4)}`);
    }
  }
  check('Goos–Hänchen shift = Artmann (total internal reflection, TE and TM)', worst < 1e-3, `${rows.join(', ')}; worst ${e(worst)}`);

  const ex = EXAMPLES.find((x) => x.name.startsWith('Goos–Hänchen'))!;
  const p0 = parseProject(stringifyProject(ex.make()))!;
  const libH = makeLibrary(p0.materials);
  const modelsH = modelsOf(libH);
  const val = (r: ReturnType<typeof simulate>, curve: number, ref: string, key: string) => {
    const g = r.groups.find((x) => x.source === 'response' && x.along === 'theta')!;
    return g.results[curve][g.metrics.findIndex((m) => m.ref === ref)]?.values[key] ?? NaN;
  };
  const r0 = simulate(p0, libH, modelsH);
  const rG = simulate(switchConfig(p0, 'graphene'), libH, modelsH);
  const gh = [val(r0, 0, 'gh', 'gh'), ...[0, 1, 2, 3, 4].map((k) => val(rG, k, 'gh', 'gh'))];
  const paper = [51.95, 63.89, 89.06, 168.5, -241.2, -134.7];
  const ratios = [1, 2, 3, 5].map((N) => gh[N] / gh[0] / (paper[N] / paper[0]) - 1);
  const dips = [
    [val(r0, 0, 'res', 'pos'), 59.47, val(r0, 0, 'res', 'R'), 0.0313],
    [val(rG, 0, 'res', 'pos'), 59.83, val(rG, 0, 'res', 'R'), 0.0154],
    [val(rG, 3, 'res', 'pos'), 61.01, val(rG, 3, 'res', 'R'), 1.98e-6],
  ];
  const dipsOk = dips.every(([x, xp, R, Rp]) => Math.abs(x - xp) < 0.02 && Math.abs(R / Rp - 1) < 0.03);
  const signsOk = gh.every((g, N) => (paper[N] > 0 ? g > 0 : g < 0));
  const ratiosOk = ratios.every((d) => Math.abs(d) < 0.005);
  const D = val(r0, 0, 'gh', 'D');
  // the GH sensitivity of Au–ITO (Δn 0.002): the paper's largest ΔGH 5.47 λ, with the paper's normalization (its GH / ours)
  const scale = paper[0] / gh[0];
  const dGH = Math.abs(val(r0, 0, 'gh', 'Sgh') * 0.002 * scale);
  const extras = Number.isFinite(D) && Math.abs(D - (gh[0] * 632.8) / 1.7786 / 1000) < 1e-9 && Math.abs(dGH / 5.47 - 1) < 0.05 && Number.isFinite(val(r0, 0, 'ph', 'Sphi'));
  check(
    'Han 2020 (Au–ITO–graphene): the dips, the signs of the GH shift, its ratios between the structures',
    dipsOk && signsOk && ratiosOk && extras,
    `dips ${dips.map(([x, , R]) => `${x.toFixed(2)}° R ${R.toExponential(2)}`).join(', ')}; GH ${gh.map((g) => g.toFixed(2)).join(', ')} λ; ratios vs the paper ${ratios.map((d) => `${(100 * d).toFixed(2)} %`).join(', ')}; D ${D.toFixed(2)} µm, ΔGH/Δn ${val(r0, 0, 'gh', 'Sgh').toFixed(0)} λ/RIU (largest ΔGH, normalized as the paper: ${dGH.toFixed(2)} λ vs 5.47), Δφ/Δn ${val(r0, 0, 'ph', 'Sphi').toFixed(0)} °/RIU`,
  );
}
{
  // tolerances: the jitter of the structure, the samples (seeded, limited, relative), the statistics, the rows
  const p = defaultProject();
  const film = p.structure.blocks.find((b) => b.kind === 'film')!;
  const d0 = expand(p.structure, lib, models).layers.find((L) => L.block === film.id)!.d;
  const j1 = expand({ ...p.structure, blocks: p.structure.blocks.map((b) => (b.id === film.id ? { ...b, jitter: { d: [2], dn: [0.01] } } : b)) }, lib, models).layers.find((L) => L.block === film.id)!;
  const m3 = dbr({ id: 'm', periods: 3, mirrorAfterCavity: false, period: [{ label: 'H', mat: { id: 'H' }, mode: 'nm', d: 60, layers2D: 1 }, { label: 'L', mat: { id: 'L' }, mode: 'nm', d: 100, layers2D: 1 }] });
  const sD: Structure = { incident: { id: 'S' }, blocks: [m3], exit: { id: 'S' } };
  const vH = (mode: 'independent' | 'systematic') => newVariation({ place: 'm', part: 'p1', what: 'd', dist: 'gauss', amount: 3, mode });
  const layersOfS = (st: Structure) => expand(st, clib, cmodels).layers.map((L) => +L.d.toFixed(9));
  const [, sys] = tolSamples(sD, clib, cmodels, { variations: [vH('systematic')], samples: 1, seed: 7 });
  const [, ind] = tolSamples(sD, clib, cmodels, { variations: [vH('independent')], samples: 1, seed: 7 });
  const ls = layersOfS(sys.structure);
  const li = layersOfS(ind.structure);
  const sysOk = ls.filter((_, i) => i % 2 === 0).every((d) => d === 60) && new Set(ls.filter((_, i) => i % 2 === 1)).size === 1 && ls[1] !== 100;
  const indOk = li.filter((_, i) => i % 2 === 0).every((d) => d === 60) && new Set(li.filter((_, i) => i % 2 === 1)).size === 3;
  const a = tolSamples(p.structure, lib, models, { variations: [newVariation({ place: film.id, amount: 2 })], samples: 50, seed: 3 });
  const b = tolSamples(p.structure, lib, models, { variations: [newVariation({ place: film.id, amount: 2 })], samples: 50, seed: 3 });
  const same = JSON.stringify(a.map((x) => x.dev)) === JSON.stringify(b.map((x) => x.dev)) && a[0].dev[0] === 0 && a[0].structure === p.structure;
  const lim = tolSamples(p.structure, lib, models, { variations: [newVariation({ place: film.id, dist: 'uniform', amount: 5, limit: 1 })], samples: 300, seed: 1 });
  const limOk = lim.slice(1).every((x) => Math.abs(x.dev[0]) <= 1 + 1e-12) && lim.slice(1).some((x) => Math.abs(x.dev[0]) === 1);
  const g = tolSamples(p.structure, lib, models, { variations: [newVariation({ place: film.id, amount: 2 })], samples: 4000, seed: 11 });
  const gs = statsOf(g.slice(1).map((x) => x.dev[0]));
  const rel = tolSamples(p.structure, lib, models, { variations: [newVariation({ place: film.id, dist: 'uniform', amount: 10, relative: true })], samples: 300, seed: 1 });
  const relMax = Math.max(...rel.slice(1).map((x) => Math.abs(x.dev[0])));
  const st = statsOf(Array.from({ length: 100 }, (_, i) => i + 1));
  const statsOk = st.median === 50.5 && Math.abs(st.p5 - 5.95) < 1e-12 && Math.abs(st.p95 - 95.05) < 1e-12 && Math.abs(st.std - 29.011491975882016) < 1e-9;
  check(
    'Tolerances: jitter, seeded samples (independent / systematic, limited, relative), statistics',
    j1.d === d0 + 2 && j1.mat.dn === 0.01 && sysOk && indOk && same && limOk && Math.abs(gs.std / 2 - 1) < 0.05 && Math.abs(gs.mean) < 0.1 && relMax <= 0.1 * d0 + 1e-9 && relMax > 0.09 * d0 && statsOk,
    `film ${d0} → ${j1.d} nm, dn ${j1.mat.dn}; DBR L layers systematic ${ls.filter((_, i) => i % 2 === 1).join('/')}, independent ${li.filter((_, i) => i % 2 === 1).join('/')}; gaussian σ 2 → ${gs.std.toFixed(3)} (mean ${gs.mean.toFixed(3)}); uniform ±5 limited to 1; ±10 % of ${d0} nm → max ${relMax.toFixed(2)} nm; P5 ${st.p5}, median ${st.median}, σ ${st.std.toFixed(3)}`,
  );

  // the rows: the nominal row = the Simulation's values; a shift of the exit medium's index moves the dip by S·Δn
  const it = interrogationOf(p.sim);
  const sens = p.metrics.find((m) => m.kind === 'sens' && m.on);
  const dip = p.metrics.find((m) => m.kind === 'fwhm' && m.on)!;
  const vEx = newVariation({ place: 'exit', what: 'n', dist: 'uniform', amount: 0.001, mode: 'systematic' });
  const smp = tolSamples(p.structure, lib, models, { variations: [vEx], samples: 3, seed: 5 });
  const rows = toleranceRows(smp.map((x) => x.structure), it, p.metrics, p.derived, ['R', 'T'], lib, models);
  const ref = simulateCore(p.structure, it, p.metrics, p.derived, lib, models);
  const j = p.metrics.indexOf(dip);
  const pos0 = rows.rows[0].values[j]!.pos;
  const refPos = ref.groups[0].results[0][j]?.values.pos;
  const S = sens ? rows.rows[0].values[p.metrics.indexOf(sens)]!.S : NaN;
  const errs = smp.slice(1).map((x, k) => {
    const shift = rows.rows[k + 1].values[j]!.pos - pos0;
    return Math.abs(shift - S * x.dev[0]) / Math.abs(S * x.dev[0]);
  });
  check(
    'Tolerances: the rows (nominal = the Simulation; a systematic Δn of the analyte moves the dip by S·Δn)',
    pos0 === refPos && rows.xs.length === Math.min(2000, it.points) && !!rows.rows[0].fields.T && errs.every((x) => x < 0.05),
    `dip ${pos0.toFixed(4)} (Simulation ${refPos?.toFixed(4)}); S ${S.toFixed(1)}; the shifts vs S·Δn: ${errs.map((x) => `${(100 * x).toFixed(2)} %`).join(', ')}`,
  );
}
// ---- Sensorgrams (after spr-forge's check-tmm): the rate equations against their analytic solutions; the sensorgram
// against direct transfer-matrix computations; benchmarks: Jung et al., Langmuir 14, 5636 (1998) (the response to an
// adlayer R = m Δn [1 − exp(−2d/l_d)], l_d = 368 nm for Cr 1 nm / Au 50 nm at 825 nm, m = 107°/RIU), the Biacore
// calibration (1000 RU ≈ 1 ng/mm² of protein ≈ 0.1°), Wasilewska et al., IJERPH 18, 4944 (2021) (myoglobin on silica) ----
{
  const P0: KineticParams = { model: 'langmuir', ka: 1e5, kd: 1e-3, rmax: 1000, kt: 1e9, ka2: 0, kd2: 0, rmax2: 0, tau: 10, drift: 0 };
  const C = 50e-9;
  const prot = [{ label: 'a', t: 300, c: C }, { label: 'd', t: 600, c: 0 }];
  // 1:1: association Req (1 − e^(−kobs t)), dissociation e^(−kd t)
  const r1 = kinSimulate(P0, prot, 1);
  const kobs = P0.ka * C + P0.kd;
  const Req = (P0.ka * C * P0.rmax) / kobs;
  const ana = r1.t.map((t) => (t <= 300 ? Req * (1 - Math.exp(-kobs * t)) : Req * (1 - Math.exp(-kobs * 300)) * Math.exp(-P0.kd * (t - 300))));
  const eL = Math.max(...r1.R.map((v, i) => Math.abs(v - ana[i]))) / Req;
  // mass transport: kt → ∞ is 1:1; transport-limited start: dR/dt = kt C
  const rT = kinSimulate({ ...P0, model: 'transport', kt: 1e16 }, prot, 1);
  const eT = Math.max(...rT.R.map((v, i) => Math.abs(v - r1.R[i]))) / Req;
  const lim = kinSimulate({ ...P0, model: 'transport', ka: 1e9, kd: 0, rmax: 1e6, kt: 1e8 }, [{ label: 'a', t: 10, c: 1e-8 }], 1);
  const eLim = Math.abs(lim.R[lim.R.length - 1] / 10 - 1);
  // heterogeneous = two 1:1 sites; two-state without the change and bivalent without the second step = 1:1; regeneration;
  // swelling s∞(1 − e^(−t/τ))
  const h = kinSimulate({ ...P0, model: 'hetero', ka2: 3e4, kd2: 5e-3, rmax2: 400 }, prot, 1);
  const s2 = kinSimulate({ ...P0, ka: 3e4, kd: 5e-3, rmax: 400 }, prot, 1).R;
  const eH = Math.max(...h.R.map((v, i) => Math.abs(v - r1.R[i] - s2[i])));
  const eTS = Math.max(...kinSimulate({ ...P0, model: 'twostate' }, prot, 1).R.map((v, i) => Math.abs(v - r1.R[i])));
  const biv = kinSimulate({ ...P0, model: 'bivalent' }, prot, 1).R;
  const eB = Math.max(...kinSimulate({ ...P0, ka: 2e5 }, prot, 1).R.map((v, i) => Math.abs(v - biv[i])));
  const rg = kinSimulate(P0, [{ label: 'a', t: 100, c: C }, { label: 'r', t: 50, c: 0, regen: true }], 1);
  const okRegen = rg.R[99] > 100 && rg.R[100] === 0;
  const sw = kinSimulate({ ...P0, model: 'swelling', tau: 20 }, [{ label: 's', t: 100, c: 0, swell: 0.8 }], 1);
  const eS = Math.max(...sw.s.map((v, i) => Math.abs(v - 0.8 * (1 - Math.exp(-sw.t[i] / 20)))));
  check(
    'Sensorgram: binding kinetics vs analytic',
    eL < 1e-8 && eT < 1e-6 && eLim < 0.01 && eH < 1e-9 && eTS < 1e-9 && eB < 1e-9 && okRegen && eS < 1e-7,
    `1:1 ${e(eL)}, kt → ∞ = 1:1 (${e(eT)}), transport-limited start kt·C (${(100 * eLim).toFixed(2)} %), heterogeneous = two sites (${e(eH)}), two-state / bivalent limits = 1:1, regeneration ${okRegen}, swelling ${e(eS)}`,
  );

  // a sensorgram computed as on the page: kinetics, plan, the reflectance of every pair, calibration, read-out
  const chip = (cr = false): Structure => ({ incident: { id: 'BK7' }, blocks: [...(cr ? [{ kind: 'film' as const, id: 'cr', label: 'Cr', mat: { id: 'Cr' }, d: 1, layers2D: 1 }] : []), { kind: 'film', id: 'au', label: 'Au', mat: { id: 'Au' }, d: 50, layers2D: 1 }], exit: { id: 'Water' } });
  const scanIt = (lam: number, from: number, to: number, step: number): Interrogation => ({ mode: 'theta', lambda: lam, theta: 0, from, to, points: Math.round((to - from) / step) + 1, pol: 'p' });
  const custom = { analyte: 'custom', mw: 150000, dndc: 0.188, rho: 1.35, dims: [5, 5, 5] as [number, number, number] };
  const runSg = (structure: Structure, it: Interrogation, over: Partial<SgSettings>) => {
    const sg: SgSettings = { ...defaultSg(), ...over, inst: { ...defaultSg().inst, ...over.inst } };
    const kin = kineticsOf(sg);
    const pr = sgPlan(structure, it, sg, kin, lib, models);
    if (!pr.plan) throw new Error(`sensorgram: ${pr.errors.join(' ')}`);
    const ex = expand(structure, lib, models);
    const pairs = Array.from({ length: pr.plan.nK * pr.plan.nT }, (_, i) => i);
    const ch = sgCompute(ex, models, pr.plan, pairs);
    const cal = sgCalibrate(ex, models, pr.plan);
    const warnings = [...kin.warnings, ...pr.warnings];
    const res: SgResult = sgFinish(sg, kin, pr.plan, pr.tIdx, ch.R, ch, cal, warnings);
    return { res, kin, plan: pr.plan, warnings };
  };
  const wl = (lam: number, dn: number, cr = false): Layer[] => [
    { n: refractiveIndex('BK7', models, lam), d: 0 },
    ...(cr ? [{ n: refractiveIndex('Cr', models, lam), d: 1 }] : []),
    { n: refractiveIndex('Au', models, lam), d: 50 },
    { n: c(refractiveIndex('Water', models, lam).re + dn, refractiveIndex('Water', models, lam).im), d: 0 },
  ];
  const goldenDip = (ls: Layer[], lam: number, a: number, b: number) => {
    const g = (Math.sqrt(5) - 1) / 2;
    const f = (t: number) => tmmPoint(ls, lam, t, 'p').R;
    for (let it = 0; it < 80; it++) {
      const [x1, x2] = [b - g * (b - a), a + g * (b - a)];
      if (f(x1) < f(x2)) b = x2;
      else a = x1;
    }
    return (a + b) / 2;
  };
  const last = (a: ArrayLike<number>) => a[a.length - 1];
  // Γ = 0: the exact dip of the bare chip; bulk only (nothing binds): the dip of water + Δn
  const cB = 2000;
  const bulkRun = runSg(chip(), scanIt(633, 68, 76, 0.1), { ...custom, ka: 0, steps: [{ label: 'buffer', t: 10, c: 0 }, { label: 'injection', t: 10, c: cB }], dt: 1, bulk: true });
  const dn = (0.188 * cB * 1e-9 * 150000) / 1000;
  const th0 = goldenDip(wl(633, 0), 633, 68, 76);
  const eBase = Math.abs(bulkRun.res.fields.pos[0] - th0);
  const eBulk = Math.abs(last(bulkRun.res.fields.pos) - goldenDip(wl(633, dn), 633, 68, 76));
  // de Feijter: the binding layer index = n_buffer + dn/dc · Γ / d (a 5 nm monolayer, no bulk)
  const fe = runSg(chip(), scanIt(633, 68, 76, 0.1), { ...custom, ka: 1e6, kd: 0, rmax: 1500, steps: [{ label: 'inj', t: 60, c: 100 }], dt: 2, bulk: false, thick: 'auto', mixing: 'linear' });
  const nb = refractiveIndex('Water', models, 633).re;
  const ff = fe.res.fields;
  const eFe = Math.max(...Array.from(ff.nL, (v, i) => Math.abs(v - (nb + (0.188 * ff.Gamma[i]) / 5))));
  // the exact dip at the end vs a dense grid (step 0.0005°) around it
  const lsEnd = [...wl(633, 0).slice(0, 2), { n: c(last(ff.nL), 0), d: 5 }, wl(633, 0)[2]];
  const pEnd = last(ff.pos);
  const xsD = Array.from({ length: 401 }, (_, i) => pEnd - 0.1 + i * 0.0005);
  const eTrack = Math.abs(extremum(xsD, xsD.map((t) => tmmPoint(lsEnd, 633, t, 'p').R), 0, 400, 'min').x - pEnd);
  check(
    'Sensorgram: bare chip, bulk index, de Feijter layer, exact tracking (direct transfer matrices)',
    eBase < 1e-7 && eBulk < 1e-7 && eFe < 1e-12 && eTrack < 2e-5,
    `bare chip = exact dip (${e(eBase)}°), bulk Δn ${dn.toExponential(2)} = water + Δn (${e(eBulk)}°), de Feijter n = n_b + (dn/dc)Γ/d (${e(eFe)}), tracking vs a 0.0005° grid ${e(eTrack)}°`,
  );

  // a parameter at a point: by default at the resonance of the start; R there at the end = the direct value; a phase
  const atRun = (quantity: 'R' | 'phiR') => runSg(chip(), scanIt(633, 68, 76, 0.1), { ...custom, ka: 0, steps: [{ label: 'buffer', t: 10, c: 0 }, { label: 'injection', t: 10, c: cB }], dt: 1, bulk: true, readout: 'value', quantity });
  const vR = atRun('R').res;
  const vP = atRun('phiR').res;
  const rEnd = tmmPoint(wl(633, dn), 633, vR.at, 'p').R;
  const phEnd = (tmmPoint(wl(633, dn), 633, vP.at, 'p').phir * 180) / Math.PI;
  const okAt = vR.atAuto && Math.abs(vR.at - th0) < 1e-6 && Math.abs(last(vR.fields.pos) - rEnd) < 1e-12 && Math.abs(last(vP.fields.pos) - phEnd) < 1e-9 && vP.meta[0].unit === '°';
  check('Sensorgram: a parameter at a point (at the resonance of the start)', okAt, `read at ${vR.at.toFixed(5)}° (the resonance ${th0.toFixed(5)}°); R and φr at the end = direct (${e(Math.abs(last(vR.fields.pos) - rEnd))}, ${e(Math.abs(last(vP.fields.pos) - phEnd))}°)`);

  // the window that follows the resonance (2001 points of the Simulation, a window of 201) = the whole scan: a sudden
  // jump (the injection of a solution with Δn ≈ 0.019: about 2.7°) and a slow drift of several degrees (a swelling gel)
  const wide = scanIt(633, 60, 80, 0.01);
  const jumpSg: Partial<SgSettings> = { analyte: 'custom', mw: 1e6, dndc: 0.188, rho: 1.35, dims: [5, 5, 5], ka: 0, steps: [{ label: 'buffer', t: 20, c: 0 }, { label: 'injection', t: 20, c: 1e5 }, { label: 'buffer', t: 20, c: 0 }], dt: 1, bulk: true };
  const winDev = (st: Structure, it: Interrogation, over: Partial<SgSettings>) => {
    const a = runSg(st, it, { ...over, scan: { ...defaultSg().scan, mode: 'auto' } }).res;
    const b = runSg(st, it, { ...over, scan: { ...defaultSg().scan, mode: 'sim' } }).res;
    const shift = Math.max(...Array.from(b.fields.shift).map(Math.abs));
    return { dev: Math.max(...Array.from(a.fields.pos, (v, i) => Math.abs(v - b.fields.pos[i]))), shift, W: a.W, N: b.W };
  };
  const wj = winDev(chip(), wide, jumpSg);
  // (silver: a narrow dip, a window of a part of the range moved at every time by the coarse search)
  const agChip: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'ag', label: '', mat: { id: 'Ag' }, d: 50, layers2D: 1 }], exit: { id: 'Water' } };
  const wa = winDev(agChip, wide, jumpSg);
  const gel: Structure = { incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 50, layers2D: 1 }, { kind: 'film', id: 'gel', label: '', mat: { id: 'S' }, d: 40, layers2D: 1 }], exit: { id: 'Water' } };
  const gelLib = makeLibrary([{ id: 'S', name: 'gel', color: '#7fb3a8', model: { type: 'constant', n: 1.5, k: 0 } }]);
  const gelRun = (mode: 'auto' | 'sim') => {
    const sg: SgSettings = { ...defaultSg(), model: 'swelling', tau: 40, steps: [{ label: 'b', t: 30, c: 0, swell: 0 }, { label: 's', t: 300, c: 0, swell: 1.5 }], dt: 3, target: 'gel', mixing: 'bruggeman', bulk: false, scan: { ...defaultSg().scan, mode } };
    const kin = kineticsOf(sg);
    const pr = sgPlan(gel, scanIt(633, 66, 89, 0.01), sg, kin, gelLib, modelsOf(gelLib));
    const ex = expand(gel, gelLib, modelsOf(gelLib));
    const ch = sgCompute(ex, modelsOf(gelLib), pr.plan!, Array.from({ length: pr.plan!.nK * pr.plan!.nT }, (_, i) => i));
    return sgFinish(sg, kin, pr.plan!, pr.tIdx, ch.R, ch, null, []);
  };
  const ga = gelRun('auto');
  const gb = gelRun('sim');
  const gDev = Math.max(...Array.from(ga.fields.pos, (v, i) => Math.abs(v - gb.fields.pos[i])));
  const gShift = Math.max(...Array.from(gb.fields.shift).map(Math.abs));
  check('Sensorgram: the window that follows the resonance = the whole scan', wj.dev < 1e-6 && wj.shift > 2 && wa.dev < 1e-6 && wa.shift > 1 && gDev < 1e-6 && gShift > 3 && wj.W < wj.N / 5, `a jump of ${wj.shift.toFixed(2)}° on gold (${wj.W} of ${wj.N} points) ${e(wj.dev)}°, ${wa.shift.toFixed(2)}° on silver (a moving window) ${e(wa.dev)}°; a swelling gel, ${gShift.toFixed(2)}° ${e(gDev)}°`);

  // Jung et al. 1998: a compact layer of index n_water + 0.01 growing to ~200 nm on Cr 1 nm / Au 50 nm at 825 nm:
  // R(d) = A [1 − exp(−2d/l_d)] fitted (A, l_d); the bulk sensitivity m = A / 0.01
  const jg = runSg(chip(true), scanIt(825, 62, 72, 0.05), { analyte: 'custom', mw: 1, dndc: 0.01, rho: 1, dims: [1, 1, 1], ka: 1e5, kd: 0, rmax: 220000, steps: [{ label: 'grow', t: 400, c: 100 }], dt: 4, bulk: false, thick: 'compact', mixing: 'linear', maxTimes: 101 });
  const dJ = Array.from(jg.res.fields.dL);
  const rJ = Array.from(jg.res.fields.shift);
  let best = { ld: NaN, A: NaN, res: Infinity };
  for (let ld = 150; ld <= 700; ld += 0.5) {
    const g = dJ.map((d) => 1 - Math.exp((-2 * d) / ld));
    const A = g.reduce((a, v, i) => a + v * rJ[i], 0) / g.reduce((a, v) => a + v * v, 0);
    const res = Math.sqrt(g.reduce((a, v, i) => a + (A * v - rJ[i]) ** 2, 0) / g.length);
    if (res < best.res) best = { ld, A, res };
  }
  const mJ = best.A / 0.01;
  const mBulk = (goldenDip(wl(825, 0.001, true), 825, 62, 72) - goldenDip(wl(825, 0, true), 825, 62, 72)) / 0.001;
  const okJung = best.ld > 290 && best.ld < 420 && best.res < 0.02 * Math.abs(best.A) && Math.abs(mJ / mBulk - 1) < 0.1 && Math.max(...dJ) > 150;
  // Biacore calibration: 1000 RU of protein (de Feijter, 5 nm) at 760 nm ≈ 0.1°
  const bc = runSg(chip(), scanIt(760, 62, 72, 0.05), { ...custom, ka: 1e7, kd: 0, rmax: 1000, steps: [{ label: 'inj', t: 60, c: 1000 }], dt: 2, bulk: false, thick: 'auto' });
  const dB = last(bc.res.fields.shift);
  const G1 = last(bc.res.fields.Gamma);
  const perNg = dB / G1;
  check(
    'Sensorgram: Jung et al. 1998 decay length and the Biacore calibration',
    okJung && perNg > 0.07 && perNg < 0.15 && G1 > 0.99,
    `Cr 1 / Au 50 nm, 825 nm: R(d) = A[1 − exp(−2d/l_d)] fits with l_d = ${best.ld} nm (paper 368) to ${((100 * best.res) / Math.abs(best.A)).toFixed(2)} %, m = ${mJ.toFixed(1)}°/RIU (bulk ${mBulk.toFixed(1)}; paper 107); Biacore: 1 ng/mm² at 760 nm → ${dB.toFixed(4)}° (1000 RU ≈ 0.1°)`,
  );

  // the surface: RSA blocking 1 − 4θ at low coverage; Feder's law near jamming (θ∞ − θ ∝ t^(−1/2): 4× longer halves the
  // gap); the jamming capacity of myoglobin on silica (Wasilewska et al. 2021: 0.60 ± 0.1 mg/m² at 0.01 M NaCl, ζ = 38
  // mV; 1.3 ± 0.1 at 0.15 M, ζ = 15 mV) and of albumin at 0.15 M (Wasilewska et al. 2019: 1.3–1.4)
  const eBlock = Math.abs(blocking(0.001 / THETA_JAM) - (1 - 4 * 0.001)) / 0.001;
  const Pr: KineticParams = { ...P0, ka: 1e6, kd: 0, rmax: 1000, rsa: true };
  const rr = kinSimulate(Pr, [{ label: 'a', t: 40000, c: 1e-6 }], 100);
  const gap = (t: number) => 1000 - rr.R[Math.round(t / 100)];
  const feder = gap(8000) / gap(32000);
  const my10 = surfaceOf(ANALYTES.myoglobin, 'side', 10, 38).capacity;
  const my150 = surfaceOf(ANALYTES.myoglobin, 'side', 150, 15).capacity;
  const hsa = surfaceOf(ANALYTES.bsa, 'side', 150, 10).capacity;
  // the binding layer (auto): as high as the molecule below the capacity, h·Γ/Γ∞ above; the coverage fields agree
  const iggEnd = surfaceOf(ANALYTES.igg, 'end', 150, -10);
  const mono = runSg(chip(), scanIt(633, 68, 76, 0.1), { analyte: 'igg', orient: 'end', ka: 1e6, kd: 0, rmax: 8000, steps: [{ label: 'inj', t: 300, c: 100 }], dt: 5, bulk: false, thick: 'auto', maxTimes: 61 });
  const mf = mono.res.fields;
  let eAuto = 0;
  let eCov = 0;
  for (let i = 0; i < mf.dL.length; i++) {
    const G = mf.Gamma[i];
    eAuto = Math.max(eAuto, Math.abs(mf.dL[i] - (G > iggEnd.capacity ? (iggEnd.height * G) / iggEnd.capacity : iggEnd.height)));
    eCov = Math.max(eCov, Math.abs(mf.cover[i] - mf.jam[i] * iggEnd.thetaMax), Math.abs(mf.num[i] / ((G * 1e-15) / iggEnd.mass) - 1) || 0);
  }
  const okWarn = mono.kin.warnings.some((w) => w.includes('monolayer'));
  // drift: nothing bound, the buffer index grows by drift·t: the end = the dip of water + Δn
  const dr = runSg(chip(), scanIt(633, 68, 76, 0.1), { ka: 0, steps: [{ label: 'buffer', t: 600, c: 0 }], dt: 10, bulk: false, drift: 5 });
  const eDrift = Math.abs(last(dr.res.fields.pos) - goldenDip(wl(633, (5e-6 * 600) / 60), 633, 68, 76));
  check(
    'Sensorgram: the surface (RSA, Feder, Wasilewska 2021 / 2019), the auto layer, drift',
    eBlock < 0.01 && Math.abs(feder - 2) < 0.15 && Math.abs(my10 - 0.6) < 0.1 && Math.abs(my150 - 1.3) < 0.1 && hsa > 1.25 && hsa < 1.45 && eAuto < 1e-9 && eCov < 1e-9 && okWarn && eDrift < 1e-7,
    `blocking 1 − 4θ (${e(eBlock)}), Feder gap ratio ${feder.toFixed(3)} (2), myoglobin Γ∞ ${my10.toFixed(3)} / ${my150.toFixed(3)} mg/m² (0.60 / 1.3), albumin ${hsa.toFixed(2)} (1.3–1.4); auto layer ${e(eAuto)}, coverage ${e(eCov)}, monolayer warning ${okWarn}; drift = water + Δn (${e(eDrift)}°)`,
  );

  // noise seeds: one noisy run per seed, different noise, σ of the measured − exact = the additive noise; calibration
  // per RIU = the exact dip of water + Δn, per ng/mm² ≈ the 1 ng/mm² run; the detection limit 3σ / (per ng/mm²)
  const sd = runSg(chip(), scanIt(633, 68, 76, 0.1), { ka: 1e6, kd: 0, rmax: 500, steps: [{ label: 'buffer', t: 100, c: 0 }, { label: 'inj', t: 100, c: 100 }], dt: 10, bulk: false, track: false, inst: { ...defaultSg().inst, noise: true, noiseAdd: 0.001 }, seeds: [1, 2, 3] });
  const m = sd.res.measured!;
  const dR = Math.max(...Array.from(m[0], (v, i) => Math.abs(v - m[1][i])));
  const nNoise = Math.sqrt(Array.from(m[0], (v, i) => (v - sd.res.exact[i]) ** 2).reduce((a, v) => a + v, 0) / m[0].length);
  const okSeed = m.length === 3 && sd.res.fields.pos.length === 3 * sd.res.nK * sd.res.nT && dR > 1e-4 && Math.abs(nNoise / 0.001 - 1) < 0.1;
  const perNx = (goldenDip(wl(633, 1e-5), 633, 68, 76) - th0) / 1e-5;
  const eCalN = Math.abs(bulkRun.res.summary.cal!.perN / perNx - 1);
  const eCalG = Math.abs(bc.res.summary.cal!.perG! / perNg - 1);
  const cs = sd.res.summary;
  const okLod = cs.sigma! > 1e-4 && Math.abs(cs.lodG! - (3 * cs.sigma!) / Math.abs(cs.cal!.perG!)) < 1e-12;
  check(
    'Sensorgram: noise seeds, calibration, detection limit',
    okSeed && eCalN < 1e-4 && eCalG < 0.03 && okLod,
    `3 seeds, σ ${nNoise.toFixed(5)} (0.001); per RIU = exact (${e(eCalN)}), ${bc.res.summary.cal!.perG!.toFixed(4)}°/(ng/mm²) at 760 nm vs the 1 ng/mm² run ${perNg.toFixed(4)}; detection limit 3σ/S = ${cs.lodG!.toPrecision(2)} ng/mm²`,
  );

  // steady state: single-cycle injections long enough to reach equilibrium give back KD and Rmax; the planned series
  // (0.1 … 10 KD, injections of t95 of the lowest one) reaches ≥ 95 % everywhere and gives KD back
  const ssg: SgSettings = { ...defaultSg(), ka: 1e6, kd: 1e-3, rmax: 800, steps: [1, 3, 10, 30, 100].map((cc) => ({ label: 'inj', t: 4000, c: cc })), dt: 20 };
  const ss = kineticsOf(ssg).steady!;
  const okSteady = ss.cs.length === 5 && Math.abs(ss.KD! - 1) < 0.01 && ss.reached!.every((v) => v > 0.995) && ss.fit!.every((v, i) => Math.abs(v - ss.Req[i]) < 1);
  const plan = planSeries({ ...defaultSg(), ka: 2e5, kd: 1e-3 });
  const planned = 'error' in plan ? null : kineticsOf(applySeriesPlan({ ...defaultSg(), ka: 2e5, kd: 1e-3, dt: 5 }, plan)).steady;
  const okPlan = !('error' in plan) && !!planned && planned.reached!.every((v) => v >= 0.949) && Math.abs(planned.KD! / plan.KD - 1) < 0.05;
  check(
    'Sensorgram: steady-state KD, the planned concentration series',
    okSteady && okPlan,
    `KD ${ss.KD!.toFixed(4)} nM (1), all injections at equilibrium; plan KD ${'error' in plan ? '—' : plan.KD} nM: ${'error' in plan ? '' : plan.cs.join(', ')} nM, ${'error' in plan ? '' : plan.inject} s → reached ≥ ${planned ? Math.min(...planned.reached!).toFixed(3) : '—'}, steady KD ${planned?.KD?.toFixed(2)} nM`,
  );
}

// the planner of a concentration series: an estimated KD, the range, typed concentrations, the longest injection, the
// dissociation applied after each injection
{
  const base = { ...defaultSg(), ka: 2e5, kd: 1e-3 };
  const est = planSeries({ ...base, plan: { ...base.plan, KD: 20, count: 3, from: 0.1, to: 10 } });
  const okEst = !('error' in est) && est.cs.join(',') === '2,20,200' && Math.abs(est.kd - 20e-9 * 2e5) < 1e-15 && !est.auto;
  const typed = planSeries({ ...base, plan: { ...base.plan, cs: [50, 1, 7] } });
  const okTyped = !('error' in typed) && typed.cs.join(',') === '1,7,50' && typed.custom;
  const cap = planSeries({ ...base, plan: { ...base.plan, maxInject: 600 } });
  const okCap = !('error' in cap) && cap.inject === 600 && cap.capped && Math.abs(cap.rows[0].reached - (1 - Math.exp(-cap.rows[0].kobs * 600))) < 1e-12 && cap.notes.some((n) => n.includes('reaches'));
  const ap = 'error' in est ? null : applySeriesPlan({ ...base, plan: { ...base.plan, KD: 20, count: 3 } }, est);
  const okApply = !!ap && ap.series.join(',') === '2,20,200' && ap.steps[1].t === (est as { inject: number }).inject && ap.steps[2].t === (est as { diss: number }).diss && ap.steps[0].t === base.steps[0].t;
  const irr = planSeries({ ...base, kd: 0 });
  const irrKD = planSeries({ ...base, kd: 0, plan: { ...base.plan, KD: 10 } });
  check(
    'Sensorgram planner: estimated KD, typed concentrations, the longest injection, the dissociation',
    okEst && okTyped && okCap && okApply && 'error' in irr && !('error' in irrKD),
    `KD 20 nM → ${'error' in est ? '—' : est.cs.join(' / ')} nM; typed 50, 1, 7 → sorted; at most 600 s: the lowest reaches ${'error' in cap ? '—' : Math.round(100 * cap.rows[0].reached)} %; Apply: injection ${'error' in est ? '' : est.inject} s, dissociation ${'error' in est ? '' : est.diss} s; kd = 0 needs an estimated KD`,
  );
}
// the sensorgram examples: every configuration runs (the noisy one too), its read-out finite; the myoglobin benchmark's
// capacities from its two configurations
{
  const sgEx = EXAMPLES.filter((x) => /sensorgram|Wasilewska/i.test(x.name));
  const problems: string[] = [];
  let caps: number[] = [];
  for (const x of sgEx) {
    const p = x.make();
    const xlib = makeLibrary(p.materials);
    const xmodels = modelsOf(xlib);
    for (const cf of configsOf(p)) {
      const sg = sgOf(cf.sg);
      const kin = kineticsOf(sg);
      const pr = sgPlan(cf.structure, interrogationOf(cf.sim), sg, kin, xlib, xmodels);
      if (!pr.plan) {
        problems.push(`${x.name} / ${cf.name}: ${pr.errors.join(' ')}`);
        continue;
      }
      const ex = expand(cf.structure, xlib, xmodels);
      const ch = sgCompute(ex, xmodels, pr.plan, Array.from({ length: pr.plan.nK * pr.plan.nT }, (_, i) => i));
      const res = sgFinish(sg, kin, pr.plan, pr.tIdx, ch.R, ch, sgCalibrate(ex, xmodels, pr.plan), []);
      if (!Array.from(res.fields.shift).every(Number.isFinite)) problems.push(`${x.name} / ${cf.name}: a read-out is not finite`);
      if (/Wasilewska/.test(x.name)) caps.push(kin.surfaces[0].capacity);
    }
  }
  caps = caps.map((v) => +v.toFixed(3));
  check(
    'Sensorgram examples run; Wasilewska 2021 capacities',
    sgEx.length === 5 && !problems.length && caps.length === 2 && Math.abs(caps[0] - MYOGLOBIN_WASILEWSKA.capacity10) < 0.1 && Math.abs(caps[1] - MYOGLOBIN_WASILEWSKA.capacity150) < 0.1,
    `${sgEx.length} examples${problems.length ? `: ${problems.join('; ')}` : ''}; myoglobin Γ∞ ${caps.join(' / ')} mg/m² (0.60 / 1.3)`,
  );
}
// ---- Rough interfaces (after spr-forge's engine/rough.ts): the profile statistics, the flat limit, each material's
// thickness kept, the interface layers against explicit stacks, a thin film conformal, DBR realizations, the
// parameters, SPR Forge's numbers, the mean / median over realizations, the sensorgram without roughness ----
{
  // (1) RMS and peak-to-peak exact, zero mean, the correlation length on average over 20 realizations
  const cls: number[] = [];
  let eRms = 0;
  for (let sd = 1; sd <= 20; sd++) {
    const h = heightsOf(defaultRough({ size: 2, seed: sd }), 1000);
    const hp = heightsOf(defaultRough({ kind: 'pp', size: 7, seed: sd }), 1000);
    eRms = Math.max(eRms, Math.abs(roughStats(h).rms - 2), Math.abs(roughStats(hp).pp - 7), Math.abs(roughStats(h).mean));
    cls.push(corrLength(h));
  }
  const clMean = cls.reduce((a, b) => a + b, 0) / cls.length;
  check('Roughness: profile statistics', eRms < 1e-12 && Math.abs(clMean - 20) < 1, `RMS / peak-to-peak / mean exact (${e(eRms)}), correlation length ${clMean.toFixed(2)} nm over 20 realizations (20)`);

  // (2) zero height = flat; every kind keeps each material's thickness (flat parts + its fractions of the slices)
  const chip = (rough?: Roughs, d = 50): Structure => ({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: 'Au', mat: { id: 'Au' }, d, layers2D: 1, rough }], exit: { id: 'Water' } });
  const Rs = (s: Structure, ths = [66, 70, 74, 78]) => {
    const st = stackAt(expand(s, lib, models), models, 633);
    return ths.map((t) => tmmPoint(st, 633, t, 'p').R);
  };
  const eFlat = Math.max(...Rs(chip({ bottom: defaultRough({ size: 0 }) })).map((v, i) => Math.abs(v - Rs(chip())[i])));
  const auOf = (s: Structure) => expand(s, lib, models).layers.reduce((a, L) => a + (L.mix ? L.d * (L.mix.f[L.mix.mats.findIndex((m) => m.id === 'Au')] ?? 0) : L.mat.id === 'Au' ? L.d : 0), 0);
  const kinds = (['profile', 'effective', 'graded'] as const).map((type) => auOf(chip({ top: defaultRough({ type, size: 2 }), bottom: defaultRough({ type, size: 3, seed: 2 }) })));
  check('Roughness: flat limit, thickness kept', eFlat < 1e-15 && kinds.every((v) => Math.abs(v - 50) < 0.01), `zero height = flat (${e(eFlat)}); Au with two rough interfaces, profile / effective / graded: ${kinds.map((v) => v.toFixed(4)).join(' / ')} nm (50)`);

  // (3) the interface layers against explicit stacks: an effective layer 2·RMS thick (Bruggeman 50/50), a graded one
  // of N slices linear in n
  const n6 = (id: string) => refractiveIndex(id, models, 633);
  const bru = CX.sqrt(emaEps('bruggeman', CX.mul(n6('Water'), n6('Water')), CX.mul(n6('Au'), n6('Au')), 0.5));
  const effStack: Layer[] = [{ n: n6('BK7'), d: 0 }, { n: n6('Au'), d: 48 }, { n: bru, d: 4 }, { n: n6('Water'), d: 0 }];
  const effR = Rs(chip({ bottom: defaultRough({ type: 'effective', size: 2 }) }));
  const eEff = Math.max(...[66, 70, 74, 78].map((t, i) => Math.abs(tmmPoint(effStack, 633, t, 'p').R - effR[i])));
  const N = 8;
  const grStack: Layer[] = [{ n: n6('BK7'), d: 0 }, { n: n6('Au'), d: 47 }, ...Array.from({ length: N }, (_, k) => {
    const f = (k + 0.5) / N; // the water fraction grows with depth
    return { n: c((1 - f) * n6('Au').re + f * n6('Water').re, (1 - f) * n6('Au').im + f * n6('Water').im), d: 6 / N };
  }), { n: n6('Water'), d: 0 }];
  const grR = Rs(chip({ bottom: defaultRough({ type: 'graded', kind: 'pp', size: 6, slices: N, mix: 'linear' }) }));
  const eGr = Math.max(...[66, 70, 74, 78].map((t, i) => Math.abs(tmmPoint(grStack, 633, t, 'p').R - grR[i])));
  check('Roughness: effective and graded layers = explicit stacks', eEff < 1e-13 && eGr < 1e-12, `effective (Bruggeman 50/50, 2·RMS) ${e(eEff)}; graded (8 slices, linear n, 6 nm) ${e(eGr)}`);

  // (4) SPR Forge's numbers: Au 50 nm with a rough bottom (random, RMS 3, cl 20, cell 1000, 1000 points, seed 1, 10
  // slices, Bruggeman) — R at 70 / 75 / 80° from its engine/rough.ts (2026-10-04)
  const FORGE = [0.734610584469, 0.513241603448, 0.469487388310];
  const fR = Rs(chip({ bottom: defaultRough({ size: 3 }) }), [70, 75, 80]);
  const eForge = Math.max(...fR.map((v, i) => Math.abs(v - FORGE[i])));
  // (5) Cr 2 nm between two random interfaces (RMS 1.5 + 1.5 > 2): conformal, one zone of three materials; 20 nm: two zones
  const crAu = (dCr: number): Structure => ({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'cr', label: '', mat: { id: 'Cr' }, d: dCr, layers2D: 1, rough: { top: defaultRough({ size: 1.5 }) } }, { kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 45, layers2D: 1, rough: { top: defaultRough({ size: 1.5, seed: 2 }) } }], exit: { id: 'Water' } });
  const zones = (s: Structure) => {
    const ls = expand(s, lib, models).layers;
    return ls.reduce((z, L, k) => z + (L.role === 'rough' && ls[k - 1]?.role !== 'rough' ? 1 : 0), 0);
  };
  const thinEx = expand(crAu(2), lib, models);
  const okThin = thinEx.warnings.some((w) => w.includes('conformal')) && zones(crAu(2)) === 1 && thinEx.layers.some((L) => (L.mix?.mats.length ?? 0) === 3) && zones(crAu(20)) === 2;
  check('Roughness: SPR Forge parity, a conformal thin film', eForge < 1e-12 && okThin, `R(70, 75, 80°) = Forge (${e(eForge)}); Cr 2 nm conformal, one zone of three materials; Cr 20 nm: two zones`);

  // (6) a DBR layer: every period its own realization, or the same shape; light from the other side = the layers reversed
  const dbrS = (repeat: 'independent' | 'replicated'): Structure => ({ incident: { id: 'BK7' }, blocks: [dbr({ periods: 4, period: [{ label: 'H', mat: { id: 'H' }, mode: 'nm', d: 80, layers2D: 1, rough: { top: defaultRough({ size: 2, repeat }) } }, { label: 'L', mat: { id: 'L' }, mode: 'nm', d: 120, layers2D: 1 }] })], exit: { id: 'Air' } });
  const zoneFracs = (s: Structure) => {
    const ls = expand(s, clib, cmodels).layers;
    const out: string[] = [];
    let cur = '';
    ls.forEach((L, k) => {
      if (L.role === 'rough') cur += L.mix!.f.map((f) => f.toFixed(4)).join(',') + ';';
      else if (ls[k - 1]?.role === 'rough') {
        out.push(cur);
        cur = '';
      }
    });
    return out;
  };
  const ind = zoneFracs(dbrS('independent'));
  const rep = zoneFracs(dbrS('replicated'));
  const revS = { ...dbrS('independent'), reversed: true };
  const fwd = expand(dbrS('independent'), clib, cmodels).layers.map((L) => L.d);
  const back = expand(revS, clib, cmodels).layers.map((L) => L.d).reverse();
  check('Roughness: DBR realizations, reversed light', ind.length === 4 && new Set(ind.slice(1)).size === 3 && rep.length === 4 && new Set(rep.slice(1)).size === 1 && fwd.every((d, i) => Math.abs(d - back[i]) < 1e-12), `4 rough interfaces of layer H: independent ${new Set(ind).size} different, replicated ${new Set(rep.slice(1)).size} shape; reversed = the same layers backwards`);

  // (7) the parameters: height, correlation length and seed listed, applied, swept; (8) the mean / median over
  // realizations (optimization) = by hand; (9) the sensorgram ignores the roughness
  const rs = chip({ bottom: defaultRough({ size: 2 }) });
  const it: Interrogation = { mode: 'theta', lambda: 633, theta: 0, from: 66, to: 80, points: 141, pol: 'p' };
  const plist = listParams(rs, it, lib).filter((q) => q.ref.kind === 'rough').map((q) => (q.ref as { prop: string }).prop);
  const seedRef = listParams(rs, it, lib).find((q) => q.ref.kind === 'rough' && q.ref.prop === 'seed')!.ref;
  const s5 = applyParams(rs, it, [[seedRef, 5]]).structure;
  const seed5 = s5.blocks[0].kind === 'film' && s5.blocks[0].rough?.bottom?.seed === 5;
  const differs = Rs(s5)[1] !== Rs(rs)[1] && Rs(realization(rs, 4))[1] === Rs(s5)[1];
  const mets = [newMetric('fwhm', { id: 'res', ref: 'res', label: 'Resonance' })];
  const rows = [newObjective('res', 'pos')];
  const one = (k: number) => rowValues(realization(rs, k), it, mets, [], rows, lib, models)[0];
  const vals = [0, 1, 2, 3].map(one);
  const mean = sampledValues(rs, it, mets, [], rows, lib, models, { stat: 'mean', n: 4 })[0];
  const median = sampledValues(rs, it, mets, [], rows, lib, models, { stat: 'median', n: 4 })[0];
  const sv = [...vals].sort((a, b) => a - b);
  const okStats = Math.abs(mean - vals.reduce((a, b) => a + b, 0) / 4) < 1e-12 && Math.abs(median - (sv[1] + sv[2]) / 2) < 1e-12 && new Set(vals).size > 1;
  const sgS = { ...defaultSg(), ka: 0, steps: [{ label: 'buffer', t: 10, c: 0 }], dt: 5 };
  const sgKin = kineticsOf(sgS);
  const pRough = sgPlan(rs, it, sgS, sgKin, lib, models);
  const pFlat = sgPlan(chip(), it, sgS, sgKin, lib, models);
  const okSg = !!pRough.plan && pRough.warnings.some((w) => w.includes('roughness')) && JSON.stringify(pRough.plan) === JSON.stringify(pFlat.plan);
  check(
    'Roughness: parameters, realizations, mean / median, the sensorgram',
    plist.join(',') === 'size,cl,seed' && seed5 && differs && okStats && okSg,
    `parameters ${plist.join(', ')}; seed 5 applied = realization +4; dip over 4 realizations ${vals.map((v) => v.toFixed(3)).join(' / ')}°: mean ${mean.toFixed(4)}, median ${median.toFixed(4)} (by hand); the sensorgram computes the smooth structure`,
  );
}

// ---- Lamellar (Wiener) rough slices: diagonal tensors in the transfer matrices (an isotropic tensor = the scalar path),
// the energy balance and the field of an anisotropic stack, the quasi-static limit of SPR Forge's RCWA on the same
// profile, the sensitivity reaching the analyte inside the rough zone ----
{
  // (1) εx = εy = εz = n²: the tensor path = the scalar one; a lossless biaxial slab absorbs nothing; the field's flux
  const iso: Layer[] = [{ n: n('BK7'), d: 0 }, { n: n('Ag'), d: 45 }, { n: c(1.6, 0), d: 30 }, { n: n('Water'), d: 0 }];
  const e2 = (x: C) => CX.mul(x, x);
  const isoT: Layer[] = iso.map((L, j) => (j === 0 || j === iso.length - 1 ? L : { ...L, eps: { x: e2(L.n), y: e2(L.n), z: e2(L.n) } }));
  let eIso = 0;
  for (const pol of ['s', 'p'] as const)
    for (const t of [30, 60, 70, 80]) {
      const a = tmmPoint(iso, 633, t, pol);
      const b = tmmPoint(isoT, 633, t, pol);
      eIso = Math.max(eIso, Math.abs(a.R - b.R), Math.abs(a.T - b.T), Math.abs(a.rRe - b.rRe), Math.abs(a.rIm - b.rIm), Math.abs(a.tRe - b.tRe), Math.abs(a.tIm - b.tIm));
    }
  const bi: Layer[] = [{ n: c(1.5), d: 0 }, { n: c(1.7), d: 120, eps: { x: c(2.2), y: c(3.1), z: c(2.7) } }, { n: c(1.33), d: 0 }];
  const eLoss = Math.max(...[10, 40, 55].flatMap((t) => (['s', 'p'] as const).map((pol) => Math.abs(tmmPoint(bi, 600, t, pol).A))));
  // the field: the flux into the exit = T, the absorbed fractions add up to A (a lossy biaxial slab)
  const lossy: Layer[] = [{ n: c(1.5), d: 0 }, { n: c(1.7), d: 60, eps: { x: c(-8, 1.2), y: c(2.4, 0.3), z: c(2.7, 0.1) } }, { n: c(1.33), d: 0 }];
  const fp = tmmPoint(lossy, 600, 50, 'p');
  const g = profileGrid(lossy.map((L) => L.d), 0, 0, 400);
  const prof = fieldProfile(lossy, 600, 50, 'p', g.z, g.layer);
  const eField = Math.max(Math.abs(prof.R - fp.R), Math.abs(prof.T - fp.T), Math.abs(prof.layerAbs.reduce((a, v, j) => a + (j > 0 && j < 2 ? v : 0), 0) - fp.A));
  check('Wiener: tensors in the transfer matrices', eIso < 1e-13 && eLoss < 1e-13 && eField < 1e-12, `isotropic tensor = scalar path (${e(eIso)}); lossless biaxial slab A ${e(eLoss)}; field: R, T and the absorbed fraction = the transfer matrices (${e(eField)})`);

  // (2) the quasi-static limit of RCWA (SPR Forge, Li's factorization, 40–60 orders) on the same profile (RMS 10 nm on
  // TiO₂ / 3 nm on Ag, cl/cell 0.2, a 1.25 nm cell, 200 points, seed 1, 10 slices; BK7 | film 50 nm | water, 633 nm)
  const RCWA = { TiO2: { s: [0.25629398, 0.67378125], p: [0.00356353, 0.25362280] }, Ag: { s: [0.97944692, 0.98954186] } };
  const wr = (film: string, size: number, mix: RoughMix) => {
    const ex = expand({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'f', label: '', mat: { id: film }, d: 50, layers2D: 1, rough: { bottom: defaultRough({ size, cl: 0.25, cell: 1.25, px: 200, slices: 10, mix }) } }], exit: { id: 'Water' } }, lib, models);
    const st = stackAt(ex, models, 633);
    return (pol: 's' | 'p') => [45, 60].map((t) => tmmPoint(st, 633, t, pol).R);
  };
  const dev = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const tW = wr('TiO2', 10, 'wiener');
  const tB = wr('TiO2', 10, 'bruggeman');
  const dTs = dev(tW('s'), RCWA.TiO2.s);
  const dTp = dev(tW('p'), RCWA.TiO2.p);
  const dBp = dev(tB('p'), RCWA.TiO2.p);
  const dAs = dev(wr('Ag', 3, 'wiener')('s'), RCWA.Ag.s);
  check('Wiener: the quasi-static limit of RCWA on the same profile', dTs < 1e-6 && dAs < 1e-6 && dTp < 2e-4 && dBp > 20 * dTp, `TE: TiO₂ ${e(dTs)}, Ag ${e(dAs)}; TM TiO₂ ${e(dTp)} (Bruggeman ${e(dBp)}; RCWA tends to it as the cell shrinks: 20 / 5 / 1.25 nm → 2e-3 / 4e-4 / 1e-4)`);

  // (3) the sensitivity of a rough chip: Δn of the water reaches the water inside the rough zone too (= two chips with
  // n and n + Δn by hand), for an isotropic and a lamellar mixture
  const wmats: MaterialDef[] = [{ id: 'W1', name: 'W1', color: '#6fb3e0', model: { type: 'constant', n: 1.333, k: 0 } }, { id: 'W2', name: 'W2', color: '#6fb3e0', model: { type: 'constant', n: 1.334, k: 0 } }];
  const wlib = makeLibrary(wmats);
  const wmod = modelsOf(wlib);
  const itS: Interrogation = { mode: 'theta', lambda: 633, theta: 0, from: 66, to: 82, points: 1601, pol: 'p' };
  const sensErr = (mix: RoughMix) => {
    const chipW = (w: string): Structure => ({ incident: { id: 'BK7' }, blocks: [{ kind: 'film', id: 'au', label: '', mat: { id: 'Au' }, d: 50, layers2D: 1, rough: { bottom: defaultRough({ size: 1, mix }) } }], exit: { id: w } });
    const mets = [newMetric('fwhm', { id: 'res', ref: 'res' }), newMetric('sens', { id: 'sens', ref: 'sens', dn: 0.001 })];
    const a = analyze(expand(chipW('W1'), wlib, wmod), wmod, itS, mets);
    const b = analyze(expand(chipW('W2'), wlib, wmod), wmod, itS, mets);
    const S = a.metrics[1].values.S;
    const byHand = (b.metrics[0].values.pos - a.metrics[0].values.pos) / 0.001;
    return { S, byHand, err: Math.abs(S / byHand - 1) };
  };
  const sb = sensErr('bruggeman');
  const sw = sensErr('wiener');
  check('Roughness: the sensitivity reaches the rough zone', sb.err < 2e-3 && sw.err < 2e-3, `S = ${sb.S.toFixed(2)} °/RIU (Bruggeman; by hand ${sb.byHand.toFixed(2)}), ${sw.S.toFixed(2)} (lamellar; by hand ${sw.byHand.toFixed(2)})`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
if (failed) process.exit(1);
