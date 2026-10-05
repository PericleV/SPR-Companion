// The structure of a project: incident medium, a list of blocks (single films and DBR blocks), exit medium. Plain data
// (saved in projects, sent to workers, patched by the optimizer's variables); `expand` turns it into the real layer
// sequence. The DBR block follows spr-forge's DBR builder (engine/evaluate.ts, evalDbr): a period of any number of
// layers (thickness in nm or λ₀/4), N periods, cavities placed after any period (thickness in nm or m·λ₀/2), the
// period mirrored after each cavity, an optional closing layer.
import type { C } from '../physics/complex.ts';
import { refractiveIndex, type Models } from '../physics/materials.ts';
import type { Library } from '../physics/library.ts';
import { randomRough, roughPlan, shiftSeeds, type RoughMix, type RoughOrient, type Roughs } from './rough.ts';

// A material of the library; `param`: pore fraction of an effective medium, or carrier density of a doped
// semiconductor (absent = the library value); `dn`, `dk`: constant offsets of n and k (index sweeps).
export type MatRef = { id: string; param?: number; dn?: number; dk?: number };

// jitter (tolerance samples): per real layer of the block, in its order, added to the thickness (nm) and to n and k
export type Jitter = { d?: number[]; dn?: number[]; dk?: number[] };
// rough: the roughness of its top (towards the incident medium) and bottom interfaces (model/rough.ts)
export type Film = { kind: 'film'; id: string; label: string; mat: MatRef; d: number; layers2D: number; jitter?: Jitter; rough?: Roughs };

export type DbrLayer = { label: string; mat: MatRef; mode: 'nm' | 'qw'; d: number; layers2D: number; rough?: Roughs }; // (rough: in every period)
export type Cavity = { mat: MatRef; after: number; mode: 'nm' | 'half'; d: number; m: number; layers2D: number; rough?: Roughs };
export type Dbr = {
  kind: 'dbr';
  id: string;
  label: string;
  period: DbrLayer[];
  periods: number;
  lambda0: number; // nm, for λ₀/4 layers and m·λ₀/2 cavities
  cavities: Cavity[];
  closing: boolean; // one more first layer of the period after the last period: (HL)^N H
  mirrorAfterCavity: boolean; // (HL)^N C (LH)^N
  jitter?: Jitter;
};

export type Block = Film | Dbr;

// `reversed`: illuminated from the other side (exit ↔ incident, layer order reversed).
export type Structure = { incident: MatRef; blocks: Block[]; exit: MatRef; reversed?: boolean };

// One real layer. `role` and the indices say where it comes from (for tables, drawings and sensitivity targets).
export type RealLayer = {
  mat: MatRef;
  d: number; // nm
  layers2D?: number; // monolayers of a 2D material
  label: string;
  block: string; // block id ('' for the media)
  role: 'film' | 'period' | 'closing' | 'cavity' | 'rough';
  period?: number; // 1-based period of a DBR layer
  index?: number; // layer of the period, or cavity number
  rough?: Roughs; // (before the roughness is applied) its rough interfaces
  offset?: number; // the seed offset of its realization (a DBR period)
  // a slice of a rough interface: the fractions of the materials, where each comes from (a medium of the expanded
  // structure, a block's layer: an index change of a target reaches it), the orientation of a lamellar (Wiener) mixture
  mix?: { mats: MatRef[]; f: number[]; method: RoughMix; parts: MixPart[]; orient?: RoughOrient };
};

export type MixPart = { medium?: 'incident' | 'exit'; block: string; role?: RealLayer['role']; index?: number };

export type Expanded = { incident: MatRef; layers: RealLayer[]; exit: MatRef; errors: string[]; warnings: string[] };

export const MAX_PERIODS = 500;

export const monolayerOf = (lib: Library, id: string): number | undefined => lib.get(id)?.monolayer;

// Thickness of a film: monolayers × monolayer thickness for 2D materials, else d.
const filmD = (lib: Library, mat: MatRef, d: number, layers2D: number) => {
  const mono = monolayerOf(lib, mat.id);
  return mono ? { d: layers2D * mono, layers2D } : { d, layers2D: undefined };
};

const indexAt = (models: Models, m: MatRef, lambda: number): C => refractiveIndex(m.id, models, lambda, m.param);

function expandDbr(b: Dbr, lib: Library, models: Models, errors: string[], warnings: string[]): RealLayer[] {
  const name = b.label || 'DBR';
  if (!(Number.isInteger(b.periods) && b.periods >= 1 && b.periods <= MAX_PERIODS)) errors.push(`${name}: periods must be an integer in 1–${MAX_PERIODS}.`);
  if (!b.period.length) errors.push(`${name}: the period needs at least one layer.`);
  const usesL0 = b.period.some((p) => p.mode === 'qw' && !monolayerOf(lib, p.mat.id)) || b.cavities.some((c) => c.mode === 'half' && !monolayerOf(lib, c.mat.id));
  if (usesL0 && !(b.lambda0 > 0)) errors.push(`${name}: λ₀ must be > 0.`);
  b.cavities.forEach((c, i) => {
    if (!(Number.isInteger(c.after) && c.after >= 0)) errors.push(`${name}: cavity ${i + 1} position must be an integer ≥ 0.`);
    if (c.mode === 'half' && !(Number.isInteger(c.m) && c.m >= 1)) errors.push(`${name}: cavity ${i + 1} order m must be an integer ≥ 1.`);
  });
  if (errors.length) return [];

  const period = b.period.map((p, j) => {
    const rough = p.rough;
    const mono = monolayerOf(lib, p.mat.id);
    const d = mono ? p.layers2D * mono : p.mode === 'qw' ? b.lambda0 / 4 / indexAt(models, p.mat, b.lambda0).re : p.d;
    return { j, mat: p.mat, label: p.label, d, layers2D: mono ? p.layers2D : undefined, rough };
  });
  let clamped = false;
  const cavities = b.cavities.map((c, i) => {
    const mono = monolayerOf(lib, c.mat.id);
    const d = mono ? c.layers2D * mono : c.mode === 'half' ? (c.m * b.lambda0) / 2 / indexAt(models, c.mat, b.lambda0).re : c.d;
    let after = c.after;
    if (after > b.periods) {
      after = b.periods;
      clamped = true;
    }
    return { i, mat: c.mat, after, d, layers2D: mono ? c.layers2D : undefined, rough: c.rough };
  });
  if (clamped) warnings.push(`${name}: a cavity position exceeds the number of periods; placed after the last period.`);

  const out: RealLayer[] = [];
  let order = period;
  const addCavities = (k: number) => {
    for (const c of cavities.filter((x) => x.after === k)) {
      out.push({ mat: c.mat, d: c.d, layers2D: c.layers2D, label: 'cavity', block: b.id, role: 'cavity', index: c.i, rough: c.rough, offset: 100003 * (c.i + 1) });
      if (b.mirrorAfterCavity) order = [...order].reverse();
    }
  };
  addCavities(0);
  for (let p = 1; p <= b.periods; p++) {
    for (const L of order) out.push({ mat: L.mat, d: L.d, layers2D: L.layers2D, label: L.label, block: b.id, role: 'period', period: p, index: L.j, rough: L.rough, offset: 1009 * (p - 1) });
    if (p === b.periods && b.closing) {
      const L = order[0];
      out.push({ mat: L.mat, d: L.d, layers2D: L.layers2D, label: L.label, block: b.id, role: 'closing', index: L.j, rough: L.rough, offset: 1009 * b.periods });
    }
    addCavities(p);
  }
  if (out.some((L) => !(L.d >= 0 && Number.isFinite(L.d)))) errors.push(`${name}: invalid layer thickness (check the materials at λ₀).`);
  return out;
}

// The real layer sequence, from the incident medium to the exit.
export function expand(s: Structure, lib: Library, models: Models): Expanded {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = (m: MatRef, what: string) => {
    if (!lib.has(m.id)) errors.push(`${what}: unknown material “${m.id}”.`);
  };
  known(s.incident, 'Incident medium');
  known(s.exit, 'Exit medium');
  const layers: RealLayer[] = [];
  // a block's jitter on its real layers (2D materials: their number of layers stays; n and k still move)
  const jitter = (b: Block, from: number) => {
    const j = b.jitter;
    if (!j) return;
    for (let k = 0; from + k < layers.length; k++) {
      const L = layers[from + k];
      const dd = j.d?.[k] ?? 0;
      const dn = j.dn?.[k] ?? 0;
      const dk = j.dk?.[k] ?? 0;
      if (dd && L.layers2D === undefined) L.d = Math.max(0, L.d + dd);
      if (dn || dk) L.mat = { ...L.mat, dn: (L.mat.dn ?? 0) + dn, dk: (L.mat.dk ?? 0) + dk };
    }
  };
  for (const b of s.blocks) {
    const from = layers.length;
    if (b.kind === 'film') {
      known(b.mat, b.label || 'Layer');
      if (errors.length) continue;
      const mono = monolayerOf(lib, b.mat.id);
      if (mono && !(Number.isInteger(b.layers2D) && b.layers2D >= 1)) errors.push(`${b.label || b.mat.id}: number of 2D layers must be an integer ≥ 1.`);
      if (!mono && !(b.d >= 0)) errors.push(`${b.label || b.mat.id}: thickness must be ≥ 0.`);
      const t = filmD(lib, b.mat, b.d, b.layers2D);
      layers.push({ mat: b.mat, d: t.d, layers2D: t.layers2D, label: b.label, block: b.id, role: 'film', rough: b.rough });
    } else {
      b.period.forEach((p, j) => known(p.mat, `${b.label || 'DBR'} layer ${j + 1}`));
      b.cavities.forEach((c, i) => known(c.mat, `${b.label || 'DBR'} cavity ${i + 1}`));
      if (errors.length) continue;
      layers.push(...expandDbr(b, lib, models, errors, warnings));
    }
    jitter(b, from);
  }
  const final = errors.length ? layers : roughen(s, layers, warnings);
  if (s.reversed) return { incident: s.exit, layers: final.reverse(), exit: s.incident, errors, warnings };
  return { incident: s.incident, layers: final, exit: s.exit, errors, warnings };
}

// The layers with their rough interfaces (in the order of the structure, before a reversal): flat parts of the layers
// and the slices of the rough zones (mixtures of the materials around them).
function roughen(s: Structure, layers: RealLayer[], warnings: string[]): RealLayer[] {
  const plan = roughPlan([{ d: 0 }, ...layers.map((L) => ({ d: L.d, rough: L.rough, offset: L.offset })), { d: 0 }]);
  if (!plan) return layers;
  for (const t of plan.notes) if (!warnings.includes(`Roughness: ${t}.`)) warnings.push(`Roughness: ${t}.`);
  const n = layers.length + 1;
  const matOf = (i: number) => (i === 0 ? s.incident : i === n ? s.exit : layers[i - 1].mat);
  // (the media as the expanded structure names them: swapped when the light comes from the other side)
  const partOf = (i: number): MixPart => (i === 0 ? { medium: s.reversed ? 'exit' : 'incident', block: '' } : i === n ? { medium: s.reversed ? 'incident' : 'exit', block: '' } : { block: layers[i - 1].block, role: layers[i - 1].role, index: layers[i - 1].index });
  const out: RealLayer[] = [];
  for (const it of plan.out) {
    if (it.kind === 'layer') {
      if (it.i > 0 && it.i < n) out.push({ ...layers[it.i - 1], d: it.d });
      continue;
    }
    const owner = it.owner > 0 && it.owner < n ? layers[it.owner - 1] : null;
    out.push({ mat: matOf(it.owner), d: it.d, label: 'rough', block: owner?.block ?? '', role: 'rough', mix: { mats: it.mats.map(matOf), f: it.frac, method: it.mix, parts: it.mats.map(partOf), ...(it.mix === 'wiener' ? { orient: it.orient } : {}) } });
  }
  return out;
}

// The structure without its roughness (the sensorgram ignores it).
export function withoutRough(s: Structure): Structure {
  const strip = <T extends { rough?: unknown }>(x: T): T => {
    if (!x.rough) return x;
    const { rough: _r, ...rest } = x;
    void _r;
    return rest as T;
  };
  return { ...s, blocks: s.blocks.map((b) => (b.kind === 'film' ? strip(b) : { ...b, period: b.period.map(strip), cavities: b.cavities.map(strip) })) };
}

// Compact text of a structure with its periodic blocks: “BK7 | Ag 50 | [TiO2 | SiO2] ×8 | Water”.
export function describe(e: Expanded, lib: Library): string {
  const name = (m: MatRef) => lib.get(m.id)?.name ?? m.id;
  const layerText = (L: RealLayer) => `${name(L.mat)} ${L.layers2D ? `${L.layers2D}L` : +L.d.toFixed(2)}`;
  const parts: string[] = [name(e.incident)];
  let i = 0;
  const ls = e.layers;
  while (i < ls.length) {
    const L = ls[i];
    if (L.role === 'rough') {
      // a rough zone: its slices as one item
      let j = i;
      let d = 0;
      while (j < ls.length && ls[j].role === 'rough') d += ls[j++].d;
      parts.push(`≈${+d.toFixed(2)}`);
      i = j;
      continue;
    }
    if (L.role === 'period' && L.period !== undefined) {
      // a run of whole periods of one block
      let j = i;
      while (j < ls.length && ls[j].block === L.block && ls[j].role === 'period') j++;
      const run = ls.slice(i, j);
      const size = run.filter((x) => x.period === L.period).length;
      const count = Math.floor(run.length / Math.max(1, size));
      if (count > 1) {
        parts.push(`[${run.slice(0, size).map(layerText).join(' | ')}] ×${count}`);
        i += count * size;
        continue;
      }
    }
    parts.push(layerText(L));
    i++;
  }
  parts.push(name(e.exit));
  return parts.join(' | ');
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

// Realization k of a structure's random rough profiles (every seed + k), and whether it has any.
export function realization(s: Structure, k: number): Structure {
  if (!k) return s;
  return { ...s, blocks: s.blocks.map((b) => (b.kind === 'film' ? { ...b, rough: shiftSeeds(b.rough, k) } : { ...b, period: b.period.map((p) => ({ ...p, rough: shiftSeeds(p.rough, k) })), cavities: b.cavities.map((c) => ({ ...c, rough: shiftSeeds(c.rough, k) })) })) };
}
export const hasRandomRough = (s: Structure) => s.blocks.some((b) => (b.kind === 'film' ? randomRough(b.rough) : b.period.some((p) => randomRough(p.rough)) || b.cavities.some((c) => randomRough(c.rough))));
