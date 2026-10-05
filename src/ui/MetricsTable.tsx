// A table of metrics (the Compare page): the configurations as rows — a configuration with a sweep (or a map) one row
// per point of it, the points chosen — and the chosen results of their metrics as columns (every metric switched on:
// custom formulas, fits, metrics of metrics…). A metric is the same in every configuration when its name in formulas
// (ref) is (a copied configuration keeps them).
import { useState } from 'react';
import { useProject } from '../state.tsx';
import type { Config, MetricTableSpec } from '../model/project.ts';
import { quantitiesOf, type Metric } from '../model/metrics.ts';
import { scanAxisOf } from '../model/analysis.ts';
import { curveNumber, groupOf, type AnalysisGroup } from '../model/sweepAnalysis.ts';
import type { Axis } from '../engine/types.ts';
import { exportCsv } from '../plot/export.ts';
import { Chips, Icon, IconButton, Popover } from './kit.tsx';
import { QuantityPicker, type PickGroup } from './QuantityPicker.tsx';
import type { OtherData } from './useOtherConfigs.ts';

const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(5)) : '—');
const unitOf = (c: Config) => (scanAxisOf(c.sim) === 'theta' ? '°' : 'nm');
const valueText = (a: Axis, i: number) => (a.labels ? a.labels[i] : `${+a.values[i].toPrecision(6)}${a.unit ? (a.unit === '°' ? '°' : ` ${a.unit}`) : ''}`);
const MAX_ROWS = 400;

// The points of a configuration's data (every axis but its scan): their indices, a key and a label.
type Point = { key: string; at: Record<string, number>; label: string };
function pointsOf(c: Config, d: OtherData | undefined): { axes: Axis[]; points: Point[] } {
  if (d?.status !== 'done') return { axes: [], points: [{ key: '', at: {}, label: '' }] };
  const scan = scanAxisOf(c.sim);
  const axes = d.data.axes.filter((a) => a.id !== scan);
  const sizes = axes.map((a) => a.values.length);
  const count = sizes.reduce((p, n) => p * n, 1);
  const points: Point[] = [];
  for (let k = 0; k < Math.min(count, MAX_ROWS); k++) {
    let r = k;
    const idx = sizes.map(() => 0);
    for (let i = sizes.length - 1; i >= 0; i--) {
      idx[i] = r % sizes[i];
      r = Math.floor(r / sizes[i]);
    }
    points.push({ key: idx.join(','), at: Object.fromEntries(axes.map((a, i) => [a.id, idx[i]])), label: axes.map((a, i) => `${a.label} = ${valueText(a, idx[i])}`).join(' · ') });
  }
  return { axes, points };
}

// The result of a metric at a point (its group's curve through the point's indices; the axes it lacks at 0).
function resultAt(groups: AnalysisGroup[], m: Metric, at: Record<string, number>, key: string): number {
  const g = groupOf(groups, m);
  if (!g) return NaN;
  const idx = g.axes.map((a) => at[a.id] ?? 0);
  return g.results[curveNumber(g.axes.map((a) => a.values.length), g.alongIndex, idx)]?.[g.metrics.findIndex((x) => x.id === m.id)]?.values[key] ?? NaN;
}

// The points of a configuration shown in the table (all, or the ones ticked).
function PointsPicker({ c, points, chosen, set }: { c: Config; points: Point[]; chosen: string[] | undefined; set: (keys: string[] | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const on = (k: string) => !chosen || chosen.includes(k);
  const n = chosen ? points.filter((p) => chosen.includes(p.key)).length : points.length;
  return (
    <span className="popover-anchor">
      <button type="button" className="points-btn" onClick={() => setOpen(!open)} title={`The points of the sweep of “${c.name}” shown as rows`}>
        {c.name}: {n === points.length ? `all ${points.length} points` : `${n} of ${points.length} points`}
        <Icon name="chevronDown" size={13} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="points-pick">
          <div className="points-actions">
            <button type="button" className="link small" onClick={() => set(undefined)}>all</button>
            <button type="button" className="link small" onClick={() => set([])}>none</button>
          </div>
          {points.map((p) => (
            <label key={p.key} className="cand">
              <input type="checkbox" checked={on(p.key)} onChange={(e) => set(e.target.checked ? [...(chosen ?? []), p.key] : (chosen ?? points.map((q) => q.key)).filter((k) => k !== p.key))} />
              {p.label}
            </label>
          ))}
        </div>
      </Popover>
    </span>
  );
}

export function MetricsTable({ spec, set, remove, configs, datas }: { spec: MetricTableSpec; set: (patch: Partial<MetricTableSpec>) => void; remove: () => void; configs: Config[]; datas: Record<string, OtherData> }) {
  const { project } = useProject();
  const rowsCfg = configs.filter((c) => spec.configs.includes(c.id));
  // every metric switched on, one per ref (the first configuration that has it names it)
  const byRef = new Map<string, { m: Metric; c: Config }>();
  for (const c of configs) for (const m of c.metrics) if (m.on && !byRef.has(m.ref)) byRef.set(m.ref, { m, c });
  const metricIn = (c: Config, ref: string) => c.metrics.find((m) => m.on && m.ref === ref);
  const quantity = (col: string) => {
    const [ref, key] = col.split('|');
    const first = byRef.get(ref);
    const q = first ? quantitiesOf(first.m, scanAxisOf(first.c.sim) !== 'theta').find((x) => x.key === key) : undefined;
    return { label: `${first?.m.label ?? ref}: ${q?.label ?? key}`, unit: (c: Config) => q?.unit(unitOf(c)) ?? '' };
  };
  const valueOf = (c: Config, col: string, at: Record<string, number>): number => {
    const [ref, key] = col.split('|');
    const d = datas[c.id];
    const m = metricIn(c, ref);
    if (!m || d?.status !== 'done') return NaN;
    return resultAt(d.groups, m, at, key);
  };
  const groups: PickGroup[] = [...byRef.values()]
    .map(({ m, c }) => ({
      id: m.ref,
      title: `${m.label} · ${m.ref}${m.kind === 'custom' ? ' (formula)' : ''}`,
      items: quantitiesOf(m, scanAxisOf(c.sim) !== 'theta')
        .filter((q) => !spec.cols.includes(`${m.ref}|${q.key}`))
        .map((q) => ({ key: q.key, label: q.label, value: '' })),
    }))
    .filter((g) => g.items.length);
  // the rows: every configuration, one per chosen point of its sweep
  const per = rowsCfg.map((c) => ({ c, ...pointsOf(c, datas[c.id]) }));
  const rows = per.flatMap(({ c, points }) => points.filter((p) => !spec.points?.[c.id] || spec.points[c.id].includes(p.key)).map((p) => ({ c, p })));
  const swept = per.some((x) => x.points.length > 1);
  const setPoints = (id: string, keys: string[] | undefined) => {
    const next = { ...spec.points };
    if (keys) next[id] = keys;
    else delete next[id];
    set({ points: next });
  };
  const csv = () =>
    exportCsv(
      ['configuration', ...(swept ? ['point'] : []), ...spec.cols.map((col) => quantity(col).label)],
      rows.map(({ c, p }) => [c.name, ...(swept ? [p.label] : []), ...spec.cols.map((col) => valueOf(c, col, p.at))]),
      `${project.name} ${spec.title || 'metrics'}`,
    );
  return (
    <section className="card metrics-table-card">
      <div className="card-head">
        <input type="text" className="plot-title" value={spec.title ?? ''} placeholder="Table name" title="The name of this table" onChange={(e) => set({ title: e.target.value })} />
        <span className="sub muted small">the results of the metrics: a configuration with a sweep gives a row per point (choose them)</span>
        <span className="spacer" />
        <QuantityPicker label="Add a column" groups={groups} onPick={(ref, key) => set({ cols: [...spec.cols, `${ref}|${key}`] })} />
        <IconButton icon="download" label="The table as CSV" onClick={csv} disabled={!spec.cols.length} />
        <IconButton icon="x" label="Take this table away" onClick={remove} />
      </div>
      <div className="form-row metrics-table-rows">
        <span className="muted small">Configurations</span>
        <Chips items={rowsCfg.map((c) => ({ key: c.id, label: c.name }))} all={configs.map((c) => ({ key: c.id, label: c.name }))} onAdd={(k) => set({ configs: [...spec.configs, k] })} onRemove={(k) => set({ configs: spec.configs.filter((x) => x !== k) })} addLabel="Configuration" />
      </div>
      {per.some((x) => x.points.length > 1) && (
        <div className="form-row metrics-table-rows">
          <span className="muted small">Points of the sweeps</span>
          {per.filter((x) => x.points.length > 1).map(({ c, points }) => (
            <PointsPicker key={c.id} c={c} points={points} chosen={spec.points?.[c.id]} set={(keys) => setPoints(c.id, keys)} />
          ))}
        </div>
      )}
      {!spec.cols.length ? (
        <p className="muted">Add the columns: any result of a metric switched on — the position of a resonance, its width, the sensitivity, the FOM, a fit's parameter, a formula of yours (a custom metric)… A configuration without that metric shows —.</p>
      ) : (
        <div className="table-scroll">
          <table className="data metrics-table">
            <thead>
              <tr>
                <th>Configuration</th>
                {swept && <th>Point</th>}
                {spec.cols.map((col) => (
                  <th key={col} className="num">
                    <span className="metrics-col">
                      {quantity(col).label}
                      <button type="button" className="chip-x" aria-label={`Remove the column ${quantity(col).label}`} title="Remove this column" onClick={() => set({ cols: spec.cols.filter((x) => x !== col) })}>
                        <Icon name="x" size={11} />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, p }) => (
                <tr key={`${c.id}:${p.key}`}>
                  <td>{c.name}</td>
                  {swept && <td className="muted small">{p.label || '—'}</td>}
                  {spec.cols.map((col) => {
                    const st = datas[c.id]?.status;
                    const v = valueOf(c, col, p.at);
                    const u = quantity(col).unit(c);
                    return (
                      <td key={col} className="num" title={!metricIn(c, col.split('|')[0]) ? 'This configuration has no such metric (switched on)' : undefined}>
                        {st === 'computing' ? <span className="muted">…</span> : Number.isFinite(v) ? `${fmt(v)}${u ? (u === '°' ? '°' : ` ${u}`) : ''}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {per.some((x) => x.points.length >= MAX_ROWS) && <p className="muted small">At most {MAX_ROWS} points of a sweep are listed.</p>}
        </div>
      )}
    </section>
  );
}
