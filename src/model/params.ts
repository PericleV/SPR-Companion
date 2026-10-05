// The parameters of a project that sweeps and optimizations can vary: thicknesses, numbers of 2D layers, materials,
// fill fractions, index offsets, numbers of periods, λ₀, cavity positions, the fixed λ or θ of the interrogation.
// A parameter is a reference into the project (ParamRef); applying values gives a new structure and interrogation.
import type { Library } from '../physics/library.ts';
import type { Interrogation } from './analysis.ts';
import { paramOf } from './materials.ts';
import type { Block, Cavity, Dbr, DbrLayer, Film, MatRef, Structure } from './structure.ts';
import type { Rough, RoughSide, Roughs } from './rough.ts';

export type ParamRef =
  | { kind: 'film'; block: string; prop: 'd' | 'layers2D' | 'mat' | 'param' | 'dn' | 'dk' }
  | { kind: 'period'; block: string; index: number; prop: 'd' | 'layers2D' | 'mat' | 'param' }
  | { kind: 'cavity'; block: string; index: number; prop: 'd' | 'layers2D' | 'mat' | 'after' | 'm' | 'param' }
  | { kind: 'dbr'; block: string; prop: 'periods' | 'lambda0' }
  | { kind: 'medium'; which: 'incident' | 'exit'; prop: 'mat' | 'param' | 'dn' | 'dk' }
  // a rough interface of a film, of a DBR period layer (every period) or of a cavity: its height, correlation length, seed
  | { kind: 'rough'; block: string; part: 'film' | 'period' | 'cavity'; index: number; side: RoughSide; prop: 'size' | 'cl' | 'seed' }
  | { kind: 'scan'; prop: 'lambda' | 'theta' };

export type ParamValue = number | string; // a material parameter takes a material id

export type ParamInfo = {
  key: string;
  ref: ParamRef;
  label: string; // e.g. “Ag (metal): d”
  unit: string;
  integer: boolean;
  material: boolean;
  value: ParamValue; // current value
  min: number;
  max: number;
};

export const paramKey = (r: ParamRef) => JSON.stringify(r);

const letter = (j: number) => String.fromCharCode(65 + j);

// Every parameter of the project, in table order. The fixed quantity of the interrogation (λ of an angular scan, θ of
// a spectral one) is a parameter too; with `point` (a single λ, θ) both are.
export function listParams(s: Structure, it: Interrogation, lib: Library, point = false): ParamInfo[] {
  const out: ParamInfo[] = [];
  const name = (m: MatRef) => lib.get(m.id)?.name ?? m.id;
  const add = (ref: ParamRef, label: string, unit: string, value: ParamValue, o: { integer?: boolean; material?: boolean; min?: number; max?: number } = {}) =>
    out.push({ key: paramKey(ref), ref, label, unit, value, integer: !!o.integer, material: !!o.material, min: o.min ?? -Infinity, max: o.max ?? Infinity });
  // the rough interfaces of a layer: the height (RMS or peak-to-peak); a random profile also its correlation length, seed
  const roughParams = (r: Roughs | undefined, block: string, part: 'film' | 'period' | 'cavity', index: number, what: string) => {
    for (const side of ['top', 'bottom'] as const) {
      const x = r?.[side];
      if (!x?.on) continue;
      const ref = (prop: 'size' | 'cl' | 'seed'): ParamRef => ({ kind: 'rough', block, part, index, side, prop });
      const w = `${what}: ${side} roughness`;
      add(ref('size'), `${w}, ${x.kind === 'rms' ? 'RMS' : 'peak-to-peak'} height`, 'nm', x.size, { min: 0 });
      if (x.type === 'profile') {
        add(ref('cl'), `${w}, correlation length`, 'nm', x.cl, { min: 0.1 });
        add(ref('seed'), `${w}, seed`, '', x.seed, { integer: true, min: 0 });
      }
    }
  };
  const matParams = (m: MatRef, refOf: (prop: 'param') => ParamRef, what: string) => {
    const p = paramOf(lib.get(m.id));
    if (p) add(refOf('param'), `${what}: ${p.label}`, '', m.param ?? p.value, { min: p.min, max: p.max });
  };
  for (const which of ['incident', 'exit'] as const) {
    const m = s[which];
    const what = `${which === 'incident' ? 'Incident medium' : 'Exit medium'} (${name(m)})`;
    add({ kind: 'medium', which, prop: 'mat' }, `${what}: material`, '', m.id, { material: true });
    add({ kind: 'medium', which, prop: 'dn' }, `${what}: n + Δn`, '', m.dn ?? 0);
    add({ kind: 'medium', which, prop: 'dk' }, `${what}: k + Δk`, '', m.dk ?? 0);
    matParams(m, (prop) => ({ kind: 'medium', which, prop }), what);
  }
  s.blocks.forEach((b, i) => {
    const what = `${i + 1}. ${b.label || (b.kind === 'dbr' ? 'DBR' : name(b.mat))}`;
    if (b.kind === 'film') {
      const mono = lib.get(b.mat.id)?.monolayer;
      if (mono) add({ kind: 'film', block: b.id, prop: 'layers2D' }, `${what}: number of layers`, '', b.layers2D, { integer: true, min: 1 });
      else add({ kind: 'film', block: b.id, prop: 'd' }, `${what}: thickness`, 'nm', b.d, { min: 0 });
      add({ kind: 'film', block: b.id, prop: 'mat' }, `${what}: material`, '', b.mat.id, { material: true });
      add({ kind: 'film', block: b.id, prop: 'dn' }, `${what}: n + Δn`, '', b.mat.dn ?? 0);
      add({ kind: 'film', block: b.id, prop: 'dk' }, `${what}: k + Δk`, '', b.mat.dk ?? 0);
      matParams(b.mat, (prop) => ({ kind: 'film', block: b.id, prop }), what);
      roughParams(b.rough, b.id, 'film', 0, what);
      return;
    }
    add({ kind: 'dbr', block: b.id, prop: 'periods' }, `${what}: periods N`, '', b.periods, { integer: true, min: 1, max: 500 });
    add({ kind: 'dbr', block: b.id, prop: 'lambda0' }, `${what}: λ₀`, 'nm', b.lambda0, { min: 1 });
    b.period.forEach((p, j) => {
      const w = `${what} layer ${letter(j)} (${name(p.mat)})`;
      if (lib.get(p.mat.id)?.monolayer) add({ kind: 'period', block: b.id, index: j, prop: 'layers2D' }, `${w}: number of layers`, '', p.layers2D, { integer: true, min: 1 });
      else add({ kind: 'period', block: b.id, index: j, prop: 'd' }, `${w}: thickness${p.mode === 'qw' ? ' (replaces λ₀/4)' : ''}`, 'nm', p.d, { min: 0 });
      add({ kind: 'period', block: b.id, index: j, prop: 'mat' }, `${w}: material`, '', p.mat.id, { material: true });
      matParams(p.mat, (prop) => ({ kind: 'period', block: b.id, index: j, prop }), w);
      roughParams(p.rough, b.id, 'period', j, w);
    });
    b.cavities.forEach((c, j) => {
      const w = `${what} cavity ${j + 1} (${name(c.mat)})`;
      add({ kind: 'cavity', block: b.id, index: j, prop: 'after' }, `${w}: position (after period)`, '', c.after, { integer: true, min: 0, max: 500 });
      if (lib.get(c.mat.id)?.monolayer) add({ kind: 'cavity', block: b.id, index: j, prop: 'layers2D' }, `${w}: number of layers`, '', c.layers2D, { integer: true, min: 1 });
      else {
        add({ kind: 'cavity', block: b.id, index: j, prop: 'd' }, `${w}: thickness${c.mode === 'half' ? ' (replaces mλ₀/2)' : ''}`, 'nm', c.d, { min: 0 });
        add({ kind: 'cavity', block: b.id, index: j, prop: 'm' }, `${w}: order m (of mλ₀/2)`, '', c.m, { integer: true, min: 1 });
      }
      add({ kind: 'cavity', block: b.id, index: j, prop: 'mat' }, `${w}: material`, '', c.mat.id, { material: true });
      matParams(c.mat, (prop) => ({ kind: 'cavity', block: b.id, index: j, prop }), w);
      roughParams(c.rough, b.id, 'cavity', j, w);
    });
  });
  if (point || it.mode === 'theta') add({ kind: 'scan', prop: 'lambda' }, 'Wavelength λ', 'nm', it.lambda, { min: 1 });
  if (point || it.mode === 'lambda') add({ kind: 'scan', prop: 'theta' }, 'Angle of incidence θ', '°', it.theta, { min: 0, max: 89.999 });
  return out;
}

const setMat = (m: MatRef, prop: string, v: ParamValue): MatRef =>
  prop === 'mat' ? { id: String(v) } : prop === 'param' ? { ...m, param: Number(v) } : prop === 'dn' ? { ...m, dn: Number(v) } : prop === 'dk' ? { ...m, dk: Number(v) } : m;

// A layer's roughness with one value set (a seed: an integer).
const setRough = (rs: Roughs | undefined, side: RoughSide, prop: 'size' | 'cl' | 'seed', v: ParamValue): Roughs | undefined => {
  const x = rs?.[side];
  if (!x) return rs;
  const val = prop === 'seed' ? Math.round(Number(v)) : Math.max(0, Number(v));
  return { ...rs, [side]: { ...x, [prop]: val } as Rough };
};

function applyToBlock(b: Block, r: ParamRef, v: ParamValue): Block {
  if (r.kind === 'rough') {
    if (r.part === 'film' && b.kind === 'film') return { ...b, rough: setRough(b.rough, r.side, r.prop, v) };
    if (b.kind !== 'dbr') return b;
    if (r.part === 'period') return { ...b, period: b.period.map((p, j) => (j === r.index ? { ...p, rough: setRough(p.rough, r.side, r.prop, v) } : p)) };
    return { ...b, cavities: b.cavities.map((c, j) => (j === r.index ? { ...c, rough: setRough(c.rough, r.side, r.prop, v) } : c)) };
  }
  if (r.kind === 'film' && b.kind === 'film') {
    const f: Film = { ...b };
    if (r.prop === 'd') f.d = Number(v);
    else if (r.prop === 'layers2D') f.layers2D = Math.max(1, Math.round(Number(v)));
    else f.mat = setMat(b.mat, r.prop, v);
    return f;
  }
  if (b.kind !== 'dbr') return b;
  const d: Dbr = { ...b };
  if (r.kind === 'dbr') {
    if (r.prop === 'periods') d.periods = Math.max(1, Math.round(Number(v)));
    else d.lambda0 = Number(v);
  } else if (r.kind === 'period') {
    d.period = b.period.map((p, j): DbrLayer => {
      if (j !== r.index) return p;
      if (r.prop === 'd') return { ...p, mode: 'nm', d: Number(v) };
      if (r.prop === 'layers2D') return { ...p, layers2D: Math.max(1, Math.round(Number(v))) };
      return { ...p, mat: setMat(p.mat, r.prop, v) };
    });
  } else if (r.kind === 'cavity') {
    d.cavities = b.cavities.map((c, j): Cavity => {
      if (j !== r.index) return c;
      if (r.prop === 'd') return { ...c, mode: 'nm', d: Number(v) };
      if (r.prop === 'm') return { ...c, mode: 'half', m: Math.max(1, Math.round(Number(v))) };
      if (r.prop === 'after') return { ...c, after: Math.max(0, Math.round(Number(v))) };
      if (r.prop === 'layers2D') return { ...c, layers2D: Math.max(1, Math.round(Number(v))) };
      return { ...c, mat: setMat(c.mat, r.prop, v) };
    });
  }
  return d;
}

// The structure and the interrogation with the given parameter values.
export function applyParams(s: Structure, it: Interrogation, values: [ParamRef, ParamValue][]): { structure: Structure; it: Interrogation } {
  let structure = s;
  let next = it;
  for (const [r, v] of values) {
    if (r.kind === 'scan') next = { ...next, [r.prop]: Number(v) };
    else if (r.kind === 'medium') structure = { ...structure, [r.which]: setMat(structure[r.which], r.prop, v) };
    else structure = { ...structure, blocks: structure.blocks.map((b) => (b.id === r.block ? applyToBlock(b, r, v) : b)) };
  }
  return { structure, it: next };
}

// Whether a reference still points at something of the structure (blocks can be removed after a sweep was set up).
export function refValid(s: Structure, r: ParamRef): boolean {
  if (r.kind === 'scan' || r.kind === 'medium') return true;
  const b = s.blocks.find((x) => x.id === r.block);
  if (!b) return false;
  if (r.kind === 'film') return b.kind === 'film';
  if (r.kind === 'rough') {
    const rs = r.part === 'film' ? (b.kind === 'film' ? b.rough : undefined) : b.kind !== 'dbr' ? undefined : r.part === 'period' ? b.period[r.index]?.rough : b.cavities[r.index]?.rough;
    return !!rs?.[r.side]?.on;
  }
  if (b.kind !== 'dbr') return false;
  if (r.kind === 'period') return r.index < b.period.length;
  if (r.kind === 'cavity') return r.index < b.cavities.length;
  return true;
}
