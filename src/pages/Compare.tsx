// The Compare page: every configuration of the project side by side — its stack, layers, interrogation, parameters and
// the optimizations applied to it — the compare plots (curves of any configuration on the same axes) and the views of
// one configuration each, side by side.
import { useRef, type ReactNode } from 'react';
import { useProject } from '../state.tsx';
import { addConfig, configsOf, switchConfig, updateConfig, type Config, type Project } from '../model/project.ts';
import { paramInfos, pointOf, sweepJobOf } from '../model/run.ts';
import { scanAxisOf } from '../model/analysis.ts';
import { POINT_META } from '../model/compute.ts';
import { PlotCard, type FieldInfo } from '../ui/PlotCard.tsx';
import { FieldCard } from './FieldCard.tsx';
import { expand } from '../model/structure.ts';
import { paramKey, type ParamRef } from '../model/params.ts';
import { sweepValues } from '../model/exposed.ts';
import { firstResult, groupOf, type AnalysisGroup } from '../model/sweepAnalysis.ts';
import { newCurve, newPlot, type PlotSpec } from '../model/sweep.ts';
import { listParams } from '../model/params.ts';
import { FigureTools } from '../plot/FigureTools.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { Board } from '../ui/Board.tsx';
import { CompareCard } from '../ui/CompareCard.tsx';
import { SgCompareCard } from '../ui/SgCompareCard.tsx';
import { MetricsTable } from '../ui/MetricsTable.tsx';
import type { MetricTableSpec } from '../model/project.ts';
import { Icon, IconButton, MenuButton } from '../ui/kit.tsx';
import { useOtherConfigs, type OtherData } from '../ui/useOtherConfigs.ts';
import { colorOf } from '../model/materials.ts';
import { StackDrawing } from './StackDrawing.tsx';
import type { PageId } from '../pages.ts';

const fmt = (v: number | string) => (typeof v === 'string' ? v : Number.isFinite(v) ? String(+v.toPrecision(6)) : '—');
const groupsOf = (d: OtherData | undefined): AnalysisGroup[] => (d?.status === 'done' ? d.groups : []);
const modeText = (c: Config) => {
  const s = c.sim;
  const how = s.mode === 'theta' ? `angular ${s.from}–${s.to}° at λ = ${s.lambda} nm` : s.mode === 'lambda' ? `spectral ${s.from}–${s.to} nm at θ = ${s.theta}°` : `map λ ${s.from}–${s.to} nm × θ ${s.tFrom ?? 0}–${s.tTo ?? 40}°`;
  return `${how}, ${s.pol === 'p' ? 'TM' : s.pol === 's' ? 'TE' : 'unpolarized'}`;
};
// the blocks an applied optimization changed
const touched = (refs: ParamRef[]) => new Set(refs.flatMap((r) => ('block' in r ? [r.block] : r.kind === 'medium' ? [r.which] : [])));

function ConfigCard({ c, current, onEdit, onRemoveRecord }: { c: Config; current: boolean; onEdit: () => void; onRemoveRecord: (id: string) => void }) {
  const { project, lib, models } = useProject();
  const fig = useRef<HTMLDivElement>(null);
  const ex = expand(c.structure, lib, models);
  const name = (id: string) => lib.get(id)?.name ?? id;
  const log = c.optLog ?? [];
  const optimized = touched(log.flatMap((r) => r.vars.map((v) => v.ref)));
  const infos = new Map(listParams(c.structure, c.sim, lib, true).map((x) => [x.key, x]));
  const params = c.params.filter((x) => x.ref.kind !== 'scan' && infos.has(paramKey(x.ref)));
  const tag = (block: string) => (optimized.has(block) ? <span className="tag-var">optimized</span> : null);
  const rows: ReactNode[] = [
    <tr key="in" className="medium"><td><span className="dot" style={{ background: colorOf(project.colors, lib, c.structure.incident.id) }} /> {name(c.structure.incident.id)}</td><td className="muted">incident</td><td>{tag('incident')}</td></tr>,
    ...c.structure.blocks.map((b) =>
      b.kind === 'film' ? (
        <tr key={b.id}>
          <td><span className="dot" style={{ background: colorOf(project.colors, lib, b.mat.id) }} /> {b.label || name(b.mat.id)}{b.label ? <span className="muted"> · {name(b.mat.id)}</span> : null}</td>
          <td className="num">{lib.get(b.mat.id)?.monolayer ? `${b.layers2D} L` : `${+b.d.toFixed(2)} nm`}</td>
          <td>{tag(b.id)}</td>
        </tr>
      ) : (
        <tr key={b.id}>
          <td><span className="dot" style={{ background: colorOf(project.colors, lib, b.period[0]?.mat.id ?? '') }} /> {b.label || 'DBR'}<span className="muted"> · ({b.period.map((p) => name(p.mat.id)).join(' / ')})×{b.periods}{b.cavities.length ? `, ${b.cavities.length} cavit${b.cavities.length === 1 ? 'y' : 'ies'}` : ''}</span></td>
          <td className="num">λ₀ {b.lambda0} nm</td>
          <td>{tag(b.id)}</td>
        </tr>
      ),
    ),
    <tr key="out" className="medium"><td><span className="dot" style={{ background: colorOf(project.colors, lib, c.structure.exit.id) }} /> {name(c.structure.exit.id)}</td><td className="muted">exit</td><td>{tag('exit')}</td></tr>,
  ];
  return (
    <article className={`config-card${current ? ' current' : ''}`}>
      <div className="card-head">
        <h3>{c.name}</h3>
        {current && <span className="tag-var">editing</span>}
        <span className="spacer" />
        <FigureTools target={fig} name={`${project.name} ${c.name} stack`} />
        <button type="button" onClick={onEdit} title="Edit this configuration (its Structure page)">
          <Icon name="pencil" size={14} />
          Edit
        </button>
      </div>
      <div className="muted small">{modeText(c)}</div>
      {ex.errors.length ? <div className="msg err">{ex.errors[0]}</div> : <AutoWidth figure={fig} max={420} min={220}>{(w) => <StackDrawing ex={ex} lib={lib} width={w} colors={project.colors} light={c.light} />}</AutoWidth>}
      <table className="data compact">
        <tbody>{rows}</tbody>
      </table>
      {params.length > 0 && (
        <div className="cfg-section">
          <div className="pick-title">Parameters</div>
          <ul className="cfg-list">
            {params.map((x) => {
              const info = infos.get(paramKey(x.ref))!;
              const u = info.unit ? ` ${info.unit}` : '';
              const vals = sweepValues(x, info);
              return (
                <li key={x.id}>
                  <b>{x.name}</b>{' '}
                  {c.sweep.axes.includes(x.id) && <span className="muted">swept: {vals.length} values{vals.length ? ` (${fmt(vals[0] as number | string)} … ${fmt(vals[vals.length - 1] as number | string)}${u})` : ''}</span>}
                  {x.opt.on && <span className="muted">{c.sweep.axes.includes(x.id) ? ' · ' : ''}optimized {info.material ? `among ${x.mats.length}` : `${fmt(x.opt.min)}–${fmt(x.opt.max)}${u}`}</span>}
                  {!x.opt.on && !c.sweep.axes.includes(x.id) && <span className="muted">now {typeof info.value === 'string' ? name(info.value) : `${fmt(info.value)}${u}`}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="cfg-section">
        <div className="pick-title">Optimizations applied</div>
        {!log.length && <div className="muted small">none</div>}
        {log
          .slice()
          .reverse()
          .map((r) => (
            <div key={r.id} className="opt-record">
              <div className="opt-record-head">
                <b>{r.algorithm}</b>
                <span className="muted small">{new Date(r.date).toLocaleString()}</span>
                <span className="spacer" />
                <IconButton icon="trash" label="Remove this record" onClick={() => onRemoveRecord(r.id)} />
              </div>
              <ul className="cfg-list">
                {r.vars.map((v) => (
                  <li key={v.name}>
                    {v.name}: <span className="muted">{fmt(v.from)}</span> → <b>{fmt(v.to)}</b>{v.unit ? ` ${v.unit}` : ''}
                  </li>
                ))}
                {r.goals.map((g, k) => (
                  <li key={k} className="muted">
                    {g.role === 'constraint' ? 'constraint' : g.goal === 'max' ? 'maximize' : g.goal === 'min' ? 'minimize' : g.goal === 'target' ? `reach ${g.target}` : `${g.goal === 'le' ? '≤' : '≥'} ${g.target}`} {g.label}: {fmt(g.start)} → <b className="text">{fmt(g.end)}</b>
                    {g.unit ? ` ${g.unit}` : ''}
                    {g.met !== undefined && (g.met ? <span className="ok-mark"> ✓</span> : <span className="bad-mark"> ✗</span>)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </article>
  );
}

// A view of one configuration (side by side with others): a plot of its data — its response, the values of its metrics
// along a swept parameter (their own X), maps — or the field inside its stack (a sweep: at its first point).
function ConfigView({ view, set, remove, data, configs }: { view: PlotSpec; set: (patch: Partial<PlotSpec>) => void; remove: () => void; data: OtherData | undefined; configs: Config[] }) {
  const { project, update, lib } = useProject();
  const c = configs.find((x) => x.id === view.config);
  const pick = (
    <select aria-label="Configuration" className="view-config" value={view.config} onChange={(e) => set({ config: e.target.value })}>
      {configs.map((x) => (
        <option key={x.id} value={x.id}>{x.name}</option>
      ))}
    </select>
  );
  if (!c || data?.status !== 'done')
    return (
      <section className="card">
        <div className="card-head">
          <input type="text" className="plot-title" value={view.title ?? ''} placeholder="Plot name" onChange={(e) => set({ title: e.target.value })} />
          {pick}
          <span className="spacer" />
          <IconButton icon="x" label="Take this view away" onClick={remove} />
        </div>
        <p className="muted">{!c ? 'Its configuration was deleted.' : data?.status === 'error' ? data.error : 'computing…'}</p>
      </section>
    );
  const { data: d, groups } = data;
  const scanAxis = scanAxisOf(c.sim);
  const unit = scanAxis === 'theta' ? '°' : 'nm';
  const fieldInfo = (k: string): FieldInfo => {
    if (k in POINT_META) return POINT_META[k as keyof typeof POINT_META];
    const dv = c.derived.find((x) => x.name === k);
    return { label: dv ? `${dv.name} = ${dv.expr}` : k, unit: dv?.unit ?? '' };
  };
  if (view.source === 'field') {
    // the structure of the configuration (a sweep: its first point), at a metric's position or at a value
    const structureAt = (metricId?: string) => {
      const m = metricId ? c.metrics.find((x) => x.id === metricId) : undefined;
      const g = m ? groupOf(groups, m) : undefined;
      const along = g?.source === 'response' ? g.alongIndex : d.axes.findIndex((a) => a.id === scanAxis);
      const job = sweepJobOf({ ...project, ...c } as Project, paramInfos(c, lib));
      const r = pointOf(c.structure, c.sim, job, d.axes.map(() => 0), along);
      return { structure: r.structure, it: { ...r.it, mode: (d.axes[along]?.id === 'theta' ? 'theta' : 'lambda') as Config['sim']['mode'] } };
    };
    const positionOf = (id: string) => {
      const m = c.metrics.find((x) => x.id === id);
      return m ? firstResult(groups, m)?.marks.x : undefined;
    };
    return <FieldCard spec={view} set={set} remove={remove} groups={groups} structureAt={structureAt} positionOf={positionOf} unit={unit} extraHead={pick} metrics={c.metrics} sim={c.sim} />;
  }
  return (
    <PlotCard
      spec={view}
      set={set}
      remove={remove}
      data={d}
      fieldInfo={fieldInfo}
      groups={groups}
      metrics={c.metrics}
      setMetric={(id, patch) => update((p) => updateConfig(p, c.id, (f) => ({ ...f, metrics: f.metrics.map((m) => (m.id === id ? { ...m, ...patch } : m)) })))}
      name={`${project.name} ${c.name}`}
      extraHead={pick}
    />
  );
}

export function Compare({ go }: { go: (id: PageId) => void }) {
  const { project, update } = useProject();
  const configs = configsOf(project);
  const datas = useOtherConfigs(configs.map((c) => c.id));
  const plots = project.compare?.plots ?? [];
  const setPlots = (next: PlotSpec[]) => update((p) => ({ ...p, compare: { ...p.compare, plots: next } }));
  const setPlot = (id: string, patch: Partial<PlotSpec>) => setPlots(plots.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const views = project.compare?.views ?? [];
  const tables = project.compare?.tables ?? [];
  const setTables = (next: MetricTableSpec[]) => update((p) => ({ ...p, compare: { ...p.compare, tables: next } }));
  const setViews = (next: PlotSpec[]) => update((p) => ({ ...p, compare: { ...p.compare, views: next } }));
  const removeRecord = (configId: string, id: string) =>
    update((p) => {
      if (configId === p.configId) return { ...p, optLog: (p.optLog ?? []).filter((r) => r.id !== id) };
      return { ...p, configs: p.configs.map((c) => (c.id === configId ? { ...c, optLog: (c.optLog ?? []).filter((r) => r.id !== id) } : c)) };
    });
  const addPlot = () => {
    const x = project.sim.mode === 'theta' ? 'theta' : 'lambda';
    setPlots([...plots, newPlot({ title: `Compare ${plots.length + 1}`, source: 'compare', x, left: [], curves: configs.map((c, i) => newCurve(c.id, { marks: true }, i)) })]);
  };

  return (
    <div className="compare-page">
      {configs.length < 2 && (
        <div className="msg warn compare-hint">
          One configuration: duplicate it (or add a new one) to compare structures, interrogations, metrics and optimizations side by side.
          <button type="button" onClick={() => update((p) => addConfig(p, 'copy'))}>
            <Icon name="copy" size={14} />
            Duplicate it
          </button>
        </div>
      )}
      <Board
        id="compare"
        className="compare"
        columns={[{ id: 'main' }]}
        items={[
          {
            key: 'configs',
            col: 'main',
            label: 'Configurations',
            node: (
              <section className="card configs-card">
                <div className="card-head">
                  <h2>Configurations</h2>
                  <span className="sub">{configs.length} configuration{configs.length === 1 ? '' : 's'} · layers modified by an applied optimization are tagged</span>
                </div>
                <div className="config-grid">
                  {configs.map((c) => (
                    <ConfigCard
                      key={c.id}
                      c={c}
                      current={c.id === project.configId}
                      onEdit={() => {
                        update((p) => switchConfig(p, c.id));
                        go('structure');
                      }}
                      onRemoveRecord={(id) => removeRecord(c.id, id)}
                    />
                  ))}
                </div>
              </section>
            ),
          },
          ...plots.map((pl) => ({
            key: `plot:${pl.id}`,
            col: 'main',
            label: pl.title || 'Compare',
            node: <CompareCard spec={pl} set={(patch) => setPlot(pl.id, patch)} remove={() => setPlots(plots.filter((x) => x.id !== pl.id))} datas={datas} name={project.name} />,
          })),
          {
            key: 'views',
            col: 'main',
            label: 'Side by side',
            node: (
              <section className="card views-card">
                <div className="card-head">
                  <h2>Side by side</h2>
                  <span className="sub">one configuration per view — its response, its metrics against a swept parameter, the field inside its stack — or a table of the metrics of all of them</span>
                  <span className="spacer" />
                  <MenuButton
                    label="Add a view"
                    align="right"
                    items={[
                      { key: 'table|', label: 'A table of metrics (every configuration)', hint: 'The results of chosen metrics side by side: the configurations as rows, the quantities as columns' },
                      ...configs.flatMap((c) => [
                      { key: `${c.id}|response`, label: `${c.name} · the response` },
                      { key: `${c.id}|field`, label: `${c.name} · the field inside the stack` },
                      ...(c.sweep.axes.length || c.sim.mode === 'map' ? [{ key: `${c.id}|metrics`, label: `${c.name} · the metrics against the swept parameter` }] : []),
                      ]),
                    ]}
                    onPick={(k) => {
                      if (k === 'table|') {
                        setTables([...tables, { id: `mt${Date.now().toString(36)}`, title: `Metrics ${tables.length + 1}`, configs: configs.map((c) => c.id), cols: [] }]);
                        return;
                      }
                      const [config, what] = k.split('|');
                      const c = configs.find((x) => x.id === config)!;
                      const groups = groupsOf(datas[config]);
                      const mg = groups.find((g) => g.source === 'response' && g.dataset.axes.length > 0);
                      const v =
                        what === 'field'
                          ? newPlot({ title: `${c.name}: field`, source: 'field', config, left: [], field: { ...c.sim.field, at: 'metric', metric: c.metrics.find((m) => m.on && !['custom', 'match', 'zones'].includes(m.kind))?.id ?? '' } })
                          : what === 'metrics'
                            ? // (its data not computed yet: the metrics along its scan, the key they will have)
                              newPlot({ title: `${c.name}: metrics`, source: mg?.key ?? `metrics:${scanAxisOf(c.sim)}`, config, left: [] })
                            : newPlot({ title: c.name, source: 'response', config, left: ['R'] });
                      setViews([...views, v]);
                    }}
                  />
                </div>
                {tables.map((t) => (
                  <MetricsTable key={t.id} spec={t} configs={configs} datas={datas} set={(patch) => setTables(tables.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))} remove={() => setTables(tables.filter((x) => x.id !== t.id))} />
                ))}
                {!views.length && !tables.length && <p className="muted">Add views to put the configurations side by side: the same kind of plot of each, e.g. the field profiles of a Tamm mode and of a surface plasmon, or each resonance against its swept thickness.</p>}
                <div className="compare-views">
                  {views.map((v) => (
                    <ConfigView key={v.id} view={v} configs={configs} data={datas[v.config ?? '']} set={(patch) => setViews(views.map((x) => (x.id === v.id ? { ...x, ...patch, ...(patch.config && patch.config !== x.config ? { source: x.source === 'field' ? 'field' : 'response', left: ['R'], right: [], slices: {} } : {}) } : x)))} remove={() => setViews(views.filter((x) => x.id !== v.id))} />
                  ))}
                </div>
              </section>
            ),
          },
          { key: 'sensorgrams', col: 'main', label: 'Sensorgrams', node: <SgCompareCard /> },
          {
            key: 'add-plot',
            col: 'main',
            label: 'Add a plot',
            fixed: true,
            node: (
              <div className="add-row">
                <button type="button" onClick={addPlot}>
                  <Icon name="plus" size={14} />
                  Add a compare plot
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}