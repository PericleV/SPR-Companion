// Fabrication tolerances (Monte Carlo): variations of the structure — a thickness, n or k of a medium, a layer, a DBR
// (all its layers, one layer of its period, a cavity) — each uniform (±a) or gaussian (σ), absolute or relative (%),
// independent (every real layer its own deviation) or systematic (one deviation for all the layers of the row),
// optionally limited (|deviation| ≤ a limit). Each sample is the structure with these deviations (Structure jitter);
// the response and the metrics of every sample give their spread, statistics and the yield of pass / fail criteria.
import { rng } from '../engine/optimize.ts';
import type { Library } from '../physics/library.ts';
import type { Models } from '../physics/materials.ts';
import { expand, type Block, type Jitter, type MatRef, type RealLayer, type Structure } from './structure.ts';

export type TolWhat = 'd' | 'n' | 'k';
export type TolVariation = {
  id: string;
  on: boolean;
  place: string; // 'incident' | 'exit' | a block id
  part: string; // 'all' | 'p<j>' (layer j of a DBR period, every period) | 'c<i>' (cavity i)
  what: TolWhat;
  dist: 'uniform' | 'gauss';
  amount: number; // ±a (uniform) or σ (gaussian): nm, RIU, or % of the thickness (relative)
  relative: boolean; // (thickness only)
  mode: 'independent' | 'systematic';
  limit: number; // the largest |deviation| (same unit; NaN: none)
};
export type TolCriterion = { key: string; op: 'le' | 'ge'; value: number }; // key: 'metricId|quantity'
export type TolSettings = {
  variations: TolVariation[];
  samples: number;
  seed: number;
  criteria: TolCriterion[];
  columns: string[]; // the metrics' results shown ('metricId|quantity')
  field: string; // the response shown (R, T, A, phiR, gh)
  band: 'p5' | 'minmax' | 'sigma';
  showSamples: boolean;
};
export const defaultTol = (): TolSettings => ({ variations: [], samples: 200, seed: 1, criteria: [], columns: [], field: 'R', band: 'p5', showSamples: true });
let counter = 0;
export const newVariation = (over: Partial<TolVariation> = {}): TolVariation => ({ id: `tv${Date.now().toString(36)}${counter++}`, on: true, place: '', part: 'all', what: 'd', dist: 'gauss', amount: 1, relative: false, mode: 'independent', limit: NaN, ...over });

// The real layers a variation acts on: [block, index of the layer within its block] (a medium: no layer).
export function layersOf(v: TolVariation, ex: { layers: RealLayer[] }): { block: string; k: number; d: number }[] {
  const out: { block: string; k: number; d: number }[] = [];
  const count = new Map<string, number>();
  for (const L of ex.layers) {
    const k = count.get(L.block) ?? 0;
    count.set(L.block, k + 1);
    if (L.block !== v.place) continue;
    const ok =
      v.part === 'all' ||
      (v.part.startsWith('p') && (L.role === 'period' || L.role === 'closing') && L.index === Number(v.part.slice(1))) ||
      (v.part.startsWith('c') && L.role === 'cavity' && L.index === Number(v.part.slice(1)));
    if (ok) out.push({ block: L.block, k, d: L.d });
  }
  return out;
}

// A seeded normal deviate (Box–Muller).
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

export type TolSample = { structure: Structure; dev: number[] }; // dev: per variation (row), the mean deviation applied
// The samples: the nominal structure first (no deviation), then n samples (seeded: the same seed, the same samples).
export function tolSamples(s: Structure, lib: Library, models: Models, t: Pick<TolSettings, 'variations' | 'samples' | 'seed'>): TolSample[] {
  const ex = expand({ ...s, reversed: false }, lib, models);
  const rows = t.variations.filter((v) => v.on && v.amount > 0);
  const targets = rows.map((v) => layersOf(v, ex));
  const r = rng(t.seed);
  const out: TolSample[] = [{ structure: s, dev: t.variations.map(() => 0) }];
  for (let n = 0; n < t.samples; n++) {
    const jit = new Map<string, Required<Jitter>>();
    const jitOf = (block: string) => {
      if (!jit.has(block)) jit.set(block, { d: [], dn: [], dk: [] });
      return jit.get(block)!;
    };
    let incident: MatRef = s.incident;
    let exit: MatRef = s.exit;
    const dev = t.variations.map(() => 0);
    rows.forEach((v, ri) => {
      const draw = () => {
        let x = v.dist === 'uniform' ? (2 * r() - 1) * v.amount : normal(r) * v.amount;
        if (Number.isFinite(v.limit) && v.limit > 0) x = Math.max(-v.limit, Math.min(v.limit, x));
        return x;
      };
      const shared = v.mode === 'systematic' ? draw() : 0;
      const applied: number[] = [];
      if (v.place === 'incident' || v.place === 'exit') {
        const x = v.mode === 'systematic' ? shared : draw();
        if (v.what !== 'd') {
          const m = v.place === 'incident' ? incident : exit;
          const shifted = { ...m, [v.what === 'n' ? 'dn' : 'dk']: ((v.what === 'n' ? m.dn : m.dk) ?? 0) + x };
          if (v.place === 'incident') incident = shifted;
          else exit = shifted;
          applied.push(x);
        }
      } else
        for (const L of targets[ri]) {
          const x = v.mode === 'systematic' ? shared : draw();
          const abs = v.what === 'd' && v.relative ? (x / 100) * L.d : x;
          const j = jitOf(L.block);
          const arr = v.what === 'd' ? j.d : v.what === 'n' ? j.dn : j.dk;
          arr[L.k] = (arr[L.k] ?? 0) + abs;
          applied.push(abs);
        }
      dev[t.variations.indexOf(v)] = applied.length ? applied.reduce((a, b) => a + b, 0) / applied.length : 0;
    });
    const blocks = s.blocks.map((b): Block => (jit.has(b.id) ? ({ ...b, jitter: jit.get(b.id) } as Block) : b));
    out.push({ structure: { ...s, incident, exit, blocks }, dev });
  }
  return out;
}

// Statistics of a set of values (NaN ignored).
export type Stats = { n: number; mean: number; std: number; median: number; p5: number; p95: number; min: number; max: number };
export function statsOf(values: ArrayLike<number>): Stats {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { n: 0, mean: NaN, std: NaN, median: NaN, p5: NaN, p95: NaN, min: NaN, max: NaN };
  const q = (p: number) => {
    const x = p * (n - 1);
    const i = Math.floor(x);
    return i + 1 < n ? v[i] + (x - i) * (v[i + 1] - v[i]) : v[i];
  };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const std = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, std, median: q(0.5), p5: q(0.05), p95: q(0.95), min: v[0], max: v[n - 1] };
}

export const passes = (c: TolCriterion, v: number) => Number.isFinite(v) && (c.op === 'le' ? v <= c.value : v >= c.value);
