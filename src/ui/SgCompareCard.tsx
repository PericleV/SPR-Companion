// The sensorgrams of several configurations side by side (the Compare page): each configuration's own experiment, or
// the current one's on every structure (the same analyte and protocol on different chips); one plot of a chosen
// quantity of the sensorgram, and a table of the change, the calibration and the detection limit of each.
import { useRef } from 'react';
import { useProject } from '../state.tsx';
import { configsOf, type CompareSg, type Config } from '../model/project.ts';
import { interrogationOf } from '../model/analysis.ts';
import { sgOf, type SgSettings } from '../model/sensorgram.ts';
import { sgKey, startSg, stopSg, useSgRuns, type SgRun } from '../workers/sgRuntime.ts';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { exportCsv } from '../plot/export.ts';
import { AutoWidth } from './AutoWidth.tsx';
import { Chips, Icon, Segmented, Switch } from './kit.tsx';

const COLORS = ['#2563eb', '#e07b39', '#7b5bd6', '#d9534f', '#4e79a7', '#e0a000', '#9c755f', '#b07aa1'];
const DASHES = ['', '6 4', '2 3', '8 3 2 3'];
const fmt = (v: number | undefined, d = 3) => (v !== undefined && Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');

export function SgCompareCard() {
  const { project, update, lib, models } = useProject();
  const all = configsOf(project);
  const cs: CompareSg = { configs: all.map((c) => c.id), show: 'shift', series: 'last', same: false, ...project.compare.sg };
  const setCs = (patch: Partial<CompareSg>) => update((p) => ({ ...p, compare: { ...p.compare, sg: { ...cs, ...p.compare.sg, ...patch } } }));
  const chosen = all.filter((c) => cs.configs.includes(c.id));
  const runs = useSgRuns();
  const fig = useRef<HTMLDivElement>(null);
  const settingsOf = (c: Config): SgSettings => (cs.same ? sgOf(project.sg) : sgOf(c.sg));
  const keyOf = (c: Config) => sgKey(c.structure, interrogationOf(c.sim), settingsOf(c), project.materials);
  // the run of a configuration: its own (the Sensorgram page) when it is up to date, else the Compare page's
  const runOf = (c: Config): { run?: SgRun; id: string; fresh: boolean } => {
    const k = keyOf(c);
    const own = runs[c.id];
    if (own && own.key === k) return { run: own, id: c.id, fresh: true };
    // (the same experiment on all and each its own: runs of their own, switching back and forth keeps both)
    const id = `cmp:${cs.same ? 'same:' : ''}${c.id}`;
    const r = runs[id];
    return { run: r, id, fresh: !!r && r.key === k };
  };
  const states = chosen.map((c) => ({ c, ...runOf(c) }));
  const running = states.some((s) => s.run?.status === 'running');
  const todo = states.filter((s) => !s.fresh || (s.run?.status !== 'done' && s.run?.status !== 'running'));
  const runAll = () => todo.forEach(({ c, id }) => startSg(id, project.materials, c.structure, interrogationOf(c.sim), settingsOf(c), lib, models, keyOf(c)));
  const stopAll = () => states.forEach(({ id }) => stopSg(id));

  // the quantity: any the results have (their own labels), the shift by default
  const done = states.filter((s) => s.fresh && s.run?.result);
  const metas = done.flatMap((s) => s.run!.result!.meta);
  const keys = [...new Set(metas.map((m) => m.key))];
  const show = keys.includes(cs.show) ? cs.show : (keys[0] ?? 'shift');
  const meta = metas.find((m) => m.key === show);
  const series: Series[] = done.flatMap(({ c, run }) => {
    const r = run!.result!;
    if (!r.fields[show]) return [];
    const ks = cs.series === 'last' ? [r.nK - 1] : Array.from({ length: r.nK }, (_, k) => k);
    return ks.map((k, m): Series => ({
      key: `${c.id}:${k}`,
      label: `${c.name}${r.nK > 1 ? ` · ${run!.kin.seriesLabel(k)}` : ''}`,
      color: COLORS[all.indexOf(c) % COLORS.length],
      dash: cs.series === 'all' ? DASHES[m % DASHES.length] || undefined : undefined,
      x: r.times,
      y: r.fields[show].subarray(k * r.nT, (k + 1) * r.nT), // (the first seed)
      width: 1.6,
    }));
  });
  const longest = done.reduce<number[]>((b, s) => (s.run!.result!.times.length > b.length ? s.run!.result!.times : b), []);
  const csv = () => {
    const head = ['configuration', 'largest change', 'at the end', 'per ng/mm²', 'per RIU', 'noise σ', 'LOD [RIU]', 'LOD [ng/mm²]', 'LOD [nM]'];
    exportCsv(head, done.map(({ c, run }) => {
      const s = run!.result!.summary;
      const k = run!.result!.nK - 1;
      return [c.name, s.peak[k], s.end[k], s.cal?.perG ?? NaN, s.cal?.perN ?? NaN, s.sigma ?? NaN, s.lodRIU ?? NaN, s.lodG ?? NaN, s.lodNM ?? NaN];
    }), `${project.name} sensorgrams`);
  };
  const status = (s: (typeof states)[number]) =>
    !s.run ? 'not run' : s.run.status === 'running' ? `computing ${Math.round((100 * s.run.done) / Math.max(1, s.run.total))} %` : s.run.status === 'error' ? s.run.message ?? 'error' : !s.fresh ? 'out of date' : s.run.status === 'stopped' ? 'stopped' : 'done';

  return (
    <section className="card views-card sg-compare">
      <div className="card-head">
        <h2>Sensorgrams</h2>
        <span className="sub">the binding experiment on each configuration: the signal, the calibration and the detection limit side by side</span>
      </div>
      <div className="form-row">
        <Chips
          items={chosen.map((c) => ({ key: c.id, label: c.name }))}
          all={all.map((c) => ({ key: c.id, label: c.name }))}
          onAdd={(k) => setCs({ configs: [...cs.configs, k] })}
          onRemove={(k) => setCs({ configs: cs.configs.filter((x) => x !== k) })}
          addLabel="Configuration"
        />
        <Switch checked={cs.same} onChange={(same) => setCs({ same })} label={`the same experiment on all (that of “${all.find((c) => c.id === project.configId)?.name}”)`} title="On: the analyte, the kinetics, the read-out and the instrument of the configuration being edited, on every structure. Off: each configuration's own (its Sensorgram page)." />
        <span className="spacer" />
        {running ? (
          <button type="button" onClick={stopAll}>Stop</button>
        ) : (
          <button type="button" className="primary" disabled={!todo.length} onClick={runAll} title={todo.length ? 'Compute the sensorgrams not computed or out of date' : 'Every sensorgram is up to date'}>
            <Icon name="play" size={14} />
            Run{todo.length && todo.length < chosen.length ? ` (${todo.length})` : ''}
          </button>
        )}
      </div>
      <div className="card-head">
        {keys.length > 0 && (
          <select aria-label="Quantity" value={show} onChange={(e) => setCs({ show: e.target.value })}>
            {keys.map((k) => (
              <option key={k} value={k}>{metas.find((m) => m.key === k)!.label}</option>
            ))}
          </select>
        )}
        <Segmented value={cs.series} options={[{ id: 'last', label: 'last series', title: 'The last value of each configuration’s series (e.g. the highest concentration)' }, { id: 'all', label: 'every series' }]} onChange={(series) => setCs({ series })} />
        <span className="spacer" />
        {series.length > 0 && <FigureTools target={fig} name={`${project.name} sensorgrams`} csv={() => exportCsv(['t [s]', ...series.map((s) => `${s.label} ${meta?.short ?? show}`)], longest.map((t, j) => [t, ...series.map((s) => (s.x && s.x[j] === t ? s.y[j] : NaN))]), `${project.name} sensorgrams`)} />}
      </div>
      {series.length ? (
        <AutoWidth figure={fig}>{(w) => <LinePlot xAxis={{ id: 'time', label: 't', unit: 's', values: longest }} series={series} yLabel={meta?.short ?? show} yUnit={meta?.unit ?? ''} width={w} height={300} />}</AutoWidth>
      ) : (
        <p className="muted">{running ? 'computing…' : chosen.length ? 'Run to compute the sensorgram of each configuration.' : 'Add configurations to compare.'}</p>
      )}
      {series.length > 0 && (
        <div className="tol-legend muted small">
          {series.map((s) => (
            <span key={s.key}>
              <i className={s.dash ? 'dashed' : ''} style={s.dash ? { borderColor: s.color } : { background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      {chosen.length > 0 && (
        <div className="table-scroll">
          <table className="data sg-compare-table">
            <thead>
              <tr>
                <th>Configuration</th>
                <th>Status</th>
                <th className="num" title="The largest change of the read-out (the last series)">Largest change</th>
                <th className="num">At the end</th>
                <th className="num" title="Read-out per ng/mm² bound (1000 RU), exact at the start">per ng/mm²</th>
                <th className="num" title="Read-out per RIU of the buffer, exact at the start">per RIU</th>
                <th className="num" title="Noise of the read-out over the first, analyte-free step">σ</th>
                <th className="num" title="Detection limit 3σ / (per RIU)">LOD [RIU]</th>
                <th className="num" title="Detection limit 3σ / (per ng/mm²)">LOD [ng/mm²]</th>
                <th className="num" title="The concentration whose equilibrium response is the detection limit (1:1)">LOD [nM]</th>
              </tr>
            </thead>
            <tbody>
              {states.map((s) => {
                const r = s.fresh ? s.run?.result : undefined;
                const sm = r?.summary;
                const k = (r?.nK ?? 1) - 1;
                const u = r?.unit === '°' ? '°' : r?.unit ? ` ${r.unit}` : '';
                return (
                  <tr key={s.c.id}>
                    <td><span className="dot" style={{ background: COLORS[all.indexOf(s.c) % COLORS.length] }} /> {s.c.name}</td>
                    <td className="muted small">{status(s)}</td>
                    <td className="num">{sm ? `${fmt(sm.peak[k], 4)}${u}` : '—'}</td>
                    <td className="num">{sm ? `${fmt(sm.end[k], 4)}${u}` : '—'}</td>
                    <td className="num">{sm?.cal?.perG !== undefined ? `${fmt(sm.cal.perG)}${u}` : '—'}</td>
                    <td className="num">{sm?.cal ? `${fmt(sm.cal.perN)}${u}` : '—'}</td>
                    <td className="num">{sm?.sigma !== undefined ? `${fmt(sm.sigma, 2)}${u}` : '—'}</td>
                    <td className="num">{sm?.lodRIU !== undefined ? sm.lodRIU.toExponential(1) : '—'}</td>
                    <td className="num">{fmt(sm?.lodG, 2)}</td>
                    <td className="num">{sm?.irreversible ? 'any (irreversible)' : fmt(sm?.lodNM, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {done.length > 0 && (
        <div className="form-row">
          <span className="muted small">{states.some((s) => s.fresh && s.run?.result && s.run.result.seeds[0] === 0) ? 'The detection limit needs the detector noise (the Instrument of the Sensorgram page) and an analyte-free first step.' : ''}</span>
          <span className="spacer" />
          <button type="button" onClick={csv}>
            <Icon name="download" size={14} />
            Table CSV
          </button>
        </div>
      )}
    </section>
  );
}
