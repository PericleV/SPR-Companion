// Exposed parameters: the parameters of the project marked (toggle next to their field) for sweeps and optimization,
// with their sweep values and their optimization bounds. A material parameter has a list of candidate materials.
import { paramKey, type ParamInfo, type ParamRef, type ParamValue } from './params.ts';

export type ValueMode = 'step' | 'count' | 'list';
export type Exposed = {
  id: string;
  ref: ParamRef;
  name: string;
  sweep: { mode: ValueMode; from: number; to: number; step: number; count: number; list: string; integer: boolean };
  mats: string[]; // candidates of a material parameter (sweep and optimization)
  opt: { on: boolean; min: number; max: number; integer: boolean };
};

export const MAX_VALUES = 20000;

const short = (label: string) => label.replace(/^\d+\.\s*/, '');

// A new exposed parameter: a range around the current value (or the current material).
export function exposeDefaults(info: ParamInfo): Exposed {
  const v = typeof info.value === 'number' ? info.value : 0;
  // (a roughness seed: ten realizations from the current one)
  const seed = info.ref.kind === 'rough' && info.ref.prop === 'seed';
  let [lo, hi] = seed ? [v, v + 9] : info.integer ? [v - 3, v + 3] : v ? [v * 0.5, v * 1.5] : [0, 1];
  lo = Math.max(info.min, lo);
  hi = Math.min(info.max, hi);
  const r = (x: number) => (info.integer ? Math.round(x) : +x.toPrecision(6));
  const count = info.integer ? Math.max(1, r(hi) - r(lo) + 1) : 21;
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    ref: info.ref,
    name: short(info.label),
    sweep: { mode: info.integer ? 'step' : 'count', from: r(lo), to: r(hi), step: info.integer ? 1 : +((hi - lo) / 20).toPrecision(3) || 1, count, list: '', integer: info.integer },
    mats: info.material ? [String(info.value)] : [],
    opt: { on: false, min: r(lo), max: r(hi), integer: info.integer },
  };
}

export const findExposed = (list: Exposed[], ref: ParamRef) => list.find((x) => paramKey(x.ref) === paramKey(ref));

// λ and θ: always exposed (ids 'lambda' and 'theta'), with the range of the Simulation's scan when it is theirs.
export const SCAN_IDS = ['lambda', 'theta'] as const;
export function scanExposed(prop: 'lambda' | 'theta', sim: { mode: 'theta' | 'lambda' | 'map'; from: number; to: number; points: number; lambda: number; theta: number }): Exposed {
  const own = sim.mode === prop || (sim.mode === 'map' && prop === 'lambda');
  const [from, to] = own ? [sim.from, sim.to] : prop === 'lambda' ? [400, 1000] : [0, 85];
  const count = own ? Math.min(sim.points, 501) : 121;
  return {
    id: prop,
    ref: { kind: 'scan', prop },
    name: prop === 'lambda' ? 'λ (wavelength)' : 'θ (angle of incidence)',
    sweep: { mode: 'count', from, to, step: +((to - from) / Math.max(1, count - 1)).toPrecision(3), count, list: '', integer: false },
    mats: [],
    opt: { on: false, min: from, max: to, integer: false },
  };
}

// The exposed parameters with λ and θ first (added when missing, older entries of theirs replaced by the fixed ids).
export function withScanParams(list: Exposed[], sim: Parameters<typeof scanExposed>[1]): Exposed[] {
  const rest = list.filter((x) => x.ref.kind !== 'scan');
  const scan = SCAN_IDS.map((p) => list.find((x) => x.id === p) ?? { ...(list.find((x) => x.ref.kind === 'scan' && x.ref.prop === p) ?? scanExposed(p, sim)), id: p });
  return [...scan, ...rest];
}

// The sweep values: material ids, or numbers (by step, by number of values, or a list), in the parameter's bounds,
// rounded and deduplicated for integers, ascending.
export function sweepValues(x: Exposed, info: ParamInfo | undefined): ParamValue[] {
  if (info?.material) return x.mats.slice();
  const s = x.sweep;
  let v: number[] = [];
  if (s.mode === 'list') v = s.list.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  else if (s.mode === 'count') {
    const n = Math.min(MAX_VALUES, Math.max(1, Math.round(s.count)));
    v = n === 1 ? [s.from] : Array.from({ length: n }, (_, i) => s.from + ((s.to - s.from) * i) / (n - 1));
  } else if (s.step > 0 && Number.isFinite(s.from) && Number.isFinite(s.to)) {
    const [a, b] = s.from <= s.to ? [s.from, s.to] : [s.to, s.from];
    const n = Math.min(MAX_VALUES, Math.floor((b - a) / s.step + 1e-9) + 1);
    v = Array.from({ length: n }, (_, i) => +(a + i * s.step).toPrecision(12));
  }
  if (info) v = v.filter((y) => y >= info.min && y <= info.max);
  if (s.integer || info?.integer) v = v.map(Math.round);
  return [...new Set(v)].sort((a, b) => a - b);
}

// Whether a parameter is an integer for the optimizer (integer by nature, or chosen so).
export const optInteger = (x: Exposed, info: ParamInfo | undefined) => !!info?.integer || x.opt.integer;
