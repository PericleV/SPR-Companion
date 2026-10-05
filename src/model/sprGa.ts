// SPR sensor design by a genetic algorithm over layer sequences (spr-forge's engine/sprDesign.ts, after M. Sebek et al.,
// ACS Omega 8, 20792 (2023)): the settings of the Optimization page, the problem built from them, the structure of a
// result.
import type { Library } from '../physics/library.ts';
import { refractiveIndex, type Models } from '../physics/materials.ts';
import { compiled, mergedGenes, sprClassOf, SPR_CLASSES, type SprClass, type SprProblem, type SprSettings, type SprStructure } from '../engine/sprDesign.ts';
import type { Block, Structure } from './structure.ts';

export type RoleRule = { mats: string[]; min: number; max: number; tMin: number; tMax: number }; // layers; thickness (nm, or monolayers for 2D)
export type SprTerm = { q: string; goal: 'max' | 'min'; weight: number };

// The formula of several objectives: Π q^w over those to maximize / Π q^w over those to minimize.
export function termsExpr(terms: SprTerm[]): string {
  const part = (x: SprTerm) => (x.weight === 1 ? x.q : `(${x.q}^${x.weight})`);
  const up = terms.filter((x) => x.goal === 'max' && x.weight !== 0).map(part);
  const down = terms.filter((x) => x.goal === 'min' && x.weight !== 0).map(part);
  return `(${up.join(' * ') || '1'})${down.length ? ` / (${down.join(' * ')})` : ''}`;
}

export type SprDesign = {
  prisms: string[];
  roles: Record<SprClass, RoleRule>;
  holdCounts: boolean;
  maxLayers: number;
  medium: string;
  lambda: number;
  dn: number;
  thetaMin: number;
  thetaMax: number;
  step: number;
  // fitness: S, S / FWHM, several quantities (the product of each to the power of its weight, divided for those to
  // minimize: scale-free), or a formula of them
  objective: 'S' | 'FOM' | 'multi' | 'custom';
  terms: SprTerm[];
  expr: string;
  maxTheta: number;
  single: boolean;
  minDepth: number;
  maxAsym: number;
  smooth: boolean;
  trace: boolean;
  ga: SprSettings;
};

export const ROLE_LABEL: Record<SprClass, string> = { plasmonic: 'Plasmonic metals', metal: 'Other metals (adhesion)', dielectric: 'Dielectrics', twoD: '2D materials (monolayers)' };

export const defaultSprDesign = (): SprDesign => ({
  prisms: ['CaF2'],
  roles: {
    plasmonic: { mats: ['Ag', 'Au', 'Al'], min: 1, max: 3, tMin: 5, tMax: 100 },
    metal: { mats: ['Cr'], min: 0, max: 1, tMin: 5, tMax: 100 },
    dielectric: { mats: ['SiO2', 'TiO2', 'GeO2', 'MgF2'], min: 0, max: 3, tMin: 5, tMax: 100 },
    twoD: { mats: ['Graphene', 'hBN', 'MoS2', 'WS2'], min: 0, max: 4, tMin: 1, tMax: 50 },
  },
  holdCounts: false,
  maxLayers: 12,
  medium: 'Water',
  lambda: 633,
  dn: 0.005,
  thetaMin: 40,
  thetaMax: 89.9,
  step: 0.1,
  objective: 'S',
  terms: [
    { q: 'S', goal: 'max', weight: 1 },
    { q: 'FWHM', goal: 'min', weight: 0.5 },
  ],
  expr: 'S * depth',
  maxTheta: 90,
  single: false,
  minDepth: 0.4,
  maxAsym: 1.25,
  smooth: true,
  trace: false,
  ga: { population: 50, generations: 30, elite: 0.1, mutation: 0.33, seed: 1 },
});

// The role a material suggests at the wavelength (2D, plasmonic metal, other metal, dielectric).
export const suggestedRole = (lib: Library, models: Models, id: string, lambda: number): SprClass => sprClassOf(refractiveIndex(id, models, lambda), lib.get(id)?.monolayer);

export function problemOf(d: SprDesign, lib: Library, models: Models): SprProblem | string {
  const at = (id: string) => refractiveIndex(id, models, d.lambda);
  if (!d.prisms.length) return 'Choose at least one prism.';
  if (d.objective === 'multi' && !d.terms.some((x) => x.weight !== 0)) return 'Add an objective.';
  if (d.objective === 'custom' || d.objective === 'multi') {
    const c = compiled(d.objective === 'multi' ? termsExpr(d.terms) : d.expr);
    if (typeof c === 'string') return `The fitness formula: ${c}.`;
  }
  if (!lib.has(d.medium)) return 'Choose the sensing medium.';
  const mats = SPR_CLASSES.flatMap((cls) =>
    d.roles[cls].mats.filter((id) => lib.has(id)).map((id) => {
      const mono = lib.get(id)!.monolayer;
      return { key: `${cls}:${id}`, id, name: lib.get(id)!.name, n: at(id), cls, monolayer: cls === 'twoD' ? (mono ?? 1) : undefined, lo: Math.max(1, Math.round(d.roles[cls].tMin)), hi: Math.max(1, Math.round(d.roles[cls].tMax)) };
    }),
  );
  if (!mats.some((m) => m.cls === 'plasmonic') && d.roles.plasmonic.min > 0) return 'Tick at least one plasmonic metal.';
  if (mats.some((m) => !Number.isFinite(m.n.re))) return `No index at ${d.lambda} nm for ${mats.filter((m) => !Number.isFinite(m.n.re)).map((m) => m.name).join(', ')}.`;
  return {
    lambda: d.lambda,
    ns: at(d.medium).re,
    dn: d.dn,
    prisms: d.prisms.filter((id) => lib.has(id)).map((id) => ({ key: id, id, name: lib.get(id)!.name, n: at(id).re })),
    mats,
    counts: Object.fromEntries(SPR_CLASSES.map((c) => [c, [d.roles[c].min, d.roles[c].max]])) as SprProblem['counts'],
    holdCounts: d.holdCounts,
    maxLayers: d.maxLayers,
    thetaMin: d.thetaMin,
    thetaMax: d.thetaMax,
    step: d.step,
    objective: d.objective === 'multi' ? 'custom' : d.objective,
    ...(d.objective === 'multi' ? { expr: termsExpr(d.terms) } : d.objective === 'custom' ? { expr: d.expr } : {}),
    maxTheta: d.maxTheta,
    single: { on: d.single, minDepth: d.minDepth, maxAsym: d.maxAsym, smooth: d.smooth },
    trace: d.trace,
  };
}

// The structure of a result: the prism, the layers (adjacent equal materials merged), the sensing medium.
export function structureOf(p: SprProblem, s: SprStructure, medium: string): Structure {
  const blocks: Block[] = mergedGenes(s.genes).map((g, i) => {
    const m = p.mats[g.m];
    // a 2D role: monolayers (a material without a monolayer thickness in that role: steps of 1 nm)
    return { kind: 'film', id: `ga${i}`, label: '', mat: { id: m.id }, d: m.cls === 'twoD' ? g.t * (m.monolayer ?? 1) : g.t, layers2D: m.cls === 'twoD' ? g.t : 1 };
  });
  return { incident: { id: p.prisms[s.p].id }, blocks, exit: { id: medium } };
}

export function describeSpr(p: SprProblem, s: SprStructure): string {
  return [p.prisms[s.p].name, ...mergedGenes(s.genes).map((g) => `${p.mats[g.m].name} ${g.t}${p.mats[g.m].cls === 'twoD' ? ' L' : ' nm'}`)].join(' | ');
}
