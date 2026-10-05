// One plot of the computed data (Simulation page), with its own name: the response and the computed quantities, or
// the values of the metrics along an axis (and of the metrics computed on those). Curves (X an axis; any fields on the
// left and right Y axes; one curve per value of an axis or the chosen slice) or a map (X, Y axes coloured by a field);
// every other axis at a chosen value; limits of every axis; the overlays of the metrics run along the plotted axis
// (marks, fits and their components, the sensitivity's recomputed curve, zones, fitted dispersions); the ROI of a
// metric drawn on the plot (an interval on curves, a region on a map); CSV of the view and of all the data.
import { useRef, useState, type ReactNode } from 'react';
import type { Axis, Dataset } from '../engine/types.ts';
import type { Metric, MetricResult } from '../model/metrics.ts';
import { curveNumber, curveOf, sourceLabel, type AnalysisGroup, type SweepData } from '../model/sweepAnalysis.ts';
import type { Lim, PlotSpec } from '../model/sweep.ts';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import { MapPlot } from '../plot/MapPlot.tsx';
import type { MapZone, Overlay, Trace } from '../plot/overlays.ts';
import { FigureTools } from '../plot/FigureTools.tsx';
import { exportCsv } from '../plot/export.ts';
import { seriesColor } from '../plot/colors.ts';
import { AutoWidth } from './AutoWidth.tsx';
import { isHidden, metricOverlays, partsOf, type OverlayPart } from './metricOverlays.ts';
import { OverlayPicker, type OverlayEntry } from './OverlayPicker.tsx';
import { metricColor } from './roiColor.ts';
import { BoundField } from './MetricsEditor.tsx';
import type { RoiDraw } from './roiDraw.ts';
import { Chips, Field, IconButton, Segmented } from './kit.tsx';

const FIELD_COLORS = ['var(--line)', '#e07b39', '#7b5bd6', '#d9534f', '#4e79a7', '#e0a000', '#9c755f', '#b07aa1', '#ff9da7'];
const DASHES = [undefined, '7 3', '2 3', '10 3 2 3'];
// a field of the controls two columns wide when its choices are long (their text not cut)
const wide = (texts: string[]) => (texts.some((t) => t.length > 20) ? 'span-2' : '');
const valueText = (a: Axis, i: number) => (a.labels ? a.labels[i] : `${+a.values[i].toPrecision(6)}${a.unit ? ` ${a.unit}` : ''}`);

export type FieldInfo = { label: string; unit: string; domain?: [number, number] };

type Props = {
  spec: PlotSpec;
  set: (patch: Partial<PlotSpec>) => void;
  remove?: () => void;
  data: SweepData;
  fieldInfo: (key: string) => FieldInfo; // the response's fields (R, T, …, the computed quantities)
  groups: AnalysisGroup[];
  metrics: Metric[];
  setMetric: (id: string, patch: Partial<Metric>) => void;
  name: string;
  csvAll?: () => void;
  draw?: RoiDraw | null; // a ROI being drawn on this plot (started from a metric)
  onDraw?: (patch: (d: RoiDraw) => Partial<RoiDraw>) => void; // (from the current drawing: clicks in quick succession)
  extraHead?: ReactNode; // after the name (the Compare page: the configuration)
};

function LimRow({ label, lim, set }: { label: string; lim?: Lim; set: (l: Lim | undefined) => void }) {
  const [lo, hi] = lim ?? [NaN, NaN];
  return (
    <span className="lim">
      <BoundField label={`${label} min`} value={lo} onChange={(v) => set([v, hi])} />
      <BoundField label={`${label} max`} value={hi} onChange={(v) => set([lo, v])} />
    </span>
  );
}

// What a plot shows: the response, the values of the metrics along an axis (only when there is one: a sweep or a map),
// the field inside the stack.
export function DataSelect({ value, groups, onChange }: { value: string; groups: AnalysisGroup[]; onChange: (source: string) => void }) {
  const usable = groups.filter((g) => g.dataset.axes.length > 0);
  // the plot's own choice stays shown while the metrics are being computed (or when they have no axis)
  const pending = value !== 'response' && value !== 'field' && !usable.some((g) => g.key === value);
  return (
    <select className="data-select" aria-label="Data of the plot" title="What this plot shows" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="response">The response (R, T, A …)</option>
      {usable.map((g) => (
        <option key={g.key} value={g.key}>{sourceLabel(g, groups)}</option>
      ))}
      {pending && <option value={value}>{`the metrics (along ${value.replace(/^metrics:/, '').replace('theta', 'θ').replace('lambda', 'λ')})`}</option>}
      <option value="field">The field inside the stack</option>
    </select>
  );
}

// Indices on the axes of a group's data from the indices of this plot's axes (by axis id; others at 0).
const indexFor = (gAxes: Axis[], axes: Axis[], idx: number[]) => gAxes.map((a) => Math.max(0, idx[axes.findIndex((b) => b.id === a.id)] ?? 0));

export function PlotCard({ spec, set, remove, data, fieldInfo, groups, metrics, setMetric, name, csvAll, draw, onDraw, extraHead }: Props) {
  const fig = useRef<HTMLDivElement>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const group = spec.source !== 'response' ? groups.find((g) => g.key === spec.source && g.dataset.axes.length > 0) : undefined;
  // the values of the metrics, not there (yet): said so, the plot keeps its choice (not the response in their place)
  const missing = spec.source !== 'response' && !group;
  const response = !group;
  const srcKey = group ? group.key : 'response';
  const ds: Dataset = group
    ? group.dataset
    : { key: 'response', axes: data.axes, fields: data.fields, meta: Object.keys(data.fields).map((k) => ({ key: k, label: fieldInfo(k).label, short: k, unit: fieldInfo(k).unit })), size: data.size };
  const axes = ds.axes;
  const sizes = axes.map((a) => a.values.length);
  const ai = (id: string) => axes.findIndex((a) => a.id === id);
  const fields = ds.meta.map((m) => m.key);
  const metaOf = (k: string) => ds.meta.find((m) => m.key === k);
  const domainOf = (k: string) => (response ? fieldInfo(k).domain : undefined);
  const x = ai(spec.x) >= 0 ? ai(spec.x) : axes.length - 1;
  const mapOk = axes.length >= 2;
  const mode = spec.mode === 'map' && mapOk ? 'map' : 'curves';
  const y = mode === 'map' ? (ai(spec.y) >= 0 && ai(spec.y) !== x ? ai(spec.y) : axes.findIndex((_, i) => i !== x)) : -1;
  const series = mode === 'curves' && ai(spec.series) >= 0 && ai(spec.series) !== x ? ai(spec.series) : -1;
  const sliceOf = (i: number) => Math.min(sizes[i] - 1, Math.max(0, spec.slices[axes[i]?.id] ?? 0));
  // a swept seed of a rough profile (not the plot's X, Y or series): one realization, all, their mean or median
  const seedAx = axes.findIndex((a, i) => a.seed && a.values.length > 1 && i !== x && i !== y && i !== series);
  const seedStat = seedAx < 0 ? 'one' : mode === 'map' && spec.seedStat === 'all' ? 'one' : (spec.seedStat ?? 'one');
  const free = axes.map((_, i) => i).filter((i) => i !== x && i !== y && i !== series && !(i === seedAx && seedStat !== 'one'));
  const st = sizes.map((_, i) => sizes.slice(i + 1).reduce((p, n) => p * n, 1));
  const at = (idx: number[]) => idx.reduce((s, v, i) => s + v * st[i], 0);
  // a value at idx, or the mean / median over the seeds there
  const valueAt = (f: string, idx: number[]) => {
    if (seedStat !== 'mean' && seedStat !== 'median') return ds.fields[f][at(idx)];
    const id2 = [...idx];
    const v: number[] = [];
    for (let k = 0; k < sizes[seedAx]; k++) {
      id2[seedAx] = k;
      const q = ds.fields[f][at(id2)];
      if (Number.isFinite(q)) v.push(q);
    }
    if (!v.length) return NaN;
    if (seedStat === 'mean') return v.reduce((a, b) => a + b, 0) / v.length;
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const baseIdx = () => axes.map((_, i) => (free.includes(i) ? sliceOf(i) : 0));
  const left = spec.left.filter((f) => fields.includes(f));
  const right = spec.right.filter((f) => fields.includes(f));
  const leftF = left.length || right.length ? left : fields.slice(0, 1);
  const colorField = fields.includes(spec.color) ? spec.color : (leftF[0] ?? fields[0]);
  const lim = spec.lim ?? {};
  const setLim = (k: keyof PlotSpec['lim'], l: Lim | undefined) => set({ lim: { ...lim, [k]: l } });
  const mIndex = (m: Metric) => metrics.findIndex((q) => q.id === m.id);
  // the metrics computed on this plot's data along an axis
  const groupAlong = (id: string | undefined) => groups.find((g) => g.source === srcKey && g.along === id);
  const along = groupAlong(axes[x]?.id);
  const alongMap = mode === 'map' ? (groupAlong(axes[x]?.id) ?? groupAlong(axes[y]?.id)) : undefined;
  // the result of a group's metric on the curve through the indices idx (of this plot's axes)
  const resultAt = (g: AnalysisGroup, idx: number[]): MetricResult[] => {
    const gi = indexFor(g.axes, axes, idx);
    return g.results[curveNumber(g.axes.map((a) => a.values.length), g.alongIndex, gi)] ?? [];
  };

  // the header: the name, the data, the tools (csv: the view as CSV)
  const headOf = (csv?: () => void) => (
    <div className="card-head">
      <input type="text" className="plot-title" value={spec.title ?? ''} placeholder="Plot name" title="The name of this plot" onChange={(e) => set({ title: e.target.value })} />
      {extraHead}
      <DataSelect value={missing ? spec.source : srcKey} groups={groups} onChange={(source) => set({ source, left: source === 'response' ? ['R'] : [], right: [], color: '' })} />
      <span className="spacer" />
      <IconButton icon="settings" label="Axis limits" active={limitsOpen} onClick={() => setLimitsOpen(!limitsOpen)} />
      {csvAll && <IconButton icon="table" label="All the computed data as CSV" onClick={csvAll} />}
      <FigureTools target={fig} name={`${name} ${spec.title || 'plot'}`} csv={csv} />
      {remove && <IconButton icon="x" label="Remove this plot" onClick={remove} />}
    </div>
  );

  if (missing)
    return (
      <section className="card" id={`plot-${spec.id}`}>
        {headOf()}
        <p className="muted">
          {groups.some((g) => g.key === spec.source)
            ? 'One scan: each metric has a single value here. Sweep a parameter (or use the map λ × θ) to plot the metrics along it.'
            : 'The values of the metrics are being computed…'}
        </p>
      </section>
    );
  if (!axes.length)
    return (
      <section className="card">
        {headOf()}
        <div className="metric-values">{ds.meta.map((m) => <span key={m.key}>{m.label} <b>{+ds.fields[m.key][0].toPrecision(7)}</b> {m.unit}</span>)}</div>
      </section>
    );

  // the metric whose ROI is being drawn here: on this plot's data, along X (curves) or along X or Y (maps)
  const drawM = draw ? metrics.find((m) => m.id === draw.metric) : undefined;
  const drawG = drawM ? groups.find((g) => g.metrics.some((x) => x.id === drawM.id)) : undefined;
  const drawingM = drawM && drawG && drawG.source === srcKey && (drawG.along === axes[x]?.id || (mode === 'map' && drawG.along === axes[y]?.id)) ? drawM : undefined;
  const drawSwap = !!drawG && mode === 'map' && drawG.along === axes[y]?.id; // the metric runs along Y
  // the metrics shown on this plot: all, or those whose plot is this one
  const here = (m: Metric) => !m.plot || m.plot === spec.id;

  let plot: ((w: number) => ReactNode) | null = null;
  // the metrics drawn over this plot (the Overlays list)
  let entries: OverlayEntry[] = [];
  const entryOf = (m: Metric, parts: OverlayPart[]): OverlayEntry => {
    const ci = mIndex(m);
    const cur = metrics[ci] ?? m;
    return { id: m.id, label: cur.label, color: metricColor(cur, ci), parts };
  };
  let csv: () => void = () => {};
  if (mode === 'curves') {
    const n = series >= 0 ? sizes[series] : 1;
    const idxs = Array.from({ length: n }, (_, j) => {
      const idx = baseIdx();
      if (series >= 0) idx[series] = j;
      return idx;
    });
    const lineOf = (f: string, idx: number[]) => {
      const out = new Float64Array(sizes[x]);
      const id2 = [...idx];
      for (let i = 0; i < sizes[x]; i++) {
        id2[x] = i;
        out[i] = valueAt(f, id2);
      }
      return out;
    };
    // all the seeds: every realization a thin line (spaghetti) in the colour of its curve
    const spaghetti = (fs: string[], side: 'l' | 'r', colorOf: (fi: number, j: number) => string): Series[] =>
      seedStat !== 'all'
        ? []
        : fs.flatMap((f, fi) =>
            idxs.flatMap((idx, j) =>
              Array.from({ length: sizes[seedAx] }, (_, k): Series => {
                const id2 = [...idx];
                id2[seedAx] = k;
                return { key: `${side}${f}#${j}s${k}`, label: `${metaOf(f)?.short ?? f}${series >= 0 ? ` · ${axes[series].label} = ${valueText(axes[series], j)}` : ''} · ${axes[seedAx].label} = ${valueText(axes[seedAx], k)}`, color: colorOf(fi, j), y: lineOf(f, id2), width: 0.8, dash: side === 'r' ? '7 3' : undefined };
              }),
            ),
          );
    const mk = (fs: string[], side: 'l' | 'r') =>
      fs.flatMap((f, fi): Series[] =>
        idxs.map((idx, j) => ({
          key: `${side}${f}#${j}`,
          label: `${metaOf(f)?.short ?? f}${series >= 0 ? ` · ${axes[series].label} = ${valueText(axes[series], j)}` : ''}`,
          color: n > 1 ? seriesColor(j, n) : FIELD_COLORS[(side === 'l' ? fi : left.length + fi) % FIELD_COLORS.length],
          y: lineOf(f, idx),
          dash: n > 1 ? DASHES[fi % DASHES.length] : side === 'r' ? '7 3' : undefined,
          dots: sizes[x] < 30,
        })),
      );
    const tag = seedStat === 'mean' ? ' (mean of the seeds)' : seedStat === 'median' ? ' (median of the seeds)' : '';
    const colorFor = (side: 'l' | 'r') => (fi: number, j: number) => (n > 1 ? seriesColor(j, n) : FIELD_COLORS[(side === 'l' ? fi : left.length + fi) % FIELD_COLORS.length]);
    const sL = seedStat === 'all' ? spaghetti(leftF, 'l', colorFor('l')) : mk(leftF, 'l').map((q) => ({ ...q, label: q.label + tag }));
    const sR = seedStat === 'all' ? spaghetti(right, 'r', colorFor('r')) : mk(right, 'r').map((q) => ({ ...q, label: q.label + tag }));
    // the marks of the metrics along X whose curve is on the left axis (zones and fits of metrics: always)
    let overlays: Overlay[] = [];
    const ms = along ? along.metrics.map((m, i) => ({ m, i })).filter(({ m }) => here(m) && m.on && m.kind !== 'custom').filter(({ m }) => m.kind === 'zones' || (m.kind === 'fit' && m.fit?.mode === 'dispersion' ? leftF.includes(m.field ?? '') || leftF.includes(m.field2 ?? '') : leftF.includes(m.field && !['sens', 'fom'].includes(m.kind) ? m.field : 'R'))) : [];
    entries = ms.map(({ m }) => entryOf(m, partsOf(metrics[mIndex(m)] ?? m)));
    // (the marks of the metrics belong to one realization: not drawn over all / the mean / the median of the seeds)
    if (spec.marks && along && n <= 12 && seedStat === 'one') {
      overlays = idxs.flatMap((idx, j) => {
        const res = resultAt(along, idx);
        const atv = Object.fromEntries(axes.map((a, i) => [a.id, a.values[idx[i]]]));
        return metricOverlays(
          ms.map((q) => q.m),
          ms.map((q) => res[q.i]),
          {
            unit: axes[x].unit,
            spectral: along.along === 'lambda',
            shift: n === 1,
            fit: true,
            text: n === 1,
            at: atv,
            colorIndex: (i) => mIndex(ms[i].m),
            xs: axes[x].values,
            hidden: spec.hidden,
            shiftedCurve: response ? (key) => { const s = data.shifts.find((q) => q.key === key); return s ? curveOf(s.R, sizes, x, idx) : undefined; } : undefined,
          },
        ).map((o) => ({ ...o, key: `${o.key}#${j}` }));
      });
    }
    // the interval being drawn
    if (drawingM && draw && Number.isFinite(draw.lo) && Number.isFinite(draw.hi)) overlays.push({ kind: 'span', key: 'drawing', lo: draw.lo!, hi: draw.hi!, color: metricColor(drawingM, mIndex(drawingM)), strong: true, text: `${drawingM.label}: new ROI ${+draw.lo!.toPrecision(5)}–${+draw.hi!.toPrecision(5)} (Confirm in the metric)` });
    const yInfo = (fs: string[]) => {
      const units = [...new Set(fs.map((f) => metaOf(f)?.unit ?? ''))];
      return { label: fs.map((f) => metaOf(f)?.short ?? f).join(', '), unit: units.length === 1 ? units[0] : '', domain: fs.length && fs.every((f) => domainOf(f)?.join() === domainOf(fs[0])?.join()) ? domainOf(fs[0]) : undefined };
    };
    const yl = yInfo(leftF);
    const yr = yInfo(right);
    plot = (w) => (
      <LinePlot
        xAxis={axes[x]}
        series={sL}
        yLabel={yl.label}
        yUnit={yl.unit}
        yDomain={yl.domain}
        xLim={lim.x}
        yLim={lim.y}
        series2={sR}
        y2Label={yr.label}
        y2Unit={yr.unit}
        y2Domain={yr.domain}
        y2Lim={lim.y2}
        width={w}
        height={360}
        overlays={overlays}
        onSelect={drawingM && onDraw ? (lo, hi) => onDraw(() => ({ lo: +lo.toPrecision(6), hi: +hi.toPrecision(6) })) : undefined}
      />
    );
    csv = () => {
      const all = [...sL, ...sR];
      exportCsv([`${axes[x].label}${axes[x].unit ? ` [${axes[x].unit}]` : ''}`, ...all.map((s) => s.label)], axes[x].values.map((v, i) => [axes[x].labels ? axes[x].labels![i] : v, ...all.map((s) => s.y[i])]), `${name} ${spec.title || 'curves'}`);
    };
  } else {
    const nx = sizes[x];
    const ny = sizes[y];
    const vals = new Float64Array(nx * ny);
    const idx = baseIdx();
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        idx[x] = i;
        idx[y] = j;
        vals[j * nx + i] = valueAt(colorField, idx);
      }
    const traces: Trace[] = [];
    const zones: MapZone[] = [];
    const polys: { key: string; color: string; pts: [number, number][] }[] = [];
    if (alongMap) entries.push(...alongMap.metrics.filter((m) => m.on && m.kind !== 'custom' && m.kind !== 'zones' && here(m)).map((m) => entryOf(m, partsOf(m, true))));
    if (spec.marks && alongMap && seedStat === 'one') {
      // the positions of the metrics across the map, and their ROI zones / regions that follow the other axis
      const swap = alongMap.along === axes[y].id;
      const other = swap ? x : y;
      alongMap.metrics.forEach((m, mi) => {
        if (!m.on || m.kind === 'custom' || m.kind === 'zones' || !here(m) || isHidden(spec.hidden, m.id)) return;
        const ci = mIndex(m);
        const mc = metricColor(metrics[ci] ?? m, ci);
        const t: Trace = { key: m.id, x: [], y: [], color: mc };
        for (let j = 0; j < sizes[other]; j++) {
          const id2 = baseIdx();
          id2[other] = j;
          const p = resultAt(alongMap, id2)[mi]?.marks.x;
          if (p === undefined || !Number.isFinite(p)) continue;
          const ov = axes[other].values[j];
          t.x.push(swap ? ov : p);
          t.y.push(swap ? p : ov);
        }
        if (t.x.length && !isHidden(spec.hidden, m.id, 'trace')) traces.push(t);
        if (m.follow?.param === axes[other].id && !isHidden(spec.hidden, m.id, 'roi')) {
          if (m.follow.poly) polys.push({ key: m.id, color: mc, pts: m.follow.poly.map(([a, o]) => (swap ? [o, a] : [a, o])) });
          else zones.push({ key: m.id, color: mc, swap, pts: m.follow.pts, edit: { node: m.id, index: ci } });
        }
      });
    }
    // the fitted dispersions over the map: of the metrics of these metrics, run along one of the map's axes
    if (response)
      for (const g of groups) {
        if (g.source !== `metrics:${axes[x].id}` && g.source !== `metrics:${axes[y].id}`) continue;
        const posAxis = g.source === `metrics:${axes[x].id}` ? x : y; // the branches are positions along it
        if (axes[posAxis === x ? y : x].id !== g.along) continue;
        const res = resultAt(g, baseIdx());
        g.metrics.forEach((m, mi) => {
          const d = res[mi]?.marks.disp;
          if (!m.on || !d) return;
          entries.push(entryOf(m, ['fit', 'start']));
          if (!spec.marks || isHidden(spec.hidden, m.id)) return;
          const show = m.fit?.show;
          const tr = (key: string, pos: number[], dash?: string) => traces.push({ key, x: posAxis === x ? pos : d.x, y: posAxis === x ? d.x : pos, color: '#ffffff', dash, width: dash ? 1.5 : 2.4 });
          if (show?.fitted !== false && !isHidden(spec.hidden, m.id, 'fit')) {
            tr(`dl${m.id}`, d.lower);
            tr(`du${m.id}`, d.upper);
          }
          if (show?.start !== false && !isHidden(spec.hidden, m.id, 'start')) {
            tr(`d1${m.id}`, d.mode1, '5 4');
            tr(`d2${m.id}`, d.mode2, '5 4');
          }
        });
      }
    const zm = metaOf(colorField);
    plot = (w) => (
      <MapPlot
        xAxis={axes[x]}
        yAxis={axes[y]}
        values={vals}
        zLabel={zm?.short ?? colorField}
        zUnit={zm?.unit ?? ''}
        zDomain={domainOf(colorField)}
        xLim={lim.x}
        yLim={lim.y}
        view={lim.z ? { zLim: lim.z } : undefined}
        width={w}
        height={420}
        traces={traces}
        zones={zones}
        polys={polys}
        onZone={(z, pts) => {
          const m = metrics.find((a) => a.id === z.key);
          if (m?.follow) setMetric(m.id, { follow: { ...m.follow, pts } });
        }}
        onPoly={(key, pts) => {
          const m = metrics.find((a) => a.id === key);
          const swap = alongMap?.along === axes[y].id;
          if (m?.follow) setMetric(m.id, { follow: { ...m.follow, poly: pts.map(([px, py]) => (swap ? [py, px] : [px, py])) } });
        }}
        draw={
          drawingM && draw && onDraw
            ? {
                color: metricColor(drawingM, mIndex(drawingM)),
                // stored as [along, other]
                pts: draw.pts.map(([a, o]) => (drawSwap ? [o, a] : [a, o])),
                onAdd: ([px, py]) =>
                  onDraw((d) => ({ pts: [...d.pts, drawSwap ? [+py.toPrecision(6), +px.toPrecision(6)] : [+px.toPrecision(6), +py.toPrecision(6)]], other: (drawSwap ? axes[x] : axes[y]).id })),
              }
            : undefined
        }
      />
    );
    csv = () =>
      exportCsv(
        [`${axes[y].label} \\ ${axes[x].label}`, ...axes[x].values.map((_, i) => valueText(axes[x], i))],
        axes[y].values.map((_, j) => [valueText(axes[y], j), ...Array.from({ length: nx }, (_, i) => vals[j * nx + i])]),
        `${name} ${spec.title || colorField} map`,
      );
  }

  const yItems = [...leftF.map((k) => ({ key: k, label: metaOf(k)?.short ?? k, flag: false })), ...right.map((k) => ({ key: k, label: metaOf(k)?.short ?? k, flag: true }))];

  return (
    <section className={`card${drawingM ? ' drawing-target' : ''}`} id={`plot-${spec.id}`}>
      {headOf(csv)}
      <div className="grid-fields plot-controls">
        <Field label="X" className={wide(axes.map((a) => a.label))}>
          <select value={axes[x].id} onChange={(e) => set({ x: e.target.value })}>
            {axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        {mapOk && (
          <Field label="Show">
            <Segmented<PlotSpec['mode']> value={mode} onChange={(m) => set({ mode: m })} options={[{ id: 'curves', label: 'Curves' }, { id: 'map', label: 'Map' }]} />
          </Field>
        )}
        {mode === 'map' ? (
          <>
            <Field label="Y" className={wide(axes.map((a) => a.label))}>
              <select value={axes[y].id} onChange={(e) => set({ y: e.target.value })}>
                {axes.map((a, i) => (i === x ? null : <option key={a.id} value={a.id}>{a.label}</option>))}
              </select>
            </Field>
            <Field label="Colour" className={wide(ds.meta.map((m) => m.label))}>
              <select value={colorField} onChange={(e) => set({ color: e.target.value })}>
                {ds.meta.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Y" className="span-2">
              <Chips
                items={yItems}
                all={ds.meta.map((m) => ({ key: m.key, label: `${m.label}${m.unit ? ` [${m.unit}]` : ''}` }))}
                onAdd={(k) => set({ left: [...left, k] })}
                onRemove={(k) => set({ left: leftF.filter((f) => f !== k), right: right.filter((f) => f !== k) })}
                toggle={{ label: (r) => (r ? 'right' : 'left'), title: 'Its Y axis: left or right — click to switch', set: (k, toRight) => set(toRight ? { left: leftF.filter((f) => f !== k), right: [...right, k] } : { right: right.filter((f) => f !== k), left: [...leftF, k] }) }}
              />
            </Field>
            {axes.length > 1 && (
              <Field label="One curve per" className={wide(axes.map((a) => `${a.label} (${a.values.length})`))}>
                <select value={series >= 0 ? axes[series].id : ''} onChange={(e) => set({ series: e.target.value })}>
                  <option value="">(one curve)</option>
                  {axes.map((a, i) => (i === x ? null : <option key={a.id} value={a.id}>{`${a.label} (${a.values.length})`}</option>))}
                </select>
              </Field>
            )}
          </>
        )}
        {seedAx >= 0 && (
          <Field className="span-2" label={`${axes[seedAx].label} (realizations)`} title="The seed of a rough profile is swept: one realization at a time (the slider), all of them, or their mean or median at every point. Only when a seed is a swept parameter.">
            <Segmented<NonNullable<PlotSpec['seedStat']>>
              value={seedStat}
              onChange={(v) => set({ seedStat: v })}
              options={[{ id: 'one', label: 'one' }, ...(mode === 'curves' ? [{ id: 'all' as const, label: 'all' }] : []), { id: 'mean', label: 'mean' }, { id: 'median', label: 'median' }]}
            />
          </Field>
        )}
        {free.map((i) => (
          <Field key={axes[i].id} label={`${axes[i].label} = ${valueText(axes[i], sliceOf(i))}`}>
            <input type="range" min={0} max={sizes[i] - 1} value={sliceOf(i)} aria-label={axes[i].label} onChange={(e) => set({ slices: { ...spec.slices, [axes[i].id]: Number(e.target.value) } })} />
          </Field>
        ))}
        <Field label="Overlays">
          <OverlayPicker entries={entries} on={spec.marks} setOn={(marks) => set({ marks })} hidden={spec.hidden} setHidden={(hidden) => set({ hidden })} />
        </Field>
      </div>
      {limitsOpen && (
        <div className="limits-panel">
          <LimRow label="X" lim={lim.x} set={(l) => setLim('x', l)} />
          <LimRow label="Y" lim={lim.y} set={(l) => setLim('y', l)} />
          {mode === 'curves' ? right.length > 0 && <LimRow label="Right Y" lim={lim.y2} set={(l) => setLim('y2', l)} /> : <LimRow label="Colour" lim={lim.z} set={(l) => setLim('z', l)} />}
          <button type="button" onClick={() => set({ lim: {} })}>Automatic</button>
        </div>
      )}
      {drawingM && <div className="msg inline small drawing-hint">{mode === 'map' ? `Drawing the region of ${drawingM.label}: click its corners on the map, then Confirm in the metric.` : `Drawing the ROI of ${drawingM.label}: drag across the plot, then Confirm in the metric.`}</div>}
      {plot && <AutoWidth figure={fig}>{plot}</AutoWidth>}
    </section>
  );
}
