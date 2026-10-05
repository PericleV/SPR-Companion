// Simulation page: the interrogation (an angular or a spectral scan, or a dispersion map over λ and θ), optionally for
// every combination of swept parameters; every computed quantity (R, T, A, phases, the complex amplitudes) and the
// computed quantities (formulas); the metrics on every curve (and metrics of their values); any number of named plots
// (curves on two Y axes, maps, slices, the metrics' overlays, ROIs drawn on them); the field inside the stack. One scan
// (or map) is computed as the project changes; a sweep when Run is pressed.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../state.tsx';
import { POINT_META, type Pol } from '../model/compute.ts';
import type { SimSettings } from '../model/project.ts';
import { paramKey } from '../model/params.ts';
import type { Exposed } from '../model/exposed.ts';
import { interrogationOf, scanAxisOf } from '../model/analysis.ts';
import { FIELDS, layout, MAX_POINTS, newPlot, placeBlock, sizeOf, type FieldKey, type PlotSpec, type SweepBlock, type SweepJob, type SweepSettings } from '../model/sweep.ts';
import { curveNumber, curveOf, groupOf, sourceLabel, type AnalysisGroup, type SweepData } from '../model/sweepAnalysis.ts';
import { withNewMetric, type Metric, type MetricResult } from '../model/metrics.ts';
import { useOpenRows } from '../ui/useOpenRows.ts';
import type { Derived } from '../model/derived.ts';
import { pointOf, sweepDataOf, sweepJobOf, sweptOf } from '../model/run.ts';
import { analyzeLatest, Pool, sweepLatest } from '../workers/client.ts';
import { exportCsv } from '../plot/export.ts';
import { NumberField } from '../ui/NumberField.tsx';
import { ValuesBlock } from '../ui/ParamsPanel.tsx';
import { Chips, Field, Icon, IconButton, MenuButton, Segmented, Switch } from '../ui/kit.tsx';
import { sweepValues } from '../model/exposed.ts';
import { useParamInfos } from '../ui/useParamInfos.ts';
import { PlotCard, type FieldInfo } from '../ui/PlotCard.tsx';
import { MetricsEditor, type MetricSource } from '../ui/MetricsEditor.tsx';
import { FieldCard } from './FieldCard.tsx';
import { Board } from '../ui/Board.tsx';
import type { RoiDraw } from '../ui/roiDraw.ts';

const now = () => performance.now();
const AUTO_POINTS = 120_000; // larger maps are computed on Run
const MODES: { id: SimSettings['mode']; label: string; title: string }[] = [
  { id: 'theta', label: 'Angular', title: 'R(θ) at a fixed wavelength' },
  { id: 'lambda', label: 'Spectral', title: 'R(λ) at a fixed angle' },
  { id: 'map', label: 'Map λ × θ', title: 'A dispersion map: every λ at every θ' },
];

export function Simulation() {
  const { project, update, lib } = useProject();
  const s = project.sim;
  const sw = project.sweep;
  const infos = useParamInfos();
  const set = (patch: Partial<SimSettings>) => update((p) => ({ ...p, sim: { ...p.sim, ...patch } }));
  const setSw = (patch: Partial<SweepSettings>) => update((p) => ({ ...p, sweep: { ...p.sweep, ...patch } }));
  const setX = (id: string, patch: Partial<Exposed>) => update((p) => ({ ...p, params: p.params.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const setMetric = (id: string, patch: Partial<Metric>) => update((p) => ({ ...p, metrics: p.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const scanAxis = scanAxisOf(s);
  const [editAxis, setEditAxis] = useState<string | null>(null);
  const { open, setOpen } = useOpenRows();

  // the swept parameters (exposed structural parameters; λ and θ are the interrogation's)
  const { usable, axes } = sweptOf(project, infos);
  const total0 = s.points * (s.mode === 'map' ? (s.tPoints ?? 81) : 1);
  // a sweep, or a large map: computed on Run (one scan or a small map: as the project changes)
  const sweeping = axes.length > 0 || total0 > AUTO_POINTS;
  const job: SweepJob = useMemo(() => sweepJobOf(project, infos), [project.structure, project.sim, project.params, sw.axes, sw.fields, project.metrics, infos]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobKey = JSON.stringify({ ...job, structure: project.structure, materials: project.materials });
  const total = sizeOf(job);

  // ---- the computation: one scan (or map) automatically, a sweep on Run ----
  const [raw, setRaw] = useState<{ key: string; job: SweepJob; fields: Record<string, Float64Array>; shifts: Float64Array[]; seconds: number; error?: string; stopped?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const pool = useRef<Pool | null>(null);
  const stopFlag = useRef(false);

  const assemble = (j: SweepJob, blocks: SweepBlock[]) => {
    const n = sizeOf(j);
    const fields = Object.fromEntries(j.fields.map((f) => [f, new Float64Array(n).fill(NaN)])) as Record<FieldKey, Float64Array>;
    const sh = j.shifts.map(() => new Float64Array(n).fill(NaN));
    blocks.forEach((b) => placeBlock(j, b, fields, sh));
    return { fields: fields as Record<string, Float64Array>, shifts: sh, error: blocks.find((b) => b.error)?.error };
  };

  // one scan: as the project changes (auto) or on Run (tick)
  const auto = s.auto !== false;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (sweeping) return;
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      const t0 = now();
      sweepLatest({ type: 'sweep', materials: project.materials, job, outers: [0] })
        .then((blocks) => {
          if (!alive || !blocks) return;
          setRaw({ key: jobKey, job, ...assemble(job, blocks), seconds: (now() - t0) / 1000 });
          setBusy(false);
          setError('');
        })
        .catch((e: Error) => alive && (setBusy(false), setError(e.message)));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [auto ? jobKey : '', tick, sweeping]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setError('');
    const arrays = job.fields.length + job.shifts.length;
    if (total * arrays > MAX_POINTS) return setError(`${total.toLocaleString()} points × ${arrays} arrays: at most ${MAX_POINTS.toLocaleString()} values (fewer values or points, fewer quantities kept).`);
    const p = new Pool();
    pool.current = p;
    stopFlag.current = false;
    const t0 = now();
    const { outerCount } = layout(job);
    const per = Math.max(1, Math.ceil(outerCount / (p.size * 4)));
    const chunks: number[][] = [];
    for (let k = 0; k < outerCount; k += per) chunks.push(Array.from({ length: Math.min(per, outerCount - k) }, (_, j) => k + j));
    const blocks: SweepBlock[] = [];
    let done = 0;
    setProgress(0);
    try {
      await Promise.all(
        chunks.map((idx) =>
          p.run<SweepBlock[]>({ type: 'sweep', materials: project.materials, job, outers: idx }).then((bs) => {
            blocks.push(...bs);
            done += idx.length;
            setProgress(done / outerCount);
          }),
        ),
      );
    } catch (e) {
      if (!stopFlag.current) setError(e instanceof Error ? e.message : String(e));
    }
    p.terminate();
    pool.current = null;
    setProgress(null);
    setRaw({ key: jobKey, job, ...assemble(job, blocks), seconds: (now() - t0) / 1000, stopped: stopFlag.current });
  };
  const stop = () => {
    stopFlag.current = true;
    pool.current?.terminate();
  };

  // ---- the data: the response, the computed quantities, the metrics ----
  const usableRaw = raw && raw.job.axes.map((a) => a.id).join() === job.axes.map((a) => a.id).join() ? raw : null;
  const stale = !!usableRaw && (sweeping || !auto) && usableRaw.key !== jobKey;
  const derivedRes = useMemo(() => (usableRaw ? sweepDataOf(project, usableRaw.job, usableRaw.fields, usableRaw.shifts, infos, lib) : null), [usableRaw, project.derived, project.params, infos]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = derivedRes?.data ?? null;

  // the structure of a curve (its swept values), for the metrics that need it (incident index, field)
  // the metrics on every curve, in a worker (the latest request; the page stays responsive)
  const [analysed, setAnalysed] = useState<{ data: SweepData; groups: AnalysisGroup[] } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const metricsKey = JSON.stringify(project.metrics);
  useEffect(() => {
    if (!data || !usableRaw) return;
    let alive = true;
    const t = setTimeout(() => {
    setAnalysing(true);
    analyzeLatest({ type: 'analyze', materials: project.materials, structure: project.structure, it: interrogationOf(s), job: usableRaw.job, data, metrics: project.metrics })
      .then((g) => {
        if (!alive || !g) return;
        setAnalysed({ data, groups: g });
        setAnalysing(false);
      })
      .catch((e: Error) => alive && (setAnalysing(false), setError(e.message)));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [data, metricsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => (analysed && analysed.data === data ? analysed.groups : []), [analysed, data]);

  // the curve whose values the metrics show: the one chosen in a plot (its sliders)
  const [valuesFrom, setValuesFrom] = useState('');
  const vPlot = sw.plots.find((p) => p.id === valuesFrom && p.source !== 'field' && p.source !== 'compare') ?? sw.plots.find((p) => p.source !== 'field' && p.source !== 'compare');
  const sel = (id: string, n: number) => Math.min(n - 1, Math.max(0, vPlot?.slices[id] ?? 0));
  const curveIn = (g: AnalysisGroup) => curveNumber(g.axes.map((a) => a.values.length), g.alongIndex, g.axes.map((a) => sel(a.id, a.values.length)));
  const shownResults: (MetricResult | undefined)[] = project.metrics.map((m) => {
    const g = groupOf(groups, m);
    return g?.results[curveIn(g)]?.[g.metrics.findIndex((x) => x.id === m.id)];
  });
  // a metric's curve (for Guess): its field along its axis at the chosen curve
  const dataOf = (m: Metric) => {
    const g = groupOf(groups, m);
    if (!g || !data) return null;
    const fields = g.source === 'response' ? data.fields : groups.find((x) => x.key === g.source)?.dataset.fields;
    const arr = fields?.[m.field ?? 'R'] ?? fields?.R;
    if (!arr) return null;
    const sizes = g.axes.map((a) => a.values.length);
    return { xs: g.axes[g.alongIndex].values, R: curveOf(arr as Float64Array, sizes, g.alongIndex, g.axes.map((a) => sel(a.id, a.values.length))) };
  };
  // the data the metrics can reduce: the response, the values of the metrics on it along an axis
  const numeric = (list: { id: string; label: string; unit: string; labels?: string[] }[]) => list.filter((a) => !a.labels).map((a) => ({ id: a.id, label: a.label, unit: a.unit }));
  const sources: MetricSource[] = [
    { key: 'response', label: 'the response', axes: data ? numeric(data.axes) : [{ id: scanAxis, label: scanAxis === 'theta' ? 'θ' : 'λ', unit: scanAxis === 'theta' ? '°' : 'nm' }], fields: data ? Object.keys(data.fields) : ['R'], defaultAlong: scanAxis },
    ...groups.filter((g) => g.source === 'response' && g.dataset.axes.length).map((g) => ({ key: g.key, label: sourceLabel(g, groups), axes: numeric(g.dataset.axes), fields: Object.keys(g.dataset.fields), defaultAlong: g.dataset.axes[0].id })),
  ];

  // the ROI being drawn (started and confirmed in a metric, drawn on a plot)
  const [roiDraw, setRoiDraw] = useState<RoiDraw | null>(null);
  const plotsFor = (m: Metric) => {
    const g = groupOf(groups, m);
    if (!g || !data) return [];
    return sw.plots.flatMap((pl, i) => {
      if ((pl.source || 'response') !== g.source) return [];
      const ax = g.source === 'response' ? data.axes : (groups.find((x) => x.key === pl.source)?.dataset.axes ?? []);
      if (!ax.length) return [];
      const x = ax.some((a) => a.id === pl.x) ? pl.x : ax[ax.length - 1].id;
      const map = pl.mode === 'map' && ax.length >= 2;
      const y = map ? (ax.some((a) => a.id === pl.y) && pl.y !== x ? pl.y : ax.find((a) => a.id !== x)!.id) : '';
      return x === g.along || (map && y === g.along) ? [{ id: pl.id, label: pl.title || `Plot ${i + 1}`, map }] : [];
    });
  };
  const confirmRoi = () => {
    const d = roiDraw;
    if (!d) return;
    if (d.pts.length >= 3 && d.other) setMetric(d.metric, { follow: { param: d.other, pts: [], poly: d.pts } });
    else if (Number.isFinite(d.lo) && Number.isFinite(d.hi)) setMetric(d.metric, { lo: d.lo!, hi: d.hi!, follow: undefined });
    setRoiDraw(null);
  };

  const fieldInfo = (k: string): FieldInfo => {
    if (k in POINT_META) return POINT_META[k as keyof typeof POINT_META];
    const d = project.derived.find((x) => x.name === k);
    return { label: d ? `${d.name} = ${d.expr}` : k, unit: d?.unit ?? '' };
  };
  const setPlot = (id: string, patch: Partial<PlotSpec>) => setSw({ plots: sw.plots.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  // the swept parameters
  const moveAxis = (i: number, j: number) => {
    if (j < 0 || j >= sw.axes.length) return;
    const next = sw.axes.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setSw({ axes: next });
  };
  const csvAll = () => {
    if (!data) return;
    const sz = data.axes.map((a) => a.values.length);
    const rows: (string | number)[][] = [];
    for (let k = 0; k < data.size; k++) {
      let rem = k;
      const idx: number[] = [];
      for (let i = sz.length - 1; i >= 0; i--) {
        idx[i] = rem % sz[i];
        rem = Math.floor(rem / sz[i]);
      }
      rows.push([...idx.map((j, i) => (data.axes[i].labels ? data.axes[i].labels![j] : data.axes[i].values[j])), ...Object.values(data.fields).map((f) => f[k]), ...data.shifts.map((x) => x.R[k])]);
    }
    exportCsv([...data.axes.map((a) => `${a.label}${a.unit ? ` [${a.unit}]` : ''}`), ...Object.keys(data.fields), ...data.shifts.map((x) => `R(n+dn) ${x.key}`)], rows, `${project.name} data`);
  };

  // the field plots: the structure of the chosen curve, at a metric's position along its axis (or a value along the scan)
  const structureAt = (metricId?: string) => {
    if (!usableRaw || !data) return null;
    const fieldMetric = metricId ? project.metrics.find((m) => m.id === metricId) : undefined;
    const fieldGroup = fieldMetric ? groupOf(groups, fieldMetric) : undefined;
    const along = fieldGroup?.source === 'response' ? fieldGroup.alongIndex : data.axes.findIndex((a) => a.id === scanAxis);
    const idx = data.axes.map((a) => sel(a.id, a.values.length));
    const r = pointOf(project.structure, s, usableRaw.job, idx, along);
    return { structure: r.structure, it: { ...r.it, mode: (data.axes[along]?.id === 'theta' ? 'theta' : 'lambda') as SimSettings['mode'] } };
  };
  const unit = scanAxis === 'theta' ? '°' : 'nm';
  // the names a computed quantity can use: the computed data, the axes, the swept parameters
  const formulaNames = [
    ...job.fields.map((k) => ({ key: k as string, label: POINT_META[k as FieldKey]?.label ?? k })),
    ...(s.mode === 'map' ? ['lambda', 'theta'] : [scanAxis]).map((id) => ({ key: id, label: id === 'theta' ? 'the angle θ [°]' : 'the wavelength λ [nm]' })),
    ...axes.map((x) => ({ key: x.id, label: x.name })),
  ];

  return (
    <Board
      id="simulation"
      className="sim"
      columns={[{ id: 'main' }]}
      items={[
        {
          key: 'interrogation',
          col: 'main',
          label: 'Interrogation',
          node: (
      <section className="card">
        <div className="card-head">
          <h2>Interrogation</h2>
          <Segmented<SimSettings['mode']>
            value={s.mode}
            onChange={(mode) => set(mode === 'theta' ? { mode, from: 40, to: 85 } : mode === 'lambda' ? { mode, from: 400, to: 1000 } : { mode, from: 400, to: 1000, points: Math.min(s.points, 601), tFrom: s.tFrom ?? 0, tTo: s.tTo ?? 40, tPoints: s.tPoints ?? 81 })}
            options={MODES.map((m) => ({ id: m.id, label: m.label, title: m.title }))}
          />
          <span className="spacer" />
          {busy && !sweeping && <span className="busy">computing…</span>}
          {analysing && <span className="busy">metrics…</span>}
        </div>
        <div className="grid-fields">
          {s.mode === 'theta' && <NumberField label="Wavelength λ" unit="nm" value={s.lambda} onChange={(v) => set({ lambda: v })} min={1} />}
          {s.mode === 'lambda' && <NumberField label="Angle θ" unit="°" value={s.theta} onChange={(v) => set({ theta: v })} min={0} max={89.999} />}
          <NumberField label={s.mode === 'map' ? 'λ from' : 'From'} unit={unit} value={s.from} onChange={(v) => set({ from: v })} />
          <NumberField label="To" unit={unit} value={s.to} onChange={(v) => set({ to: v })} />
          <NumberField label="Points" value={s.points} onChange={(v) => set({ points: Math.round(v) })} min={2} max={200000} />
          {s.mode === 'map' && (
            <>
              <NumberField label="θ from" unit="°" value={s.tFrom ?? 0} onChange={(v) => set({ tFrom: v })} min={0} max={89.999} />
              <NumberField label="To" unit="°" value={s.tTo ?? 40} onChange={(v) => set({ tTo: v })} min={0} max={89.999} />
              <NumberField label="Angles" value={s.tPoints ?? 81} onChange={(v) => set({ tPoints: Math.max(1, Math.round(v)) })} min={1} max={5000} />
            </>
          )}
          <Field label="Polarization">
            <Segmented<Pol>
              value={s.pol}
              onChange={(pol) => set({ pol })}
              options={[
                { id: 'p', label: 'TM', title: 'p-polarized' },
                { id: 's', label: 'TE', title: 's-polarized' },
                { id: 'u', label: 'Unpol.', title: 'unpolarized: the mean of TM and TE' },
              ]}
            />
          </Field>
        </div>

        <div className="sub-head">
          <h3>Sweep</h3>
          <span className="sub">{axes.length ? `${axes.length} parameter${axes.length === 1 ? '' : 's'}: a ${s.mode === 'map' ? 'map' : 'curve'} per combination` : `none: one ${s.mode === 'map' ? 'map' : 'scan'}`}</span>
          <span className="spacer" />
          <MenuButton
            label="Parameter"
            align="right"
            title={usable.length ? 'Sweep a parameter over its values' : 'No parameters yet: add them on the Structure page'}
            disabled={!usable.some((x) => !sw.axes.includes(x.id))}
            items={usable.filter((x) => !sw.axes.includes(x.id)).map((x) => ({ key: x.id, label: x.name }))}
            onPick={(id) => setSw({ axes: [...sw.axes, id] })}
          />
        </div>
        {axes.length > 0 && (
          <table className="data sweep-table">
            <tbody>
              {axes.map((x, i) => {
                const info = infos.get(paramKey(x.ref));
                const vals = info ? sweepValues(x, info) : [];
                return (
                  <Fragment key={x.id}>
                    <tr>
                      <td className="no">{i + 1}</td>
                      <td>{x.name}</td>
                      <td className="muted small">{vals.length} value{vals.length === 1 ? '' : 's'}{vals.length ? `: ${vals.slice(0, 3).map((v) => (typeof v === 'number' ? +v.toPrecision(5) : (lib.get(v)?.name ?? v))).join(', ')}${vals.length > 3 ? ' …' : ''}` : ''}</td>
                      <td className="row-actions">
                        <IconButton icon="pencil" label="Edit the values" active={editAxis === x.id} onClick={() => setEditAxis(editAxis === x.id ? null : x.id)} />
                        <IconButton icon="up" label="Move up (outer loop)" disabled={i === 0} onClick={() => moveAxis(sw.axes.indexOf(x.id), sw.axes.indexOf(axes[i - 1].id))} />
                        <IconButton icon="down" label="Move down" disabled={i === axes.length - 1} onClick={() => moveAxis(sw.axes.indexOf(x.id), sw.axes.indexOf(axes[i + 1].id))} />
                        <IconButton icon="x" label="Stop sweeping it" onClick={() => setSw({ axes: sw.axes.filter((a) => a !== x.id) })} />
                      </td>
                    </tr>
                    {editAxis === x.id && info && (
                      <tr className="sub-row">
                        <td />
                        <td colSpan={3}>
                          <ValuesBlock x={x} info={info} set={(patch) => setX(x.id, patch)} sweepOn setSweepOn={(on) => !on && setSw({ axes: sw.axes.filter((a) => a !== x.id) })} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {axes.length > 0 && (
          <div className="form-row">
            <Field label="Keep for every point" title="The quantities kept for every point (R always)">
              <Chips
                items={['R' as FieldKey, ...sw.fields.filter((f) => f !== 'R')].map((f) => ({ key: f, label: POINT_META[f].label }))}
                all={FIELDS.map((f) => ({ key: f, label: POINT_META[f].label }))}
                onAdd={(k) => setSw({ fields: [...sw.fields, k as FieldKey] })}
                onRemove={(k) => k !== 'R' && setSw({ fields: sw.fields.filter((f) => f !== k) })}
              />
            </Field>
          </div>
        )}
        <div className="run-row">
          {progress === null ? (
            <button type="button" className="primary" onClick={sweeping ? run : () => setTick((k) => k + 1)} title={sweeping ? `${total.toLocaleString()} points (${job.axes.map((a) => a.values.length).join(' × ')})` : 'Compute now'}>
              <Icon name="play" size={14} /> Run simulation{sweeping ? ` · ${total.toLocaleString()} points` : ''}
            </button>
          ) : (
            <>
              <button type="button" onClick={stop}>Stop</button>
              <progress value={progress} max={1} />
              <span className="muted">{(100 * progress).toFixed(0)} %</span>
            </>
          )}
          {!sweeping && <Switch checked={auto} onChange={(v) => set({ auto: v })} label="Update automatically" title="Recompute as the project changes (off: on Run only)" />}
          {usableRaw && progress === null && <span className="muted small">{usableRaw.job.axes.reduce((p, a) => p * a.values.length, 1).toLocaleString()} points in {usableRaw.seconds.toFixed(1)} s{usableRaw.stopped ? ' (stopped)' : ''}</span>}
          {stale && <span className="msg warn inline">The setup changed: run again.</span>}
        </div>
        {(error || usableRaw?.error) && <div className="msg err">{error || usableRaw?.error}</div>}
      </section>
          ),
        },
        { key: 'derived', col: 'main', label: 'Custom values', node: <DerivedCard errors={derivedRes?.errors ?? {}} names={formulaNames} /> },
        ...(!data && sweeping && progress === null
          ? [
              {
                key: 'press-run',
                col: 'main',
                label: 'Run',
                node: (
                  <section className="card">
                    <p className="muted">Press <b>Run simulation</b> to compute the {total.toLocaleString()} points of the sweep: the plots and the values of the metrics appear here.</p>
                  </section>
                ),
              },
            ]
          : []),
        ...(data
          ? sw.plots.map((pl) => ({
              key: `plot:${pl.id}`,
              col: 'main',
              label: pl.title || 'Plot',
              node:
                pl.source === 'field' ? (
                  <FieldCard
                    spec={pl}
                    set={(patch) => setPlot(pl.id, patch)}
                    remove={sw.plots.length > 1 ? () => setSw({ plots: sw.plots.filter((x) => x.id !== pl.id) }) : undefined}
                    groups={groups}
                    structureAt={structureAt}
                    positionOf={(id) => shownResults[project.metrics.findIndex((m) => m.id === id)]?.marks.x}
                    unit={unit}
                  />
                ) : (
                  <PlotCard
                    spec={pl}
                    set={(patch) => setPlot(pl.id, patch)}
                    remove={sw.plots.length > 1 ? () => setSw({ plots: sw.plots.filter((x) => x.id !== pl.id) }) : undefined}
                    data={data}
                    fieldInfo={fieldInfo}
                    groups={groups}
                    metrics={project.metrics}
                    setMetric={setMetric}
                    name={project.name}
                    csvAll={pl.source === 'response' ? csvAll : undefined}
                    draw={roiDraw?.plot === pl.id ? roiDraw : null}
                    onDraw={(patch) => setRoiDraw((d) => (d ? { ...d, ...patch(d) } : d))}
                  />
                ),
            }))
          : []),
        ...(data
          ? [
              {
                key: 'add-plot',
                col: 'main',
                label: 'Add a plot',
                fixed: true,
                node: (
                  <div className="add-row">
                    <button type="button" onClick={() => setSw({ plots: [...sw.plots, newPlot({ title: `Plot ${sw.plots.length + 1}`, x: scanAxis, left: ['R'] })] })}>
                      <Icon name="plus" size={14} />
                      Add a plot
                    </button>
                  </div>
                ),
              },
            ]
          : []),
        {
          key: 'metrics',
          col: 'main',
          label: 'Metrics',
          node: (
            <section className="card">
              <div className="card-head">
                <h2>Metrics</h2>
                <span className="sub">resonance position and width, sensitivity, figures of merit and fitted parameters of each spectrum</span>
                <span className="spacer" />
                {data && data.axes.length > 1 && sw.plots.length > 0 && (
                  <select
                    aria-label="The curve whose values the metrics show"
                    title={`The metrics show the values of the curve chosen in this plot: ${data.axes.filter((a) => a.id !== scanAxis).map((a) => `${a.label} = ${a.labels ? a.labels[sel(a.id, a.values.length)] : `${+a.values[sel(a.id, a.values.length)].toPrecision(6)}${a.unit ? ` ${a.unit}` : ''}`}`).join(' · ')}`}
                    value={vPlot?.id ?? ''}
                    onChange={(e) => setValuesFrom(e.target.value)}
                  >
                    {sw.plots.filter((p) => p.source !== 'field' && p.source !== 'compare').map((p, i) => <option key={p.id} value={p.id}>{`Values on the curve of “${p.title || `Plot ${i + 1}`}”`}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const next = withNewMetric(project.metrics);
                    update((p) => ({ ...p, metrics: next }));
                    setOpen(next[next.length - 1].id, true);
                  }}
                >
                  <Icon name="plus" size={14} />
                  Add metric
                </button>
              </div>
              <MetricsEditor
                metrics={project.metrics}
                set={(metrics) => update((p) => ({ ...p, metrics }))}
                results={shownResults}
                sources={sources}
                dataOf={dataOf}
                plotsFor={plotsFor}
                draw={roiDraw}
                onDraw={(d) => {
                  setRoiDraw(d);
                  // the plot to draw on, brought into view
                  if (d) document.getElementById(`plot-${d.plot}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                onConfirm={confirmRoi}
                open={open}
                setOpen={setOpen}
              />
            </section>
          ),
        },
      ]}
    />
  );
}


// The computed quantities: formulas of the computed fields (and the axis values, and the quantities above them). The
// names a formula can use are buttons that insert them where the cursor is; common quantities are one click away.
const PRESETS: { key: string; label: string; name: string; expr: string; unit: string }[] = [
  { key: 'phr', label: 'Phase of r', name: 'phase_r', expr: 'arg(rRe, rIm)', unit: '°' },
  { key: 'pht', label: 'Phase of t', name: 'phase_t', expr: 'arg(tRe, tIm)', unit: '°' },
  { key: 'mr', label: '|r| (amplitude)', name: 'abs_r', expr: 'mag(rRe, rIm)', unit: '' },
  { key: 'mt', label: '|t| (amplitude)', name: 'abs_t', expr: 'mag(tRe, tIm)', unit: '' },
  { key: 'loss', label: 'Loss 1 − R − T', name: 'loss', expr: '1 - R - T', unit: '' },
  { key: 'rdb', label: 'R in dB', name: 'R_dB', expr: '10 * log10(R)', unit: 'dB' },
  { key: 'new', label: 'An empty formula', name: '', expr: '', unit: '' },
];
let derivedCount = 0;
const newDerivedId = () => `d${Date.now().toString(36)}${derivedCount++}`;
const FUNCS = ['arg(', 'mag(', 'abs(', 'sqrt(', 'log10(', 'exp(', 'min(', 'max(', 'pow('];

function DerivedCard({ errors, names }: { errors: Record<string, string>; names: { key: string; label: string }[] }) {
  const { project, update } = useProject();
  const list = project.derived;
  const setList = (derived: Derived[]) => update((p) => ({ ...p, derived }));
  const setD = (i: number, patch: Partial<Derived>) => setList(list.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  // the formula being edited and its cursor (where a name is inserted)
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focus, setFocus] = useState<{ row: number; pos: number }>({ row: -1, pos: 0 });
  const row = focus.row >= 0 && focus.row < list.length ? focus.row : list.length - 1;
  const insert = (text: string) => {
    if (row < 0) return;
    const expr = list[row].expr;
    const pos = focus.row === row ? Math.min(focus.pos, expr.length) : expr.length;
    const glue = pos > 0 && /[\w)]$/.test(expr.slice(0, pos)) && !text.startsWith(')') ? ' ' : '';
    const next = `${expr.slice(0, pos)}${glue}${text}${expr.slice(pos)}`;
    setD(row, { expr: next });
    const at = pos + glue.length + text.length;
    setFocus({ row, pos: at });
    requestAnimationFrame(() => {
      const el = inputs.current[row];
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  };
  const own = list.map((d) => d.name).filter(Boolean);
  const add = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    let name = p.name || `q${list.length + 1}`;
    for (let k = 2; own.includes(name) || names.some((n) => n.key === name); k++) name = `${p.name || 'q'}${k}`;
    setList([...list, { id: newDerivedId(), name, expr: p.expr, unit: p.unit }]);
    setFocus({ row: list.length, pos: p.expr.length });
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Custom values</h2>
        <span className="sub">user-defined functions of R, T, A, the phases and amplitudes</span>
        <span className="spacer" />
        <MenuButton primary align="right" label="Add value" items={PRESETS.map((p) => ({ key: p.key, label: p.expr ? `${p.label} · ${p.expr}` : p.label }))} onPick={add} />
      </div>
      {!list.length && <p className="muted">No custom values: add one (a phase, a loss 1 − R − T, R in dB …) to plot it like R or T, or to measure it with a metric.</p>}
      {list.length > 0 && (
        <>
          <table className="data derived">
            <thead>
              <tr><th>Name</th><th>Formula</th><th>Unit</th><th /></tr>
            </thead>
            <tbody>
              {list.map((d, i) => (
                <tr key={d.id} className={row === i ? 'editing' : ''}>
                  <td><input type="text" className="short" aria-label="Name" value={d.name} onChange={(e) => setD(i, { name: e.target.value })} /></td>
                  <td className="formula-cell">
                    <input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      type="text"
                      aria-label="Formula"
                      className={errors[d.name] ? 'bad' : ''}
                      value={d.expr}
                      placeholder="click the names below, or type"
                      onFocus={(e) => setFocus({ row: i, pos: e.target.selectionStart ?? d.expr.length })}
                      onSelect={(e) => setFocus({ row: i, pos: e.currentTarget.selectionStart ?? d.expr.length })}
                      onChange={(e) => {
                        setD(i, { expr: e.target.value });
                        setFocus({ row: i, pos: e.target.selectionStart ?? e.target.value.length });
                      }}
                    />
                    {errors[d.name] && <div className="err-text small">{errors[d.name]}</div>}
                  </td>
                  <td><input type="text" className="tiny" aria-label="Unit" value={d.unit} onChange={(e) => setD(i, { unit: e.target.value })} /></td>
                  <td className="row-actions"><IconButton icon="x" label="Remove" onClick={() => setList(list.filter((_, k) => k !== i))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tokens" aria-label="Insert into the formula">
            <span className="tokens-title">Insert into {list[row]?.name || 'the formula'}:</span>
            {[...names, ...own.filter((_, k) => k < row).map((n) => ({ key: n, label: n }))].map((n) => (
              <button key={n.key} type="button" className="token" title={n.label} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(n.key)}>
                {n.key}
              </button>
            ))}
            <span className="tokens-sep" />
            {FUNCS.map((fn) => (
              <button key={fn} type="button" className="token fn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(fn)}>
                {fn})
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}