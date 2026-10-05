// A compare plot (the Compare page): any curves of any configuration on the same X — the response (R, T, A, phases,
// the computed quantities) or the values of the metrics along an axis — each on the left or the right Y axis, in its
// colour, at chosen values of its other axes; each curve opens on its configuration and its metrics (their values on
// that curve, which of them are drawn over it).
import { Fragment, useRef, useState } from 'react';
import type { Axis, Dataset } from '../engine/types.ts';
import { useProject } from '../state.tsx';
import { configsOf, type Config } from '../model/project.ts';
import { POINT_META } from '../model/compute.ts';
import { describe, expand } from '../model/structure.ts';
import { newCurve, type CompareCurve, type PlotSpec } from '../model/sweep.ts';
import { curveNumber, sourceLabel, type AnalysisGroup, type SweepData } from '../model/sweepAnalysis.ts';
import { KIND_LABEL, quantitiesOf, type Metric, type MetricResult } from '../model/metrics.ts';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import type { Overlay } from '../plot/overlays.ts';
import { FigureTools } from '../plot/FigureTools.tsx';
import { exportCsv } from '../plot/export.ts';
import { AutoWidth } from './AutoWidth.tsx';
import { BoundField } from './MetricsEditor.tsx';
import { metricOverlays, partsOf } from './metricOverlays.ts';
import { OverlayPicker } from './OverlayPicker.tsx';
import { metricColor } from './roiColor.ts';
import type { OtherData } from './useOtherConfigs.ts';
import { Field, Icon, IconButton, Segmented } from './kit.tsx';

const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(6)) : '—');

type Props = {
  spec: PlotSpec;
  set: (patch: Partial<PlotSpec>) => void;
  remove?: () => void;
  datas: Record<string, OtherData>; // every configuration's data (computed in a worker)
  name: string;
};

// A configuration's data a curve is taken from: its response or the values of its metrics along an axis.
type Source = { ds: Dataset; groups: AnalysisGroup[]; group?: AnalysisGroup; data: SweepData };
function datasetOf(c: Config, data: SweepData, groups: AnalysisGroup[], source: string): Source | null {
  if (source === 'response') {
    const meta = Object.keys(data.fields).map((k) => {
      const pm = POINT_META[k as keyof typeof POINT_META];
      const d = c.derived.find((x) => x.name === k);
      return { key: k, label: pm?.label ?? (d ? `${d.name} = ${d.expr}` : k), short: k, unit: pm?.unit ?? d?.unit ?? '' };
    });
    return { ds: { key: 'response', axes: data.axes, fields: data.fields, meta, size: data.size }, groups, data };
  }
  const g = groups.find((x) => x.key === source && x.dataset.axes.length > 0);
  return g ? { ds: g.dataset, groups, group: g, data } : null;
}

export function CompareCard({ spec, set, remove, datas, name }: Props) {
  const { project, lib, models } = useProject();
  const fig = useRef<HTMLDivElement>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [openCurve, setOpenCurve] = useState<string | null>(null);
  const configs = configsOf(project);
  const curves = spec.curves ?? [];
  const setCurve = (id: string, patch: Partial<CompareCurve>) => set({ curves: curves.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const lim = spec.lim ?? {};
  const setLim = (k: 'x' | 'y' | 'y2', v: [number, number]) => set({ lim: { ...lim, [k]: v } });

  // each curve's data (or why there is none yet)
  const stateOf = (c: CompareCurve): { src?: Source; note?: string; config?: Config } => {
    const config = configs.find((x) => x.id === c.config);
    if (!config) return { note: 'its configuration was removed' };
    const o = datas[c.config];
    if (!o || o.status === 'computing') return { config, note: 'computing…' };
    if (o.status === 'error') return { config, note: o.error };
    const src = datasetOf(config, o.data, o.groups, c.source);
    return src ? { src, config } : { config, note: 'no such data (a sweep or a map is needed for the values of the metrics)' };
  };
  const states = curves.map(stateOf);

  // X: an axis of the curves' data (λ, θ, a swept parameter …)
  const axisChoices: Axis[] = [];
  for (const s of states) for (const a of s.src?.ds.axes ?? []) if (!axisChoices.some((b) => b.id === a.id)) axisChoices.push(a);
  const xId = axisChoices.some((a) => a.id === spec.x) ? spec.x : (axisChoices[axisChoices.length - 1]?.id ?? spec.x);
  const xAxis = axisChoices.find((a) => a.id === xId);

  // per curve: its values, its indices, the metrics of its configuration along X on it (their results there)
  type Drawn = { s: Series; side: 'left' | 'right'; unit: string; label: string; metrics: { m: Metric; r?: MetricResult; ci: number }[] };
  const drawn = new Map<string, Drawn>();
  const overlays: Overlay[] = [];
  const notes: string[] = [];
  curves.forEach((c, k) => {
    const st = states[k];
    const cname = st.config?.name ?? '?';
    if (!st.src) {
      notes.push(`${cname} · ${c.y}: ${st.note}`);
      return;
    }
    const { ds } = st.src;
    const xi = ds.axes.findIndex((a) => a.id === xId);
    if (xi < 0) {
      notes.push(`${cname} · ${c.y}: no ${xAxis?.label ?? xId} in its data`);
      return;
    }
    const f = ds.fields[c.y];
    if (!f) {
      notes.push(`${cname}: no ${c.y} in its data`);
      return;
    }
    const sizes = ds.axes.map((a) => a.values.length);
    const st2 = sizes.map((_, i) => sizes.slice(i + 1).reduce((p, n) => p * n, 1));
    const idx = ds.axes.map((a, i) => (i === xi ? 0 : Math.min(sizes[i] - 1, Math.max(0, c.at[a.id] ?? 0))));
    const y = new Float64Array(sizes[xi]);
    for (let i = 0; i < sizes[xi]; i++) {
      idx[xi] = i;
      y[i] = f[idx.reduce((s, v, j) => s + v * st2[j], 0)];
    }
    const meta = ds.meta.find((m) => m.key === c.y);
    const at = ds.axes
      .map((a, i) => (i === xi || sizes[i] < 2 ? '' : `${a.label} = ${a.labels ? a.labels[idx[i]] : +a.values[idx[i]].toPrecision(5)}${a.unit && !a.labels ? ` ${a.unit}` : ''}`))
      .filter(Boolean)
      .join(', ');
    const label = `${cname} · ${meta?.short ?? c.y}${at ? ` (${at})` : ''}`;
    // the configuration's metrics along X on this curve
    const srcKey = st.src.group ? st.src.group.key : 'response';
    const g = st.src.groups.find((x) => x.source === srcKey && x.along === xId);
    let ms: Drawn['metrics'] = [];
    if (g) {
      const gi = g.axes.map((a) => {
        const j = ds.axes.findIndex((b) => b.id === a.id);
        return j >= 0 ? idx[j] : 0;
      });
      const res: MetricResult[] = g.results[curveNumber(g.axes.map((a) => a.values.length), g.alongIndex, gi)] ?? [];
      ms = g.metrics
        .map((m, i) => ({ m, r: res[i], ci: st.config!.metrics.findIndex((q) => q.id === m.id) }))
        .filter(({ m }) => m.on && m.kind !== 'custom' && (m.kind === 'zones' || (m.field && !['sens', 'fom'].includes(m.kind) ? m.field : 'R') === c.y));
      if (c.marks && c.side === 'left')
        overlays.push(
          ...metricOverlays(
            ms.map((q) => q.m),
            ms.map((q) => q.r),
            { unit: xAxis?.unit ?? '', spectral: xId === 'lambda', shift: false, fit: true, text: false, xs: ds.axes[xi].values, colorIndex: (i) => ms[i].ci, hidden: c.hidden },
          ).map((o) => ({ ...o, key: `${c.id}:${o.key}` })),
        );
    }
    drawn.set(c.id, { s: { key: c.id, label, color: c.color, x: ds.axes[xi].values, y, dots: sizes[xi] < 30 }, side: c.side, unit: meta?.unit ?? '', label: meta?.short ?? c.y, metrics: ms });
  });
  const series = curves.flatMap((c) => (drawn.has(c.id) ? [drawn.get(c.id)!] : []));
  const left = series.filter((x) => x.side === 'left');
  const right = series.filter((x) => x.side === 'right');
  const yInfo = (l: typeof series) => ({ label: [...new Set(l.map((x) => x.label))].join(', '), unit: [...new Set(l.map((x) => x.unit))].length === 1 ? l[0].unit : '' });
  const csv = () => {
    if (!xAxis) return;
    const n = Math.max(0, ...series.map((x) => x.s.y.length));
    exportCsv(
      series.flatMap((x) => [`${x.s.label}: ${xAxis.label}${xAxis.unit ? ` [${xAxis.unit}]` : ''}`, x.s.label]),
      Array.from({ length: n }, (_, i) => series.flatMap((x) => [x.s.x?.[i] ?? '', x.s.y[i] ?? ''])),
      `${name} ${spec.title || 'compare'}`,
    );
  };
  const add = () => {
    const last = curves[curves.length - 1];
    const config = configs.find((c) => !curves.some((q) => q.config === c.id))?.id ?? last?.config ?? project.configId;
    set({ curves: [...curves, newCurve(config, { source: last?.source ?? 'response', y: last?.y ?? 'R', marks: true }, curves.length)] });
  };
  const summary = (c: Config) => {
    const ex = expand(c.structure, lib, models);
    const s = c.sim;
    return `${ex.errors.length ? ex.errors[0] : describe(ex, lib)} · ${s.mode === 'theta' ? `angular at ${s.lambda} nm` : s.mode === 'lambda' ? `spectral at ${s.theta}°` : 'map λ × θ'}, ${s.pol === 'p' ? 'TM' : s.pol === 's' ? 'TE' : 'unpolarized'}`;
  };

  return (
    <section className="card compare-card" id={`plot-${spec.id}`}>
      <div className="card-head">
        <input type="text" className="plot-title" value={spec.title ?? ''} placeholder="Plot name" title="The name of this plot" onChange={(e) => set({ title: e.target.value })} />
        <span className="spacer" />
        <IconButton icon="settings" label="Axis limits" active={limitsOpen} onClick={() => setLimitsOpen(!limitsOpen)} />
        <FigureTools target={fig} name={`${name} ${spec.title || 'compare'}`} csv={csv} />
        {remove && <IconButton icon="x" label="Remove this plot" onClick={remove} />}
      </div>
      <div className="grid-fields plot-controls">
        <Field label="X">
          <select value={xId} onChange={(e) => set({ x: e.target.value })} disabled={!axisChoices.length}>
            {axisChoices.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
            {!axisChoices.length && <option value={xId}>—</option>}
          </select>
        </Field>
      </div>
      <div className="table-scroll">
        <table className="data compare-curves">
          <thead>
            <tr><th /><th>Configuration</th><th>Data</th><th>Y</th><th>Axis</th><th>At</th><th>Metrics</th><th /></tr>
          </thead>
          <tbody>
            {curves.map((c, k) => {
              const st = states[k];
              const d = datas[c.config];
              const cfgGroups = st.src?.groups ?? (d?.status === 'done' ? d.groups : []);
              const sources = [{ key: 'response', label: 'Response' }, ...cfgGroups.filter((g) => g.dataset.axes.length > 0).map((g) => ({ key: g.key, label: sourceLabel(g, cfgGroups) }))];
              if (!sources.some((s) => s.key === c.source)) sources.push({ key: c.source, label: c.source.replace(/^metrics:/, 'the metrics along ') });
              const ds = st.src?.ds;
              const ys = ds ? ds.meta : [{ key: c.y, label: c.y, short: c.y, unit: '' }];
              const xi = ds ? ds.axes.findIndex((a) => a.id === xId) : -1;
              const extra = ds ? ds.axes.map((a, i) => ({ a, i })).filter(({ a, i }) => i !== xi && a.values.length > 1) : [];
              const info = drawn.get(c.id);
              const open = openCurve === c.id;
              return (
                <Fragment key={c.id}>
                  <tr className={open ? 'open' : ''}>
                    <td>
                      <span className="color-dot" style={{ background: c.color }} title="Its colour">
                        <input type="color" aria-label="Curve colour" value={c.color} onChange={(e) => setCurve(c.id, { color: e.target.value })} />
                      </span>
                    </td>
                    <td>
                      <select aria-label="Configuration" value={c.config} onChange={(e) => setCurve(c.id, { config: e.target.value, at: {}, hidden: [] })}>
                        {configs.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label="Data" value={c.source} onChange={(e) => setCurve(c.id, { source: e.target.value, y: e.target.value === 'response' ? 'R' : '', at: {} })}>
                        {sources.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label="Y" value={c.y} onChange={(e) => setCurve(c.id, { y: e.target.value })}>
                        {!ys.some((m) => m.key === c.y) && <option value={c.y}>{c.y || '—'}</option>}
                        {ys.map((m) => (
                          <option key={m.key} value={m.key}>{m.label}{m.unit ? ` [${m.unit}]` : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Segmented<'left' | 'right'> value={c.side} onChange={(side) => setCurve(c.id, { side })} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
                    </td>
                    <td className="at-cell">
                      {extra.map(({ a }) => (
                        <select key={a.id} aria-label={a.label} title={a.label} value={Math.min(a.values.length - 1, c.at[a.id] ?? 0)} onChange={(e) => setCurve(c.id, { at: { ...c.at, [a.id]: Number(e.target.value) } })}>
                          {a.values.map((v, j) => (
                            <option key={j} value={j}>{`${a.label} = ${a.labels ? a.labels[j] : `${+v.toPrecision(5)}${a.unit ? ` ${a.unit}` : ''}`}`}</option>
                          ))}
                        </select>
                      ))}
                      {!extra.length && <span className="muted small">{st.src ? '—' : st.note}</span>}
                    </td>
                    <td>
                      <button type="button" className="curve-metrics-btn" aria-expanded={open} onClick={() => setOpenCurve(open ? null : c.id)} title="Its configuration and metrics; what is drawn over it">
                        {info ? `${info.metrics.length} metric${info.metrics.length === 1 ? '' : 's'}` : '—'}
                        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
                      </button>
                    </td>
                    <td className="row-actions">
                      <IconButton icon="x" label="Remove the curve" onClick={() => set({ curves: curves.filter((x) => x.id !== c.id) })} />
                    </td>
                  </tr>
                  {open && (
                    <tr className="curve-panel">
                      <td />
                      <td colSpan={7}>
                        {st.config && <div className="muted small curve-config">{summary(st.config)}</div>}
                        {info && info.metrics.length > 0 ? (
                          <>
                            <table className="data curve-metrics">
                              <thead>
                                <tr><th>Metric</th><th>Kind</th><th>Results on this curve</th></tr>
                              </thead>
                              <tbody>
                                {info.metrics.map(({ m, r, ci }) => {
                                  const qs = quantitiesOf(m, xId === 'lambda').slice(0, 4);
                                  return (
                                    <tr key={m.id}>
                                      <td><span className="dot" style={{ background: metricColor(m, ci) }} /> {m.label} <span className="mono muted">{m.ref}</span></td>
                                      <td className="muted">{KIND_LABEL[m.kind]}</td>
                                      <td>
                                        {qs.map((q) => (
                                          <span key={q.key} className="q-val">
                                            <span className="muted">{q.label}</span> <b>{fmt(r?.values[q.key] ?? NaN)}</b>{q.unit(xAxis?.unit ?? '') ? ` ${q.unit(xAxis?.unit ?? '')}` : ''}
                                          </span>
                                        ))}
                                        {r?.error && <span className="warn-dot" title={r.error}>!</span>}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div className="curve-overlays">
                              <span className="muted small">Drawn over the curve{c.side === 'right' ? ' (curves on the left axis only)' : ''}:</span>
                              <OverlayPicker
                                entries={info.metrics.map(({ m, ci }) => ({ id: m.id, label: m.label, color: metricColor(m, ci), parts: partsOf(m) }))}
                                on={!!c.marks}
                                setOn={(marks) => setCurve(c.id, { marks })}
                                hidden={c.hidden}
                                setHidden={(hidden) => setCurve(c.id, { hidden })}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="muted small">{info ? 'No metric of its configuration is measured on this quantity along this X.' : st.note}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="add-row compare-add">
        <button type="button" onClick={add}>
          <Icon name="plus" size={14} />
          Add curve
        </button>
      </div>
      {limitsOpen && (
        <div className="limits-panel">
          {(['x', 'y', 'y2'] as const).map((k) => (
            <span key={k} className="lim">
              <BoundField label={`${k === 'y2' ? 'Right Y' : k.toUpperCase()} min`} value={lim[k]?.[0] ?? NaN} onChange={(v) => setLim(k, [v, lim[k]?.[1] ?? NaN])} />
              <BoundField label={`${k === 'y2' ? 'Right Y' : k.toUpperCase()} max`} value={lim[k]?.[1] ?? NaN} onChange={(v) => setLim(k, [lim[k]?.[0] ?? NaN, v])} />
            </span>
          ))}
          <button type="button" onClick={() => set({ lim: {} })}>Automatic</button>
        </div>
      )}
      {notes.map((n) => (
        <div key={n} className="muted small compare-note">{n}</div>
      ))}
      {xAxis && series.length > 0 && (
        <>
          <AutoWidth figure={fig}>
            {(w) => (
              <LinePlot
                xAxis={xAxis}
                series={left.map((x) => x.s)}
                series2={right.map((x) => x.s)}
                yLabel={yInfo(left).label}
                yUnit={yInfo(left).unit}
                y2Label={right.length ? yInfo(right).label : ''}
                y2Unit={right.length ? yInfo(right).unit : ''}
                xLim={lim.x}
                yLim={lim.y}
                y2Lim={lim.y2}
                width={w}
                height={360}
                overlays={overlays}
              />
            )}
          </AutoWidth>
          <div className="legend">
            {series.map((x) => (
              <span key={x.s.key}>
                <span className="line-key" style={{ background: x.s.color }} /> {x.s.label}
                {x.side === 'right' ? ' (right)' : ''}
              </span>
            ))}
          </div>
        </>
      )}
      {!curves.length && <p className="muted">Add the curves to compare: from any configuration, its response or the values of its metrics.</p>}
    </section>
  );
}
