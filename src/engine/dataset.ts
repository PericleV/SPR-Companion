// Slicing helpers for row-major N-D datasets.
import type { Axis, Dataset, FieldMeta } from './types.ts';

export const TMM_META: FieldMeta[] = [
  { key: 'R', label: 'R — reflectance', short: 'R', unit: '', domain: [0, 1] },
  { key: 'T', label: 'T — transmittance', short: 'T', unit: '', domain: [0, 1] },
  { key: 'A', label: 'A — absorptance', short: 'A', unit: '', domain: [0, 1] },
  { key: 'phiR', label: 'φr — phase of r', short: 'φr', unit: '°', domain: [-180, 180] },
  { key: 'phiT', label: 'φt — phase of t', short: 'φt', unit: '°', domain: [-180, 180] },
];

// Group delay and its dispersion of r and t (from the phase along λ; a computation with at least 3 wavelengths).
export const GD_META: FieldMeta[] = [
  { key: 'GDR', label: 'GD of r — group delay in reflection', short: 'GD r', unit: 'fs' },
  { key: 'GDT', label: 'GD of t — group delay in transmission', short: 'GD t', unit: 'fs' },
  { key: 'GDDR', label: 'GDD of r — group delay dispersion in reflection', short: 'GDD r', unit: 'fs²' },
  { key: 'GDDT', label: 'GDD of t — group delay dispersion in transmission', short: 'GDD t', unit: 'fs²' },
];

export const metaOf = (ds: Dataset, key: string): FieldMeta | undefined => ds.meta.find((m) => m.key === key);

export function strides(axes: Axis[]): number[] {
  const s = new Array<number>(axes.length);
  for (let i = axes.length - 1, acc = 1; i >= 0; i--) {
    s[i] = acc;
    acc *= axes[i].values.length;
  }
  return s;
}

const offset = (st: number[], idx: number[], skip: number[]) =>
  idx.reduce((o, v, i) => (skip.includes(i) ? o : o + v * st[i]), 0);

// Values along axis `x`, all other axes held at `idx`.
export function line(ds: Dataset, field: string, x: number, idx: number[]): Float64Array {
  const st = strides(ds.axes);
  const base = offset(st, idx, [x]);
  const f = ds.fields[field];
  const out = new Float64Array(ds.axes[x].values.length);
  for (let i = 0; i < out.length; i++) out[i] = f[base + i * st[x]];
  return out;
}

// Values over axes (x, y) as a y-major grid: out[iy * nx + ix].
export function grid(ds: Dataset, field: string, x: number, y: number, idx: number[]): Float64Array {
  const st = strides(ds.axes);
  const base = offset(st, idx, [x, y]);
  const f = ds.fields[field];
  const nx = ds.axes[x].values.length;
  const ny = ds.axes[y].values.length;
  const out = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = f[base + i * st[x] + j * st[y]];
  return out;
}

export function axisValueText(a: Axis, i: number): string {
  if (a.labels) return a.labels[i] ?? '';
  const v = a.values[i];
  return `${+v.toPrecision(6)}${a.unit === '°' ? '°' : a.unit ? ` ${a.unit}` : ''}`;
}

export const axisTitle = (a: Axis) => (a.unit ? `${a.label} [${a.unit}]` : a.label);

// Index of the curve `idx` among all curves along axis `along` (row-major over the other axes).
export function otherIndex(axes: Axis[], along: number, idx: number[]): number {
  let k = 0;
  axes.forEach((a, i) => {
    if (i !== along) k = k * a.values.length + idx[i];
  });
  return k;
}

// Calls fn for every curve along axis `along`, with its values of `field`.
export function forEachLine(ds: Dataset, field: string, along: number, fn: (k: number, ys: Float64Array) => void) {
  const sizes = ds.axes.map((a, i) => (i === along ? 1 : a.values.length));
  const count = sizes.reduce((p, n) => p * n, 1);
  const idx = sizes.map(() => 0);
  for (let k = 0; k < count; k++) {
    for (let i = sizes.length - 1, rem = k; i >= 0; i--) {
      idx[i] = rem % sizes[i];
      rem = Math.floor(rem / sizes[i]);
    }
    fn(k, line(ds, field, along, idx));
  }
}

// Short content hash (cyrb53) used to tell whether stored fit results still match their data.
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
