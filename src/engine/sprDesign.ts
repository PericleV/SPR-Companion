// SPR sensor design by a genetic algorithm over layer sequences, after M. Sebek, N. T. K. Thanh, X. Su, J. Teng, “A
// Genetic Algorithm for Universal Optimization of Ultrasensitive Surface Plasmon Resonance Sensors with 2D Materials”,
// ACS Omega 8, 20792 (2023). Used by the Optimization Engine (algorithm “layer sequences”).
// A structure is a prism (one of the candidates) and a sequence of layers before the sensing medium: each a material of
// one of the roles (plasmonic metal, other metal, dielectric, 2D material) and a thickness in steps (1 nm, or one
// monolayer for 2D materials). Its fitness is the angular sensitivity S = Δθ/Δn (deg/RIU) of the reflectance dip in TM
// for n_s → n_s + Δn: a coarse angular scan, then the dip refined around its position. Selection by a wheel weighted
// with the fitness, 10 % elites, children made by one mutation (33 %) or one crossover (67 %); a child that breaks a
// condition is replaced by a random structure from the pool of the structures that met them. Pure: runs in the worker
// and in the check scripts.
import type { C } from '../physics/complex.ts';
import { tmmPoint, type Layer } from '../physics/tmm.ts';
import { rng } from './optimize.ts';
import { compile } from './expr.ts';

// plasmonic metal (Ag, Au, Al…), other metal (Cr, Ti…), dielectric, 2D material (thickness in monolayers)
export type SprClass = 'plasmonic' | 'metal' | 'dielectric' | 'twoD';
export const SPR_CLASSES: SprClass[] = ['plasmonic', 'dielectric', 'twoD', 'metal']; // (the order of the first population)
export const SPR_CLASS_LABEL: Record<SprClass, string> = { plasmonic: 'plasmonic metal', metal: 'other metal', dielectric: 'dielectric', twoD: '2D material' };
// key: unique per role and material; lo, hi: thickness bounds in steps (nm, or monolayers for 2D materials)
export type SprMaterial = { key: string; id: string; name: string; n: C; cls: SprClass; monolayer?: number; lo: number; hi: number };
export type SprPrism = { key: string; id: string; name: string; n: number };
export type SprGene = { m: number; t: number }; // material index; thickness in steps
export type SprStructure = { p: number; genes: SprGene[] }; // prism index and the layers from the prism side

export type SprProblem = {
  lambda: number; // nm
  ns: number; // sensing medium
  dn: number; // its change
  prisms: SprPrism[]; // (transparent) prisms: the structure picks one
  mats: SprMaterial[];
  counts: Record<SprClass, [number, number]>; // layers of each class: the minimum always holds, the maximum in the first
  holdCounts: boolean; // population (as in the article) or, with holdCounts, in every generation
  maxLayers: number;
  thetaMin: number; // coarse scan, degrees
  thetaMax: number;
  step: number;
  objective: 'S' | 'FOM' | 'custom'; // fitness: S (the article), S / FWHM, or a formula (expr) of the quantities
  expr?: string;
  maxTheta: number; // dips beyond it do not count (≥ thetaMax = no limit)
  // single-mode conditions of the article (sensors at 633 / 785 nm): dip depth, asymmetry (left / right half width),
  // smoothness (extrema of R′ and R″ around the dip); trace: the dip is followed between n_s and n_s + Δn
  single: { on: boolean; minDepth: number; maxAsym: number; smooth: boolean };
  trace: boolean;
};

// The names of a custom objective: S (deg/RIU), FWHM (deg), FOM (1/RIU), Rmin and depth of the dip, theta (deg) of the dip,
// dtheta (its shift, deg), layers (their number), thickness (total, nm), asym (left / right half width).
export const SPR_NAMES = ['S', 'FWHM', 'FOM', 'Rmin', 'depth', 'theta', 'dtheta', 'layers', 'thickness', 'asym'];
const formulas = new Map<string, ((v: Record<string, number>) => number) | string>();
export function compiled(expr: string): ((v: Record<string, number>) => number) | string {
  let c = formulas.get(expr);
  if (c === undefined) {
    const r = compile(expr);
    const bad = typeof r === 'string' ? r : r.names.filter((n) => !SPR_NAMES.includes(n));
    c = typeof r === 'string' ? r : bad.length ? `unknown ${(bad as string[]).join(', ')}` : r.fn;
    formulas.set(expr, c);
  }
  return c;
}

export type SprDip = { theta: number; R: number; halfL: number; halfR: number; depth: number };
export type SprOk = { ok: true; S: number; fwhm: number; fom: number; fitness: number; a: SprDip; b: SprDip };
export type SprEval = SprOk | { ok: false; why: string };

// Suggested class from the index at the working wavelength: 2D when the material has a monolayer thickness, else a metal
// when Re ε < 0 — plasmonic when −Re ε > Im ε and −Re ε > 2 (a low-loss free-electron metal), dielectric otherwise.
export function sprClassOf(n: C, monolayer?: number): SprClass {
  if (monolayer) return 'twoD';
  const re = n.re * n.re - n.im * n.im;
  const im = 2 * n.re * n.im;
  if (re >= 0) return 'dielectric';
  return -re > im && -re > 2 ? 'plasmonic' : 'metal';
}

// Physical thickness (nm) of a gene.
export const geneD = (p: SprProblem, g: SprGene) => {
  const mat = p.mats[g.m];
  return mat.cls === 'twoD' ? g.t * (mat.monolayer ?? 1) : g.t;
};

export const structureKey = (s: SprStructure) => `${s.p}|${s.genes.map((g) => `${g.m}:${g.t}`).join(',')}`;

// Adjacent layers of the same material are one layer (their thicknesses add): the physical structure.
export function mergedGenes(gs: SprGene[]): SprGene[] {
  const out: SprGene[] = [];
  for (const g of gs) {
    const last = out[out.length - 1];
    if (last && last.m === g.m) last.t += g.t;
    else out.push({ ...g });
  }
  return out;
}

const stackOf = (p: SprProblem, s: SprStructure, ns: number): Layer[] => [
  { n: { re: p.prisms[s.p].n, im: 0 }, d: 0 },
  ...s.genes.map((g) => ({ n: p.mats[g.m].n, d: geneD(p, g) })),
  { n: { re: ns, im: 0 }, d: 0 },
];

// Reflectance (TM) over the coarse angle grid.
export function sprScan(p: SprProblem, s: SprStructure, ns: number): { thetas: number[]; R: number[] } {
  const stack = stackOf(p, s, ns);
  const n = Math.max(3, Math.floor((p.thetaMax - p.thetaMin) / p.step + 1e-9) + 1);
  const thetas = Array.from({ length: n }, (_, i) => p.thetaMin + i * p.step);
  return { thetas, R: thetas.map((t) => tmmPoint(stack, p.lambda, t, 'p').R) };
}

type Basin = { i: number; R: number; base: number; depth: number; halfL: number; halfR: number; sig: number };

// The dips of a scan: interior local minima with their basin (the highest reflectance on each side before a deeper
// point), depth = lower basin edge − R_min (≥ 2 % kept), the two half widths at the level halfway between R_min and the
// lower edge (each side on its own: dips are often asymmetric), and a shape signature for tracing (log of the ratio of
// the steepest slopes on the two sides).
function basins(th: number[], R: number[]): Basin[] {
  const out: Basin[] = [];
  const n = R.length;
  for (let i = 1; i < n - 1; i++) {
    if (!(R[i] < R[i - 1] && R[i] <= R[i + 1])) continue;
    let baseL = R[i];
    let j = i - 1;
    for (; j >= 0 && R[j] >= R[i]; j--) baseL = Math.max(baseL, R[j]);
    const lEnd = j + 1;
    let baseR = R[i];
    for (j = i + 1; j < n && R[j] >= R[i]; j++) baseR = Math.max(baseR, R[j]);
    const rEnd = j - 1;
    const base = Math.min(baseL, baseR);
    const depth = base - R[i];
    if (!(depth >= 0.02)) continue;
    const level = (base + R[i]) / 2;
    let halfL = NaN;
    for (let k = i; k > lEnd; k--)
      if (R[k - 1] >= level) {
        halfL = th[i] - (th[k - 1] + ((level - R[k - 1]) / (R[k] - R[k - 1])) * (th[k] - th[k - 1]));
        break;
      }
    let halfR = NaN;
    for (let k = i; k < rEnd; k++)
      if (R[k + 1] >= level) {
        halfR = th[k] + ((level - R[k]) / (R[k + 1] - R[k])) * (th[k + 1] - th[k]) - th[i];
        break;
      }
    let sl = 0;
    for (let k = Math.max(lEnd, 1); k <= i; k++) sl = Math.min(sl, R[k] - R[k - 1]);
    let sr = 0;
    for (let k = i; k < Math.min(rEnd, n - 1); k++) sr = Math.max(sr, R[k + 1] - R[k]);
    out.push({ i, R: R[i], base, depth, halfL, halfR, sig: Math.log((Math.abs(sl) + 1e-12) / (sr + 1e-12)) });
  }
  return out;
}

// Golden-section search of the reflectance minimum between the grid neighbours of a discrete minimum.
function refineDip(stack: Layer[], lambda: number, lo: number, hi: number): { theta: number; R: number } {
  const R = (t: number) => tmmPoint(stack, lambda, t, 'p').R;
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = R(x1);
  let f2 = R(x2);
  for (let k = 0; k < 32; k++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = R(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = R(x2);
    }
  }
  const theta = (a + b) / 2;
  return { theta, R: R(theta) };
}

// Extrema of the first and second derivatives of R within ±2 half widths of the dip (a clean dip: 2 and 3).
function smoothEnough(th: number[], R: number[], b: Basin): boolean {
  const lo = th[b.i] - 2 * b.halfL;
  const hi = th[b.i] + 2 * b.halfR;
  const idx = th.map((_, i) => i).filter((i) => th[i] >= lo && th[i] <= hi);
  if (idx.length < 5) return true; // a dip narrower than the grid: nothing to judge
  const d1: number[] = [];
  for (let k = 1; k < idx.length - 1; k++) d1.push(R[idx[k + 1]] - R[idx[k - 1]]);
  const d2: number[] = [];
  for (let k = 1; k < d1.length - 1; k++) d2.push(d1[k + 1] - d1[k - 1]);
  const extrema = (v: number[]) => {
    let c = 0;
    for (let k = 1; k < v.length - 1; k++) if ((v[k] - v[k - 1]) * (v[k + 1] - v[k]) < 0) c++;
    return c;
  };
  return extrema(d1) <= 2 && extrema(d2) <= 3;
}

const fail = (why: string): SprEval => ({ ok: false, why });

// The numbers of layers of each class: the minimum (e.g. at least one plasmonic metal), and the maximum with `max`.
export function countsBreak(p: SprProblem, gs: SprGene[], max: boolean): string | null {
  for (const c of SPR_CLASSES) {
    const k = gs.reduce((s, g) => s + (p.mats[g.m].cls === c ? 1 : 0), 0);
    const [lo, hi] = p.counts[c];
    if (k < lo) return `fewer than ${lo} ${SPR_CLASS_LABEL[c]} layer${lo > 1 ? 's' : ''}`;
    if (max && k > hi) return `more than ${hi} ${SPR_CLASS_LABEL[c]} layer${hi === 1 ? '' : 's'}`;
  }
  return null;
}

// Fitness of a structure, or the condition it breaks.
export function evaluateSensor(p: SprProblem, s: SprStructure): SprEval {
  const gs = s.genes;
  if (!gs.length) return fail('no layers');
  const counts = countsBreak(p, gs, false);
  if (counts) return fail(counts);
  if (gs.length > p.maxLayers) return fail(`more than ${p.maxLayers} layers`);
  const stack0 = stackOf(p, s, p.ns);
  const stack1 = stackOf(p, s, p.ns + p.dn);
  const s0 = sprScan(p, s, p.ns);
  const th = s0.thetas;
  const within = (b: Basin) => th[b.i] <= p.maxTheta;
  const A = basins(th, s0.R).filter(within);
  if (!A.length) return fail('no reflectance dip in the angle range'); // (most random structures: n_s + Δn not scanned)
  const deepest = (bs: Basin[]) => bs.reduce((x, y) => (y.R < x.R ? y : x));
  const a = deepest(A);
  // single mode: the n_s dip judged on the grid first (5 % margin; the exact test follows the refinement)
  if (p.single.on && !(a.depth >= 0.95 * p.single.minDepth && a.halfL > 0 && a.halfR > 0 && a.halfL / a.halfR <= 1.05 * p.single.maxAsym && (!p.single.smooth || smoothEnough(th, s0.R, a))))
    return fail('the dip does not meet the single-mode conditions');
  const s1 = sprScan(p, s, p.ns + p.dn);
  const B = basins(th, s1.R).filter(within);
  if (!B.length) return fail('no reflectance dip in the angle range');
  // the resonance: the deepest dip; traced: the dip of n_s + Δn with the most similar shape, at a larger angle if any
  let b = deepest(B);
  if (p.trace && B.length > 1) {
    const later = B.filter((x) => x.i >= a.i);
    const pool = later.length ? later : B;
    b = pool.reduce((x, y) => (Math.abs(y.sig - a.sig) < Math.abs(x.sig - a.sig) ? y : x));
  }
  const ra = refineDip(stack0, p.lambda, th[Math.max(0, a.i - 1)], th[Math.min(th.length - 1, a.i + 1)]);
  const rb = refineDip(stack1, p.lambda, th[Math.max(0, b.i - 1)], th[Math.min(th.length - 1, b.i + 1)]);
  const S = (rb.theta - ra.theta) / p.dn;
  if (!(S > 0)) return fail('the dip does not move to larger angles');
  const dip = (x: Basin, r: { theta: number; R: number }): SprDip => ({ theta: r.theta, R: r.R, halfL: x.halfL + (r.theta - th[x.i]), halfR: x.halfR - (r.theta - th[x.i]), depth: x.depth });
  const da = dip(a, ra);
  const db = dip(b, rb);
  if (p.single.on) {
    for (const [x, d, R] of [[a, da, s0.R], [b, db, s1.R]] as [Basin, SprDip, number[]][]) {
      if (!(d.depth >= p.single.minDepth)) return fail(`dip shallower than ${p.single.minDepth}`);
      if (!(d.halfL > 0 && d.halfR > 0)) return fail('dip width not resolved');
      // left / right half width: angular SPR dips are wider towards grazing incidence (the published 633 nm sensor has
      // right / left ≈ 1.5), so the limit of the article is read as a bound on the left half
      if (d.halfL / d.halfR > p.single.maxAsym) return fail(`dip wider on the low-angle side (left / right half width > ${p.single.maxAsym})`);
      if (p.single.smooth && !smoothEnough(th, R, x)) return fail('dip not smooth');
    }
  }
  const fwhm = da.halfL + da.halfR;
  const fom = Number.isFinite(fwhm) && fwhm > 0 ? S / fwhm : NaN;
  let fitness = p.objective === 'FOM' ? fom : S;
  if (p.objective === 'custom') {
    const c = compiled(p.expr ?? '');
    if (typeof c === 'string') return fail(`the objective formula: ${c}`);
    const thick = gs.reduce((t, g) => t + geneD(p, g), 0);
    fitness = c({ S, FWHM: fwhm, FOM: fom, Rmin: da.R, depth: da.depth, theta: da.theta, dtheta: db.theta - da.theta, layers: gs.length, thickness: thick, asym: da.halfL / da.halfR });
    if (!(fitness > 0)) return fail('the objective is not positive');
  } else if (!(fitness > 0)) return fail('the dip width is not resolved (FOM)');
  return { ok: true, S, fwhm, fom, fitness, a: da, b: db };
}

// ---- The genetic algorithm ----

export type SprSettings = { population: number; generations: number; elite: number; mutation: number; seed: number };
export type SprIndividual = { s: SprStructure; ev: SprOk; ops: string[] };
export type SprProgress = {
  generation: number;
  phase: 'initial' | 'evolve'; // initial: random structures are tried until the first population is complete
  tried: number; // random structures tried for the first population
  best: SprIndividual | null;
  history: number[]; // best fitness per generation (0 = the first population)
  mean: number[];
  population: number[]; // fitness of the current population
  feasible: number; // structures in the pool
  evaluations: number;
  done?: boolean;
};
export type SprControl = { stopped: () => boolean; tick: () => Promise<void> };

type Rand = () => number;
const pick = <T>(xs: T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)];
const irand = (lo: number, hi: number, rand: Rand) => lo + Math.floor(rand() * (hi - lo + 1));

const bounds = (p: SprProblem, m: number): [number, number] => [p.mats[m].lo, p.mats[m].hi];
const randomGene = (p: SprProblem, m: number, rand: Rand): SprGene => ({ m, t: irand(...bounds(p, m), rand) });

// A thickness carried to another material: the number of monolayers from 2D to 2D, else the physical thickness, rounded
// to the steps of the new material and kept in its bounds.
export function withMaterial(p: SprProblem, g: SprGene, m: number): SprGene {
  const [lo, hi] = bounds(p, m);
  const from2d = p.mats[g.m].cls === 'twoD';
  const to2d = p.mats[m].cls === 'twoD';
  const t = from2d && to2d ? g.t : to2d ? Math.round(geneD(p, g) / (p.mats[m].monolayer ?? 1)) : Math.round(geneD(p, g));
  return { m, t: Math.min(hi, Math.max(lo, t)) };
}

// Initial structures: a random prism, a random number of layers of each class between its limits (the article: at most
// 3 plasmonic metals — at least one —, 3 dielectrics, 4 2D materials, 1 other metal), random materials and thicknesses,
// in random order.
export function randomStructure(p: SprProblem, rand: Rand): SprStructure {
  const prism = p.prisms.length > 1 ? Math.floor(rand() * p.prisms.length) : 0;
  const genes: SprGene[] = [];
  for (const c of SPR_CLASSES) {
    const ms = p.mats.map((_, i) => i).filter((i) => p.mats[i].cls === c);
    if (!ms.length) continue;
    const [lo, hi] = p.counts[c];
    const k = irand(lo, Math.max(lo, hi), rand);
    for (let j = 0; j < k; j++) genes.push(randomGene(p, pick(ms, rand), rand));
  }
  for (let i = genes.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [genes[i], genes[j]] = [genes[j], genes[i]];
  }
  return { p: prism, genes };
}

// The mutations of the article (one per child): thickness ± one step (the other direction at a bound), another
// material, two layers swapped, a random layer added at a random position, a layer deleted (the minimum numbers of
// layers stay); with several prisms, also another prism.
export function mutate(p: SprProblem, s0: SprStructure, rand: Rand): { s: SprStructure; op: string } {
  const gs = s0.genes.map((g) => ({ ...g }));
  let prism = s0.p;
  const ops = ['thickness', 'material', 'swap', 'add', 'delete', ...(p.prisms.length > 1 ? ['prism'] : [])].filter((o) =>
    o === 'swap' ? gs.length > 1 : o === 'delete' ? gs.length > 1 : o === 'add' ? gs.length < p.maxLayers : true,
  );
  const op = pick(ops, rand);
  const i = Math.floor(rand() * gs.length);
  if (op === 'thickness') {
    const [lo, hi] = bounds(p, gs[i].m);
    const up = rand() < 0.5;
    const t = gs[i].t + (up ? 1 : -1);
    gs[i].t = t < lo || t > hi ? gs[i].t + (up ? -1 : 1) : t;
    gs[i].t = Math.min(hi, Math.max(lo, gs[i].t));
  } else if (op === 'material') {
    const others = p.mats.map((_, m) => m).filter((m) => m !== gs[i].m);
    if (others.length) gs[i] = withMaterial(p, gs[i], pick(others, rand));
  } else if (op === 'swap') {
    let j = Math.floor(rand() * (gs.length - 1));
    if (j >= i) j++;
    [gs[i], gs[j]] = [gs[j], gs[i]];
  } else if (op === 'add') {
    gs.splice(Math.floor(rand() * (gs.length + 1)), 0, randomGene(p, Math.floor(rand() * p.mats.length), rand));
  } else if (op === 'delete') {
    const can = gs.map((_, k) => k).filter((k) => !countsBreak(p, gs.filter((__, j) => j !== k), false));
    if (can.length) gs.splice(pick(can, rand), 1);
  } else {
    let q = Math.floor(rand() * (p.prisms.length - 1));
    if (q >= prism) q++;
    prism = q;
  }
  return { s: { p: prism, genes: gs }, op };
}

// The crossovers of the article (one child kept): a crossover point in each parent and the parts after them exchanged,
// or the materials of one random layer of each parent exchanged. The child keeps the prism of the parent on its prism side.
export function crossover(p: SprProblem, A: SprStructure, B: SprStructure, rand: Rand): { s: SprStructure; op: string } {
  if (rand() < 0.5) {
    const a = Math.floor(rand() * (A.genes.length + 1));
    const b = Math.floor(rand() * (B.genes.length + 1));
    const headA = rand() < 0.5;
    const genes = headA ? [...A.genes.slice(0, a), ...B.genes.slice(b)] : [...B.genes.slice(0, b), ...A.genes.slice(a)];
    return { s: { p: headA ? A.p : B.p, genes: genes.map((g) => ({ ...g })) }, op: 'crossover point' };
  }
  const i = Math.floor(rand() * A.genes.length);
  const j = Math.floor(rand() * B.genes.length);
  if (rand() < 0.5) return { s: { p: A.p, genes: A.genes.map((g, k) => (k === i ? withMaterial(p, g, B.genes[j].m) : { ...g })) }, op: 'materials exchanged' };
  return { s: { p: B.p, genes: B.genes.map((g, k) => (k === j ? withMaterial(p, g, A.genes[i].m) : { ...g })) }, op: 'materials exchanged' };
}

// Roulette wheel weighted by the fitness.
function wheel(pop: SprIndividual[], rand: Rand): SprIndividual {
  const total = pop.reduce((s, x) => s + Math.max(0, x.ev.fitness), 0);
  if (!(total > 0)) return pick(pop, rand);
  let r = rand() * total;
  for (const x of pop) {
    r -= Math.max(0, x.ev.fitness);
    if (r <= 0) return x;
  }
  return pop[pop.length - 1];
}

const MAX_OPS = 16; // lineage kept for the best structure (the last operators)

export async function runSprGa(p: SprProblem, set: SprSettings, report: (x: SprProgress) => void, ctl: SprControl): Promise<SprProgress> {
  const rand = rng(set.seed);
  const N = Math.max(4, Math.round(set.population));
  const E = Math.max(1, Math.min(N - 1, Math.round(set.elite * N)));
  const cache = new Map<string, SprEval>();
  const pool: SprIndividual[] = []; // every structure met that satisfies the conditions
  let evaluations = 0;
  const judge = (s: SprStructure): SprEval => {
    const key = structureKey(s);
    let ev = cache.get(key);
    if (!ev) {
      ev = evaluateSensor(p, s);
      evaluations++;
      cache.set(key, ev);
      if (ev.ok) pool.push({ s, ev, ops: [] });
    }
    return ev;
  };
  // the limits of the numbers of layers hold for every child, or (the article) only the minima
  const admissible = (s: SprStructure) => countsBreak(p, s.genes, p.holdCounts);
  const history: number[] = [];
  const mean: number[] = [];
  let tried = 0;
  let pop: SprIndividual[] = [];
  const progress = (generation: number, phase: SprProgress['phase'] = 'evolve', done = false): SprProgress => {
    const best = pop.length ? pop.reduce((x, y) => (y.ev.fitness > x.ev.fitness ? y : x)) : null;
    return { generation, phase, tried, best, history: history.slice(), mean: mean.slice(), population: pop.map((x) => x.ev.fitness), feasible: pool.length, evaluations, done };
  };
  // first population: random structures until N meet the conditions (or a budget of attempts is used)
  for (; tried < 400 * N && pop.length < N; tried++) {
    if (tried % 25 === 0) {
      if (ctl.stopped()) break;
      await ctl.tick();
      report(progress(0, 'initial'));
    }
    const s = randomStructure(p, rand);
    const ev = judge(s);
    if (ev.ok) pop.push({ s, ev, ops: ['random'] });
  }
  if (pop.length < 2) throw new Error(`Only ${pop.length} of ${evaluations} random structures have a usable resonance: check the materials, the prisms, the angle range and the conditions.`);
  while (pop.length < N) pop.push(pick(pop, rand));
  const record = () => {
    history.push(Math.max(...pop.map((x) => x.ev.fitness)));
    mean.push(pop.reduce((t, x) => t + x.ev.fitness, 0) / pop.length);
  };
  record();
  report(progress(0));
  let last = 0;
  for (let g = 1; g <= set.generations && !ctl.stopped(); g++) {
    await ctl.tick();
    const next = [...pop].sort((x, y) => y.ev.fitness - x.ev.fitness).slice(0, E);
    while (next.length < N) {
      // one operator per child; the lineage follows the first parent
      const pa = wheel(pop, rand);
      const child = rand() < set.mutation ? mutate(p, pa.s, rand) : crossover(p, pa.s, wheel(pop, rand).s, rand);
      const broken = admissible(child.s);
      const ev = broken ? fail(broken) : judge(child.s);
      if (ev.ok) next.push({ s: child.s, ev, ops: [...pa.ops, `gen ${g}: ${child.op}`].slice(-MAX_OPS) });
      else {
        const r = pick(pool, rand); // the replacement keeps the population diverse
        next.push({ s: r.s, ev: r.ev, ops: [`gen ${g}: from the pool`] });
      }
    }
    pop = next;
    record();
    last = g;
    report(progress(g));
  }
  return progress(last, 'evolve', true);
}
