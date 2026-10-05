// Turns analysis annotations into drawable overlays for one plotted curve.
import { line, metaOf, otherIndex } from '../engine/dataset.ts';
import { zoneAt } from '../engine/metrics.ts';
import type { Annotation, Dataset } from '../engine/types.ts';

export type Overlay =
  | { kind: 'marker'; key: string; x: number; y: number; color: string; text?: string }
  | { kind: 'width'; key: string; x1: number; x2: number; y: number; color: string; text?: string }
  // top: drawn over the curves (a fit), with its own width
  | { kind: 'curve'; key: string; x: ArrayLike<number>; y: ArrayLike<number>; color: string; solid?: boolean; top?: boolean; width?: number; dash?: string }
  | { kind: 'span'; key: string; lo: number; hi: number; color: string; strong?: boolean; text?: string } // strong: a zone (edges drawn)
  | { kind: 'arrow'; key: string; x1: number; x2: number; y: number; color: string } // e.g. the shift of a dip
  | { kind: 'band'; key: string; lo: number; hi: number; color: string; label?: string } // e.g. a layer
  | { kind: 'vline'; key: string; x: number; color: string }
  | { kind: 'area'; key: string; x: ArrayLike<number>; lo: ArrayLike<number>; hi: ArrayLike<number>; color: string }; // e.g. a p5–p95 range

export type Trace = { key: string; x: number[]; y: number[]; color: string; dash?: string; width?: number };

const num = (v: number, unit: string) => `${+v.toFixed(4)}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`;

// Identity of a mark in the legends (one entry per analysis and kind of mark).
export const markKey = (a: Annotation) => `${a.label}|${a.color}`;

// Marks shown on a plot: none when the plot's marks are off, and without the ones hidden in its legend.
export const visibleMarks = (anns: Annotation[], show: boolean | undefined, hidden: string[] | undefined) =>
  show === false ? [] : hidden?.length ? anns.filter((a) => !hidden.includes(markKey(a))) : anns;

// Overlays for the curve at per-axis indices `idx` of `ds`, drawn along axis `xDim` for `field`.
export function overlaysFor(anns: Annotation[], ds: Dataset, xDim: number, field: string, idx: number[], text: boolean): Overlay[] {
  const axis = ds.axes[xDim];
  const k = otherIndex(ds.axes, xDim, idx);
  const unit = metaOf(ds, field)?.unit ?? '';
  const out: Overlay[] = [];
  for (const a of anns) {
    if (a.datasetKey !== ds.key || a.along !== axis.id) continue;
    const key = `${a.id}#${k}`;
    if (a.kind === 'span') out.push({ kind: 'span', key: a.id, lo: a.lo, hi: a.hi, color: a.color });
    else if (a.kind === 'zone') {
      // the zone's interval for this curve (its value on the axis the zone follows)
      const at = ds.axes.findIndex((x) => x.id === a.at);
      if (at < 0 || at === xDim) continue;
      const [lo, hi] = zoneAt(a.pts, ds.axes[at].values[idx[at]]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) out.push({ kind: 'span', key, lo, hi, color: a.color });
    } else if (a.kind === 'area') {
      if (a.field === field) out.push({ kind: 'area', key, x: axis.values, lo: line(a.dataset, a.lo, xDim, idx), hi: line(a.dataset, a.hi, xDim, idx), color: a.color });
    }
    else if (a.kind === 'curve') {
      if (a.dataset.fields[field]) out.push({ kind: 'curve', key, x: axis.values, y: line(a.dataset, field, xDim, idx), color: a.color });
    } else if (a.kind === 'xy') {
      if (a.field === field && a.k === k) out.push({ kind: 'curve', key, x: a.x, y: a.y, color: a.color, solid: !a.dash });
    } else if (a.field === field) {
      if (a.kind === 'points' && Number.isFinite(a.x[k]))
        out.push({
          kind: 'marker',
          key,
          x: a.x[k],
          y: a.y[k],
          color: a.color,
          text: text ? `${a.label}: ${num(a.x[k], axis.unit)}, ${num(a.y[k], unit)}${a.text?.[k] ? ` · ${a.text[k]}` : ''}` : undefined,
        });
      if (a.kind === 'width' && Number.isFinite(a.x1[k]) && Number.isFinite(a.x2[k]))
        out.push({
          kind: 'width',
          key,
          x1: a.x1[k],
          x2: a.x2[k],
          y: a.level[k],
          color: a.color,
          text: text ? `${a.label} = ${num(a.x2[k] - a.x1[k], axis.unit)}` : undefined,
        });
    }
  }
  return out;
}

// A zone drawn on a 2D map, in data coordinates of the map: its points as (x, y) pairs for the start and end edges.
// `swap`: the analysed axis is the map's y (the edges run vertically in data, horizontally on screen).
export type MapZone = { key: string; color: string; swap: boolean; pts: { y: number; lo: number; hi: number }[]; edit: { node: string; index: number } };

// Zones of the analyses of this dataset that can be drawn (and edited) on a map of axes xDim × yDim.
export function zonesFor(anns: Annotation[], ds: Dataset, xDim: number, yDim: number): MapZone[] {
  const out: MapZone[] = [];
  const [xId, yId] = [ds.axes[xDim].id, ds.axes[yDim].id];
  for (const a of anns) {
    if (a.datasetKey !== ds.key || a.kind !== 'zone') continue;
    if (a.along === xId && a.at === yId) out.push({ key: a.id, color: a.color, swap: false, pts: a.pts, edit: a.edit });
    else if (a.along === yId && a.at === xId) out.push({ key: a.id, color: a.color, swap: true, pts: a.pts, edit: a.edit });
  }
  return out;
}

// Positions of point annotations traced across a 2D map (x or y being the analysed axis).
export function tracesFor(anns: Annotation[], ds: Dataset, xDim: number, yDim: number, field: string, idx: number[]): Trace[] {
  const out: Trace[] = [];
  for (const a of anns) {
    if (a.datasetKey !== ds.key || a.kind !== 'points' || a.field !== field) continue;
    const alongX = a.along === ds.axes[xDim].id;
    if (!alongX && a.along !== ds.axes[yDim].id) continue;
    const along = alongX ? xDim : yDim;
    const other = alongX ? yDim : xDim;
    const t: Trace = { key: a.id, x: [], y: [], color: a.color };
    ds.axes[other].values.forEach((v, j) => {
      const at = [...idx];
      at[other] = j;
      const p = a.x[otherIndex(ds.axes, along, at)];
      if (!Number.isFinite(p)) return;
      t.x.push(alongX ? p : v);
      t.y.push(alongX ? v : p);
    });
    out.push(t);
  }
  return out;
}
