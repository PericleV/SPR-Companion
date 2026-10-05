// Computed data shared by the engine, the analyses and the plots (the data part of spr-forge's engine/types.ts).

export type Quantity = 'theta' | 'lambda';
export type Field = 'R' | 'T' | 'A' | 'phiR' | 'phiT';

// seed: the axis of the realizations of a random rough profile (plots can show all of them, their mean or median)
export type Axis = { id: string; label: string; unit: string; values: number[]; labels?: string[]; seed?: boolean };

// `of`: id of the axis a position or width was measured along (e.g. 'lambda' for a resonance wavelength).
export type FieldMeta = { key: string; label: string; short: string; unit: string; domain?: [number, number]; of?: string };

// Row-major values over `axes`, one array per field.
export type Dataset = {
  key: string;
  axes: Axis[];
  fields: Record<string, Float64Array>;
  meta: FieldMeta[];
  size: number;
};

// Marks added to a curve by the analyses. Per-curve arrays are indexed by the combination of the dataset axes other
// than `along` (row-major), see dataset.ts `otherIndex`.
export type Annotation = { id: string; label: string; color: string; datasetKey: string; along: string } & (
  | { kind: 'points'; field: string; x: Float64Array; y: Float64Array; text?: string[] }
  | { kind: 'width'; field: string; x1: Float64Array; x2: Float64Array; level: Float64Array; text?: string[] }
  | { kind: 'curve'; dataset: Dataset }
  | { kind: 'xy'; field: string; k: number; x: ArrayLike<number>; y: ArrayLike<number>; dash?: boolean }
  | { kind: 'span'; lo: number; hi: number }
  // a zone following axis `at` (lo / hi along `along` at each y); `edit`: the analysis and interval it belongs to
  | { kind: 'zone'; at: string; pts: { y: number; lo: number; hi: number }[]; edit: { node: string; index: number } }
  | { kind: 'area'; field: string; dataset: Dataset; lo: string; hi: string }
);
