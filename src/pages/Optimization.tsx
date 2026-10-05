// Optimization page: (1) the parameters with “Optimize” on (Variables) searched by spr-forge's optimizers for goals built
// from any result of the metrics — objectives (the total cost is minimized) and constraints C1, C2… (must hold);
// (2) SPR sensors designed by a genetic algorithm over layer sequences. The results are applied on request.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../state.tsx';
import { ALGORITHMS, isConstraint, newObjective, optRecordOf, rankSolutions, RANK_METHODS, valuesAt, type RankCriterion, type RankFilter, type RankMethod, variablesOf, violationOf, type Algorithm, type EvalJob, type Objective, type OptSettings } from '../model/optimization.ts';
import { quantitiesOf, type MetricResult } from '../model/metrics.ts';
import { metricOverlays, partsOf } from '../ui/metricOverlays.ts';
import { metricColor } from '../ui/roiColor.ts';
import { OverlayPicker } from '../ui/OverlayPicker.tsx';
import type { Overlay } from '../plot/overlays.ts';
import { applyParams, paramKey } from '../model/params.ts';
import type { Exposed } from '../model/exposed.ts';
import { valuesLatest, valuesOnce } from '../workers/client.ts';
import type { ValuesResult } from '../workers/protocol.ts';
import { interrogationOf } from '../model/analysis.ts';
import { clearOpt, pauseOpt, resumeOpt, startOpt, stopOpt, useOptRun, warmOpt } from '../workers/optRuntime.ts';
import { LinePlot } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { SortTable } from '../ui/SortTable.tsx';
import { ParamDialog } from '../ui/ParamsPanel.tsx';
import { Chips, Field, Icon, IconButton, MenuButton, Segmented, Switch } from '../ui/kit.tsx';
import { hasRandomRough } from '../model/structure.ts';
import { clearRunView, MAX_CHECKED, nextColor, useRunView } from '../ui/runView.ts';
import { exportCsv } from '../plot/export.ts';
import { useParamInfos } from '../ui/useParamInfos.ts';
import { LAMBDA_AXIS, THETA_AXIS } from '../model/compute.ts';
import type { MetricGoal } from '../engine/objectives.ts';
import { mergeParams, type AlgoParams as AlgoParamsT, type Crossover, type CrossoverType, type DeStrategy, type Mutation, type MutationType } from '../engine/optimize.ts';
import { SprDesigner } from './SprDesigner.tsx';
import { Board } from '../ui/Board.tsx';
import { QuantityPicker as GoalPicker, type PickGroup } from '../ui/QuantityPicker.tsx';

const GOALS_OBJ: { id: MetricGoal; label: string; title: string }[] = [
  { id: 'max', label: 'Max', title: 'Maximize' },
  { id: 'min', label: 'Min', title: 'Minimize' },
  { id: 'target', label: 'Reach', title: 'Reach a value' },
  { id: 'le', label: '≤', title: 'Keep at most a value (a soft limit)' },
  { id: 'ge', label: '≥', title: 'Keep at least a value (a soft limit)' },
];
const GOALS_CON: { id: MetricGoal; label: string; title: string }[] = [
  { id: 'le', label: '≤', title: 'At most' },
  { id: 'ge', label: '≥', title: 'At least' },
  { id: 'target', label: '=', title: 'Equal to' },
];
const relOf = (g: MetricGoal) => (g === 'le' ? '≤' : g === 'ge' ? '≥' : '=');
const fmt = (v: number, d = 6) => (Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');
// the numbers of the constraints in use: C1, C2… (the same in the editor and in the run's tables)
const consNumbers = (list: Objective[]) => {
  const out = new Map<string, number>();
  let n = 0;
  for (const x of list) if (x.on && isConstraint(x)) out.set(x.id, ++n);
  return out;
};
type Label = { text: string; code: string; unit: string; ok: boolean };
function Mark({ ok, title }: { ok: boolean; title?: string }) {
  return ok ? <span className="ok-mark" title={title ?? 'met'}>✓</span> : <span className="bad-mark" title={title ?? 'broken'}>✗</span>;
}

export function Optimization() {
  const [tab, setTab] = useState<'params' | 'spr'>('params');
  return (
    <div className="optimization">
      <div className="tabs">
        <button className={tab === 'params' ? 'active' : ''} onClick={() => setTab('params')}>Parameters and goals</button>
        <button className={tab === 'spr' ? 'active' : ''} onClick={() => setTab('spr')}>SPR design by layer sequences (GA)</button>
      </div>
      {tab === 'params' ? <ParamsOptimizer /> : <SprDesigner />}
    </div>
  );
}

// One objective or constraint: its quantity, its value now, the goal and its value; weight, scale and role behind ⚙.
// (its settings stay open when it moves between the objectives and the constraints: `more` is kept by the page)
function GoalRow({ x, no, l, now, set, remove, more, setMore }: { x: Objective; no?: number; l: Label; now: number; set: (patch: Partial<Objective>) => void; remove: () => void; more: boolean; setMore: (open: boolean) => void }) {
  const cons = isConstraint(x);
  // a new constraint's limit: its value now (when it had none)
  const limit = x.target === 0 && Number.isFinite(now) ? +now.toPrecision(3) : x.target;
  const needsValue = x.goal === 'target' || x.goal === 'le' || x.goal === 'ge';
  return (
    <div className={`goal-item${x.on ? '' : ' off'}${l.ok ? '' : ' invalid'}`}>
      <div className="goal-row">
        <Switch checked={x.on} onChange={(on) => set({ on })} title={x.on ? 'In use (switch off to leave it out)' : 'Not in use'} />
        {cons && <span className="c-tag" title="Its column in the tables of the run">{no ? `C${no}` : 'C–'}</span>}
        <span className="goal-name" title={l.code}>
          {l.text}
          {l.code && <span className="mono muted"> {l.code}</span>}
        </span>
        <span className="goal-now" title="Its value now">
          {fmt(now)}
          {l.unit && <span className="muted"> {l.unit}</span>}
          {cons && Number.isFinite(now) && <> <Mark ok={violationOf(x, now) <= 0} /></>}
        </span>
        <span className="goal-set">
          <Segmented value={x.goal} options={cons ? GOALS_CON : GOALS_OBJ} onChange={(goal) => set({ goal })} />
          {needsValue && <NumberField bare label={`${l.text}: value`} unit={l.unit} value={x.target} onChange={(target) => set({ target })} className="tiny" />}
          <IconButton icon="settings" label="Weight, scale, role" active={more} onClick={() => setMore(!more)} />
          <IconButton icon="trash" label="Remove" onClick={remove} />
        </span>
      </div>
      {more && (
        <div className="grid-fields goal-more">
          <NumberField label="Weight" value={x.weight} onChange={(weight) => set({ weight })} min={0} />
          <NumberField label="Scale (0: start value)" value={x.scale} onChange={(scale) => set({ scale })} min={0} title="The quantity is divided by it (0: its value at the start)" />
          <Field label="Role">
            <Segmented
              value={cons ? 'constraint' : 'objective'}
              options={[
                { id: 'objective', label: 'Objective' },
                { id: 'constraint', label: 'Constraint' },
              ]}
              onChange={(r) => set(r === 'constraint' ? { role: 'constraint', goal: x.goal === 'min' ? 'le' : x.goal === 'max' ? 'ge' : x.goal, target: limit } : { role: 'objective' })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function ParamsOptimizer() {
  const { project, update, lib } = useProject();
  const infos = useParamInfos();
  const o = project.opt;
  const s = project.sim;
  const setO = (patch: Partial<OptSettings>) => update((p) => ({ ...p, opt: { ...p.opt, ...patch } }));
  const run = useOptRun();
  useEffect(() => warmOpt(), []); // (the workers start while the goals are set)
  const running = run?.status === 'running' || run?.status === 'paused';
  // (λ and θ of the interrogation are not variables here)
  const vars = useMemo(() => variablesOf(project.params.filter((x) => x.ref.kind !== 'scan'), project.structure, infos), [project.params, project.structure, infos]);
  const spectral = s.mode === 'lambda';
  const unit = spectral ? 'nm' : '°';
  const algo = ALGORITHMS.find((a) => a.id === o.algorithm)!;
  const [dialog, setDialog] = useState<{ edit?: Exposed } | null>(null);
  const [moreId, setMoreId] = useState<string | null>(null);

  const setObj = (id: string, patch: Partial<Objective>) => setO({ objectives: o.objectives.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const objLabel = (x: Objective): Label => {
    const m = project.metrics.find((y) => y.id === x.metric);
    const q = m && quantitiesOf(m, spectral).find((y) => y.key === x.key);
    return m && q ? { text: `${m.label}: ${q.label}`, code: `${m.ref}.${q.key}`, unit: q.unit(unit), ok: m.on } : { text: '(a removed metric)', code: '', unit: '', ok: false };
  };

  // the current values of the quantities (the Simulation's computation of the project as it is)
  const [now, setNow] = useState<ValuesResult | null>(null);
  const itKey = JSON.stringify(interrogationOf(s));
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      valuesLatest({ type: 'values', materials: project.materials, structure: project.structure, it: interrogationOf(s), metrics: project.metrics, derived: project.derived })
        .then((r) => alive && r && setNow(r))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [project.materials, project.structure, project.metrics, project.derived, itKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowRaw = (metric: string, key: string) => now?.values[project.metrics.findIndex((m) => m.id === metric)]?.[key] ?? NaN;

  // every result of every metric in use, by metric
  const groups: PickGroup[] = project.metrics
    .filter((m) => m.on)
    .map((m) => ({
      id: m.id,
      title: `${m.label} · ${m.ref}`,
      items: quantitiesOf(m, spectral).map((q) => {
        const v = nowRaw(m.id, q.key);
        const u = q.unit(unit);
        return { key: q.key, label: q.label, value: Number.isFinite(v) ? `${fmt(v, 4)}${u ? ` ${u}` : ''}` : '' };
      }),
    }));
  const addGoal = (role: 'objective' | 'constraint') => (mid: string, key: string) => {
    const lower = ['width', 'R', 'rmse', 'cost', 'mse', 'maxErr'].includes(key);
    const v = nowRaw(mid, key);
    setO({ objectives: [...o.objectives, newObjective(mid, key, role === 'constraint' ? { role, goal: lower ? 'le' : 'ge', target: Number.isFinite(v) ? +v.toPrecision(3) : 0, scale: 0 } : { goal: lower ? 'min' : 'max', scale: 0 })] });
  };
  const nums = consNumbers(o.objectives);
  const goalRows = (role: 'objective' | 'constraint') =>
    o.objectives
      .filter((x) => (role === 'constraint') === isConstraint(x))
      .map((x) => (
        <GoalRow
          key={x.id}
          x={x}
          no={nums.get(x.id)}
          l={objLabel(x)}
          now={nowRaw(x.metric, x.key)}
          set={(patch) => setObj(x.id, patch)}
          remove={() => setO({ objectives: o.objectives.filter((y) => y.id !== x.id) })}
          more={moreId === x.id}
          setMore={(open) => setMoreId(open ? x.id : null)}
        />
      ));
  const objRows = goalRows('objective');
  const conRows = goalRows('constraint');

  // the parameters the optimizer may change (the interrogation's λ and θ are not offered)
  const params = project.params.filter((x) => x.ref.kind !== 'scan' && infos.has(paramKey(x.ref)));
  const setX = (id: string, patch: Partial<Exposed>) => update((p) => ({ ...p, params: p.params.map((y) => (y.id === id ? { ...y, ...patch } : y)) }));

  const nGoals = o.objectives.filter((x) => x.on && !isConstraint(x)).length;
  const nCons = o.objectives.filter((x) => x.on && isConstraint(x)).length;
  const problems = [
    !vars.length && 'Nothing to vary: switch on Optimize for a parameter (Variables), or add one.',
    !nGoals && 'No objective: add one (constraints alone are not enough).',
    o.algorithm === 'lm' && o.objectives.some((x) => x.on && (x.goal === 'min' || x.goal === 'max')) && 'Levenberg-Marquardt needs objectives with a value to reach or a limit (not Min / Max).',
    o.algorithm === 'adam' && vars.every((v) => v.integer) && vars.length > 0 && 'Adam moves continuous variables only.',
  ].filter(Boolean) as string[];

  // random rough profiles in the structure: the candidates can be averaged over realizations
  const rough = hasRandomRough(project.structure);
  const start = () => {
    const job: EvalJob = { structure: project.structure, it: interrogationOf(s), metrics: project.metrics, derived: project.derived, vars, objectives: o.objectives, ...(rough && o.samples ? { samples: o.samples } : {}) };
    startOpt(project.materials, job, o, project.configId);
  };
  // the point x written into the structure, and recorded (the Compare page lists the optimizations applied)
  const apply = (x: number[], ends: number[]) => {
    if (!run) return;
    const algo = ALGORITHMS.find((a) => a.id === run.algorithm)?.label ?? 'optimization';
    const rec = optRecordOf(
      algo,
      run.vars,
      x,
      run.objectives.map((o, i) => ({ o, label: objLabel(o).text, unit: objLabel(o).unit, start: run.start?.values[i] ?? NaN, end: ends[i] ?? NaN })),
      (id) => lib.get(id)?.name ?? id,
    );
    update((p) => {
      const r = applyParams(p.structure, { ...p.sim }, valuesAt(run.vars, x));
      return { ...p, structure: r.structure, sim: { ...p.sim, lambda: r.it.lambda, theta: r.it.theta }, optLog: [...(p.optLog ?? []), rec] };
    });
  };

  return (
    <>
      <Board
        id="optimization"
        className="opt-layout"
        columns={[{ id: 'left' }, { id: 'right' }]}
        items={[
          {
            key: 'variables',
            col: 'left',
            label: 'Variables',
            node: (
        <section className="card vary-card">
          <div className="card-head">
            <h2>Variables</h2>
            <span className="sub">design variables and their bounds</span>
            <span className="spacer" />
            <button type="button" disabled={running} onClick={() => setDialog({})}>
              <Icon name="plus" size={14} />
              Parameter
            </button>
          </div>
          {dialog && <ParamDialog key={dialog.edit?.id ?? 'new'} edit={dialog.edit} forOpt close={() => setDialog(null)} />}
          <fieldset className="plain" disabled={running}>
            <div className="table-scroll">
              <table className="data vary">
                <thead>
                  <tr><th>Optimize</th><th>Parameter</th><th className="num">Min</th><th className="num">Max</th><th /></tr>
                </thead>
                <tbody>
                  {params.map((x) => {
                    const info = infos.get(paramKey(x.ref))!;
                    const nowText = typeof info.value === 'string' ? (lib.get(info.value)?.name ?? info.value) : `${fmt(info.value)}${info.unit ? ` ${info.unit}` : ''}`;
                    const integer = !info.material && (info.integer || x.opt.integer);
                    return (
                      <tr key={x.id} className={x.opt.on ? '' : 'off'}>
                        <td><Switch checked={x.opt.on} onChange={(on) => setX(x.id, { opt: { ...x.opt, on } })} title={`Optimize ${x.name}`} /></td>
                        <td>
                          <div className="vary-name">{x.name}</div>
                          <div className="muted small">now {nowText}{integer ? ' · integers' : ''}</div>
                        </td>
                        {info.material ? (
                          <td colSpan={2} className="muted small" title={x.mats.map((id) => lib.get(id)?.name ?? id).join(', ')}>
                            among {x.mats.length || 1}: {(x.mats.length ? x.mats : [String(info.value)]).map((id) => lib.get(id)?.name ?? id).join(', ')}
                          </td>
                        ) : (
                          <>
                            <td className="num"><NumberField bare label={`${x.name} min`} value={x.opt.min} onChange={(min) => setX(x.id, { opt: { ...x.opt, min } })} min={info.min} max={info.max} className="tiny" /></td>
                            <td className="num"><NumberField bare label={`${x.name} max`} unit={info.unit} value={x.opt.max} onChange={(max) => setX(x.id, { opt: { ...x.opt, max } })} min={info.min} max={info.max} className="tiny" /></td>
                          </>
                        )}
                        <td className="row-actions">{<IconButton icon="pencil" label={info.material ? 'Choose the candidates' : 'Edit the values'} onClick={() => setDialog({ edit: x })} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </fieldset>
          {!params.length && <p className="muted small">Add a parameter (a thickness, a material, an index, a number of periods…) to search over it.</p>}
        </section>
            ),
          },

          {
            key: 'goals',
            col: 'right',
            label: 'Goals',
            node: (
        <section className="card goals-card">
          <div className="card-head">
            <h2>Goals</h2>
            <span className="sub">objective functions (weighted, scaled costs, minimized) and constraints</span>
          </div>
          <fieldset className="plain" disabled={running}>
            <div className="sub-head goals-head">
              <h3>Objectives</h3>
              <span className="spacer" />
              <GoalPicker label="Objective" groups={groups} onPick={addGoal('objective')} disabled={running} />
            </div>
            {objRows.length ? <div className="goal-list">{objRows}</div> : <p className="muted small">None yet: pick any result of a metric (S, the FWHM, R at the dip, a fit parameter, the field…).</p>}
            <div className="sub-head goals-head">
              <h3>Constraints</h3>
              <span className="spacer" />
              <GoalPicker label="Constraint" groups={groups} onPick={addGoal('constraint')} disabled={running} />
            </div>
            {conRows.length ? <div className="goal-list">{conRows}</div> : <p className="muted small">None: a constraint is a limit a solution must meet (NSGA-II: feasible solutions first; the others: a large penalty).</p>}
          </fieldset>
        </section>
            ),
          },
        ]}
      />


      <section className="card">
        <div className="card-head">
          <h2>Algorithm</h2>
          <span className="sub">{algo.note}</span>
        </div>
        <fieldset className="plain" disabled={running}>
          <div className="grid-fields">
            <Field label="Algorithm" className="span-2">
              <select value={o.algorithm} onChange={(e) => setO({ algorithm: e.target.value as Algorithm })}>
                {ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
            <NumberField label="Iterations" value={o.iterations} onChange={(iterations) => setO({ iterations: Math.max(1, Math.round(iterations)) })} min={1} />
            {algo.population && <NumberField label="Population" value={o.population} onChange={(population) => setO({ population: Math.max(4, Math.round(population)) })} min={4} />}
            <NumberField label="Seed" value={o.seed} onChange={(seed) => setO({ seed: Math.round(seed) })} />
            {!['nm', 'lm', 'nsga2'].includes(o.algorithm) && (
              <Field label="Polish the best">
                <Switch checked={o.polish} onChange={(polish) => setO({ polish })} label="Nelder-Mead" />
              </Field>
            )}
          </div>
          {rough && (
            <div className="grid-fields samples-row">
              <Field label="Rough structures" className="span-2" title="The random rough profiles of the structure: every candidate on one realization (the seeds as set), or the mean / median of every quantity over N realizations (the seeds seed … seed + N − 1). N times slower.">
                <Segmented value={o.samples?.stat ?? 'one'} options={[{ id: 'one', label: 'one realization' }, { id: 'mean', label: 'mean' }, { id: 'median', label: 'median' }]} onChange={(stat) => setO({ samples: { n: o.samples?.n ?? 5, stat } })} />
              </Field>
              {(o.samples?.stat ?? 'one') !== 'one' && <NumberField label="Over N samples" value={o.samples?.n ?? 5} min={2} max={200} onChange={(n) => setO({ samples: { stat: o.samples?.stat ?? 'mean', n: Math.round(n) } })} title="Realizations of the random profiles per candidate" />}
            </div>
          )}
          <AlgoParams o={o} setO={setO} objLabel={(x) => objLabel(x).text} />
        </fieldset>
        <div className="run-row">
          {!running ? (
            <button className="primary" disabled={problems.length > 0} onClick={start}>
              <Icon name="play" size={14} />
              Start ({vars.length} variable{vars.length === 1 ? '' : 's'}, {nGoals} objective{nGoals === 1 ? '' : 's'}{nCons ? `, ${nCons} constraint${nCons === 1 ? '' : 's'}` : ''})
            </button>
          ) : (
            <>
              {run?.status === 'paused' ? <button onClick={resumeOpt}>Resume</button> : <button onClick={pauseOpt}>Pause</button>}
              <button onClick={stopOpt}>Stop</button>
            </>
          )}
          {run && !running && (
            <button
              onClick={() => {
                clearOpt();
                clearRunView();
              }}
            >
              Clear the result
            </button>
          )}
        </div>
        {problems.map((p) => <div key={p} className="msg warn">{p}</div>)}
      </section>

      {run && <RunView run={run} apply={apply} unit={unit} objLabel={objLabel} />}
    </>
  );
}

// The variation operators of GA / NSGA-II: the crossover and the mutation, every setting.
function Operators({ c, m, setC, setM }: { c: Crossover; m: Mutation; setC: (c: Partial<Crossover>) => void; setM: (m: Partial<Mutation>) => void }) {
  return (
    <>
      <div className="grid-fields algo-params">
        <Field label="Crossover" title="SBX: simulated binary (η: spread, larger = children nearer the parents); BLX-α: uniform in the parents' box widened by α; uniform: each gene from either parent; arithmetic: a random mix">
          <select value={c.type} onChange={(e) => setC({ type: e.target.value as CrossoverType })}>
            <option value="sbx">SBX (simulated binary)</option>
            <option value="blx">BLX-α</option>
            <option value="uniform">uniform</option>
            <option value="arithmetic">arithmetic</option>
          </select>
        </Field>
        <NumberField label="Crossover probability" value={c.prob} onChange={(prob) => setC({ prob })} min={0} max={1} />
        {c.type === 'sbx' && <NumberField label="η (distribution index)" value={c.eta} onChange={(eta) => setC({ eta })} min={0} />}
        {c.type === 'blx' && <NumberField label="α" value={c.alpha} onChange={(alpha) => setC({ alpha })} min={0} />}
      </div>
      <div className="grid-fields algo-params">
        <Field label="Mutation" title="polynomial (η: larger = smaller steps); Gaussian (σ: a fraction of the range); uniform: a new random value">
          <select value={m.type} onChange={(e) => setM({ type: e.target.value as MutationType })}>
            <option value="polynomial">polynomial</option>
            <option value="gaussian">gaussian</option>
            <option value="uniform">uniform (reset)</option>
          </select>
        </Field>
        <Field label="Mutation probability" title="Per variable; empty = 1 / (number of variables)">
          <input
            type="text"
            placeholder="1/n"
            defaultValue={Number.isFinite(m.prob) && m.prob > 0 ? String(m.prob) : ''}
            onChange={(e) => {
              const t = e.target.value.trim();
              const v = t === '' ? NaN : Number(t);
              if (t === '' || (Number.isFinite(v) && v >= 0 && v <= 1)) setM({ prob: v });
            }}
          />
        </Field>
        {m.type === 'polynomial' && <NumberField label="η (distribution index)" value={m.eta} onChange={(eta) => setM({ eta })} min={0} />}
        {m.type === 'gaussian' && <NumberField label="σ (fraction of the range)" value={m.sigma} onChange={(sigma) => setM({ sigma })} min={0} />}
      </div>
    </>
  );
}

// The settings of the chosen algorithm, every one of them (stored as changes over spr-forge's defaults).
function AlgoParams({ o, setO, objLabel }: { o: OptSettings; setO: (patch: Partial<OptSettings>) => void; objLabel: (x: Objective) => string }) {
  const P = mergeParams(o.params);
  const setP = <K extends keyof AlgoParamsT>(k: K, patch: Partial<AlgoParamsT[K]>) => setO({ params: { ...o.params, [k]: { ...o.params[k], ...patch } } });
  const int = (v: number, min: number) => Math.max(min, Math.round(v));
  const reset = (
    <Field>
      <button type="button" title="spr-forge's defaults for this algorithm" onClick={() => setO({ params: { ...o.params, [o.algorithm]: undefined } })}>
        Defaults
      </button>
    </Field>
  );
  const on = o.objectives.filter((x) => x.on && !isConstraint(x));
  switch (o.algorithm) {
    case 'de':
      return (
        <div className="grid-fields algo-params">
          <Field label="Strategy" title="rand/1: explores; best/1: converges fast; current-to-best: between; rand/2: more diverse; exp: exponential crossover">
            <select value={P.de.strategy} onChange={(e) => setP('de', { strategy: e.target.value as DeStrategy })}>
              {['rand/1/bin', 'best/1/bin', 'current-to-best/1/bin', 'rand/2/bin', 'rand/1/exp'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
          <NumberField label="F (min)" value={P.de.F} onChange={(F) => setP('de', { F })} min={0} max={2} />
          <NumberField label="F (max, dither)" value={P.de.Fmax} onChange={(Fmax) => setP('de', { Fmax })} min={0} max={2} />
          <NumberField label="CR" value={P.de.CR} onChange={(CR) => setP('de', { CR })} min={0} max={1} />
          {reset}
        </div>
      );
    case 'pso':
      return (
        <div className="grid-fields algo-params">
          <NumberField label="Inertia w" value={P.pso.w} onChange={(w) => setP('pso', { w })} />
          <NumberField label="w at the end" value={P.pso.wEnd} onChange={(wEnd) => setP('pso', { wEnd })} />
          <NumberField label="c1 (own best)" value={P.pso.c1} onChange={(c1) => setP('pso', { c1 })} />
          <NumberField label="c2 (swarm best)" value={P.pso.c2} onChange={(c2) => setP('pso', { c2 })} />
          <NumberField label="v max (fraction of the range)" value={P.pso.vmax} onChange={(vmax) => setP('pso', { vmax })} min={0} />
          <Field label="Topology">
            <select value={P.pso.topology} onChange={(e) => setP('pso', { topology: e.target.value as 'global' | 'ring' })}>
              <option value="global">global (the swarm's best)</option>
              <option value="ring">ring (the neighbours' best)</option>
            </select>
          </Field>
          {P.pso.topology === 'ring' && <NumberField label="Neighbours each side" value={P.pso.neighbours} onChange={(v) => setP('pso', { neighbours: int(v, 1) })} min={1} />}
          {reset}
        </div>
      );
    case 'ga':
      return (
        <>
          <div className="grid-fields algo-params">
            <NumberField label="Tournament size" value={P.ga.tournament} onChange={(v) => setP('ga', { tournament: int(v, 1) })} min={1} />
            <NumberField label="Elites" value={P.ga.elites} onChange={(v) => setP('ga', { elites: int(v, 0) })} min={0} />
            {reset}
          </div>
          <Operators c={P.ga.crossover} m={P.ga.mutation} setC={(c) => setP('ga', { crossover: { ...P.ga.crossover, ...c } })} setM={(m) => setP('ga', { mutation: { ...P.ga.mutation, ...m } })} />
        </>
      );
    case 'nsga2':
      return (
        <>
          <div className="grid-fields algo-params">
            <span className="muted small span-2">Binary tournament on (rank, crowding distance); the population and the children merged, the best fronts kept.</span>
            {reset}
          </div>
          <Operators c={P.nsga2.crossover} m={P.nsga2.mutation} setC={(c) => setP('nsga2', { crossover: { ...P.nsga2.crossover, ...c } })} setM={(m) => setP('nsga2', { mutation: { ...P.nsga2.mutation, ...m } })} />
        </>
      );
    case 'adam': {
      const tick = (key: 'stage1Obj' | 'stage2Obj', id: string, v: boolean) => setP('adam', { [key]: v ? [...P.adam[key], id] : P.adam[key].filter((x) => x !== id) });
      return (
        <>
          <div className="grid-fields algo-params">
            <NumberField label="Learning rate" value={P.adam.lr} onChange={(lr) => setP('adam', { lr })} min={0} />
            <NumberField label="Starts" value={P.adam.starts} onChange={(v) => setP('adam', { starts: int(v, 1) })} min={1} />
            <NumberField label="lr × decay" value={P.adam.decay} onChange={(decay) => setP('adam', { decay })} min={0} max={1} />
            <NumberField label="Every (steps)" value={P.adam.decaySteps} onChange={(v) => setP('adam', { decaySteps: int(v, 1) })} min={1} />
            <NumberField label="β1" value={P.adam.beta1} onChange={(beta1) => setP('adam', { beta1 })} min={0} max={1} />
            <NumberField label="β2" value={P.adam.beta2} onChange={(beta2) => setP('adam', { beta2 })} min={0} max={1} />
            <NumberField label="h (finite difference)" value={P.adam.h} onChange={(h) => setP('adam', { h })} min={0} />
            <NumberField label="Stop after (steps without gain, 0 = never)" value={P.adam.stall} onChange={(v) => setP('adam', { stall: int(v, 0) })} min={0} />
            {reset}
          </div>
          <div className="sub-head">
            <h3>Two stages</h3>
            <span className="sub">no objective in stage 1: a single stage; none in stage 2: all objectives</span>
          </div>
          <div className="grid-fields algo-params">
            <NumberField label="Stage 1: steps" value={P.adam.stage1Iter} onChange={(v) => setP('adam', { stage1Iter: int(v, 0) })} min={0} />
            <NumberField label="Stage 1: learning rate" value={P.adam.stage1Lr} onChange={(stage1Lr) => setP('adam', { stage1Lr })} min={0} />
          </div>
          {on.length > 0 && (
            <table className="data stages">
              <thead>
                <tr><th>Objective</th><th>Stage 1</th><th>Stage 2</th></tr>
              </thead>
              <tbody>
                {on.map((x) => (
                  <tr key={x.id}>
                    <td>{objLabel(x)}</td>
                    <td><Switch checked={P.adam.stage1Obj.includes(x.id)} onChange={(v) => tick('stage1Obj', x.id, v)} title="In stage 1" /></td>
                    <td><Switch checked={P.adam.stage2Obj.includes(x.id)} onChange={(v) => tick('stage2Obj', x.id, v)} title="In stage 2" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      );
    }
    case 'sa':
      return (
        <div className="grid-fields algo-params">
          <NumberField label="T₀ (0: automatic)" value={P.sa.t0} onChange={(t0) => setP('sa', { t0 })} min={0} />
          <NumberField label="Cooling" value={P.sa.cooling} onChange={(cooling) => setP('sa', { cooling })} min={0} max={1} />
          <NumberField label="Moves per temperature" value={P.sa.perTemp} onChange={(v) => setP('sa', { perTemp: int(v, 1) })} min={1} />
          <NumberField label="Step (fraction of the range)" value={P.sa.step} onChange={(step) => setP('sa', { step })} min={0} max={1} />
          <NumberField label="Chains" value={P.sa.chains} onChange={(v) => setP('sa', { chains: int(v, 1) })} min={1} />
          {reset}
        </div>
      );
    case 'nm':
      return (
        <div className="grid-fields algo-params">
          <NumberField label="Initial step (fraction of the range)" value={P.nm.step} onChange={(step) => setP('nm', { step })} min={0} max={1} />
          <NumberField label="Tolerance" value={P.nm.tol} onChange={(tol) => setP('nm', { tol })} min={0} />
          {reset}
        </div>
      );
    case 'lm':
      return (
        <div className="grid-fields algo-params">
          <NumberField label="λ₀ (damping)" value={P.lm.lambda0} onChange={(lambda0) => setP('lm', { lambda0 })} min={0} />
          <NumberField label="h (Jacobian step, fraction of the range)" value={P.lm.h} onChange={(h) => setP('lm', { h })} min={0} />
          {reset}
        </div>
      );
    default:
      return null;
  }
}

// Progress, the convergence, the best point; the Pareto front (ranked by criteria, filtered, seen in several views,
// solutions checked); the response of the start and of the checked solutions, with a table of their metrics; apply.
type Shown = { key: string; i: number; label: string; color: string; x: number[]; values: number[]; editable: boolean };
type Curve = { R: number[]; results: (MetricResult | null)[]; shifts: { key: string; R: number[] }[] };

function RunView({ run, apply, unit, objLabel }: { run: NonNullable<ReturnType<typeof useOptRun>>; apply: (x: number[], ends: number[]) => void; unit: string; objLabel: (x: Objective) => Label }) {
  const { project, lib, update } = useProject();
  // (a run of another configuration: its variables are that structure's)
  const otherConfig = !!run.config && run.config !== project.configId;
  const s = project.sim;
  const conv = useRef<HTMLDivElement>(null);
  const resp = useRef<HTMLDivElement>(null);
  const front = run.front ?? [];
  const done = run.status !== 'running' && run.status !== 'paused';
  const varText = (i: number, v: number) => {
    const d = run.vars[i];
    if (d.mats) return lib.get(d.mats[Math.round(v)] ?? '')?.name ?? '?';
    return `${fmt(d.integer ? Math.round(v) : v)}${d.unit ? ` ${d.unit}` : ''}`;
  };

  const nums = consNumbers(run.objectives);
  const cons = run.objectives.map((x, i) => ({ x, i })).filter(({ x }) => isConstraint(x));
  const consText = (x: Objective) => `C${nums.get(x.id)}: ${objLabel(x).text} ${relOf(x.goal)} ${x.target}${objLabel(x).unit ? ` ${objLabel(x).unit}` : ''}`;
  // each quantity once (the objectives first; a quantity only constrained is shown through its C column)
  const keyOf = (x: Objective) => `${x.metric}|${x.key}`;
  const quantCols = run.objectives.map((x, i) => ({ x, i })).filter(({ x }, k, all) => !isConstraint(x) && all.findIndex((y) => !isConstraint(y.x) && keyOf(y.x) === keyOf(x)) === k);
  const plotQs = run.objectives.map((x, i) => ({ x, i })).filter(({ x }, k, all) => all.findIndex((y) => keyOf(y.x) === keyOf(x)) === k);
  const qLabel = (i: number) => {
    const l = objLabel(run.objectives[i]);
    return `${l.text}${l.unit ? ` [${l.unit}]` : ''}`;
  };

  // what is shown (kept while the run's result is there)
  const [view, setView] = useRunView(run.started, { x: plotQs[0]?.i ?? 0, y: plotQs[1]?.i ?? plotQs[0]?.i ?? 0 });
  const checked = view.checked.filter((c) => c.i < front.length);
  const isChecked = (i: number) => checked.some((c) => c.i === i);
  const toggle = (i: number) =>
    setView((v) => {
      if (v.checked.some((c) => c.i === i)) return { checked: v.checked.filter((c) => c.i !== i) };
      if (v.checked.length >= MAX_CHECKED) return {};
      return { checked: [...v.checked, { i, color: nextColor(v.checked) }] };
    });
  // the ranking of the front's solutions
  const { order, score } = rankSolutions(
    front.map((p) => p.values ?? []),
    view.criteria,
    view.filters,
    view.method,
  );
  const kept = new Set(order);
  const ranked = view.criteria.length > 0;

  // the solutions on the response: those checked, else the lowest total cost
  const shown: Shown[] = checked.length
    ? checked.map((c) => ({ key: `s${c.i}`, i: c.i, label: `#${c.i + 1}`, color: c.color, x: front[c.i].x, values: front[c.i].values ?? [], editable: true }))
    : run.bestX.length
      ? [{ key: 'best', i: -1, label: 'best', color: 'var(--line)', x: run.bestX, values: run.bestValues, editable: false }]
      : [];

  // the response of the start and of each shown solution, with the metrics measured on R along the scan
  const it = { ...(s.mode === 'theta' ? THETA_AXIS : LAMBDA_AXIS) };
  // (every metric of the response is computed — the results table — and those measured on R drawn over the curves)
  const respMetrics = project.metrics.filter((m) => m.on && (!m.source || m.source === 'response') && m.kind !== 'custom' && !(m.kind === 'fit' && m.fit?.mode === 'dispersion'));
  const onR = respMetrics.filter((m) => !m.field || m.field === 'R' || m.kind === 'sens' || m.kind === 'fom');
  const respKey = JSON.stringify(respMetrics);
  const [curves, setCurves] = useState<{ key: string; xs: number[]; start: Curve | null; by: Record<string, Curve> }>({ key: '', xs: [], start: null, by: {} });
  const xKey = (x: number[]) => x.map((v) => +v.toPrecision(10)).join(',');
  const wanted = shown.map((v) => xKey(v.x));
  useEffect(() => {
    if (otherConfig) return;
    let alive = true;
    const t = setTimeout(async () => {
      const at = (x: number[]) => applyParams(project.structure, interrogationOf(s), valuesAt(run.vars, x));
      const compute = async (x: number[]): Promise<Curve | null> => {
        const a = at(x);
        const r = await valuesOnce({ type: 'values', materials: project.materials, structure: a.structure, it: a.it, metrics: respMetrics, derived: project.derived }).catch(() => null);
        return r?.xs.length ? { R: r.R, results: r.results ?? [], shifts: r.shifts ?? [], xs: r.xs } as Curve & { xs: number[] } : null;
      };
      let cur = curves.key === respKey ? curves : { key: respKey, xs: [] as number[], start: null, by: {} as Record<string, Curve> };
      if (!cur.start) {
        const c0 = (await compute(run.vars.map((v) => v.start))) as (Curve & { xs: number[] }) | null;
        if (!alive || !c0) return;
        cur = { ...cur, xs: c0.xs, start: c0 };
        setCurves(cur);
      }
      for (const v of shown) {
        const k = xKey(v.x);
        if (cur.by[k]) continue;
        const c = await compute(v.x);
        if (!alive || !c) return;
        cur = { ...cur, by: { ...cur.by, [k]: c } };
        setCurves(cur);
      }
    }, done ? 0 : 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [wanted.join('|'), done, respKey, otherConfig]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = curves.key === respKey ? curves : null;
  const curveOf = (v: Shown) => cv?.by[xKey(v.x)];
  const respOn = project.opt.respMarks !== false;
  const setOpt = (patch: Partial<OptSettings>) => update((p) => ({ ...p, opt: { ...p.opt, ...patch } }));
  const respOverlays: Overlay[] =
    cv && respOn
      ? shown.flatMap((v) => {
          const c = curveOf(v);
          if (!c) return [];
          return metricOverlays(onR, onR.map((m) => c.results[respMetrics.indexOf(m)] ?? undefined), {
            unit: it.unit,
            spectral: s.mode === 'lambda',
            shift: shown.length === 1,
            fit: true,
            text: false,
            colorIndex: (i) => project.metrics.indexOf(onR[i]),
            xs: cv.xs,
            hidden: project.opt.respHidden,
            shiftedCurve: (key) => c.shifts.find((x) => x.key === key)?.R,
          }).map((o) => ({ ...o, key: `${v.key}:${o.key}`, ...(shown.length > 1 ? { color: v.color } : {}) }));
        })
      : [];

  // the results table under the response: the chosen results of the metrics, for the start and each solution
  const allCols = respMetrics.flatMap((m) => quantitiesOf(m, s.mode === 'lambda').map((q) => ({ key: `${m.id}|${q.key}`, label: `${m.label}: ${q.label}`, unit: q.unit(it.unit), m, q })));
  const defaultCols = [...new Set(run.objectives.map(keyOf))].filter((k) => allCols.some((c) => c.key === k));
  const cols = (view.columns ?? defaultCols).map((k) => allCols.find((c) => c.key === k)).filter((c): c is (typeof allCols)[number] => !!c);
  const valueIn = (c: Curve | null | undefined, col: (typeof allCols)[number]) => c?.results[respMetrics.indexOf(col.m)]?.values[col.q.key] ?? NaN;
  const resultsCsv = () =>
    exportCsv(
      ['solution', ...cols.map((c) => `${c.label}${c.unit ? ` [${c.unit}]` : ''}`), ...run.vars.map((v) => `${v.name}${v.unit ? ` [${v.unit}]` : ''}`)],
      [
        ['start', ...cols.map((c) => valueIn(cv?.start, c)), ...run.vars.map((v, j) => (v.mats ? varText(j, v.start) : v.start))],
        ...shown.map((v) => [v.label, ...cols.map((c) => valueIn(curveOf(v), c)), ...run.vars.map((d, j) => (d.mats ? varText(j, v.x[j]) : v.x[j]))]),
      ],
      'optimized solutions',
    );

  const frontCsv = () =>
    exportCsv(
      ['#', ...(ranked ? ['rank', 'score'] : []), ...run.objectives.map((x) => (isConstraint(x) ? `${consText(x)} (value)` : objLabel(x).text)), ...cons.map(({ x }) => `C${nums.get(x.id)} met`), ...run.vars.map((v) => v.name)],
      (ranked ? order : front.map((_, i) => i)).map((i) => {
        const p = front[i];
        return [i + 1, ...(ranked ? [order.indexOf(i) + 1, score[i]] : []), ...run.objectives.map((_, j) => p.values?.[j] ?? NaN), ...cons.map(({ x, i: j }) => (p.values && violationOf(x, p.values[j]) <= 0 ? 1 : 0)), ...run.vars.map((v, j) => (v.mats ? varText(j, p.x[j]) : p.x[j]))];
      }),
      'Pareto front',
    );
  // the cost of a row of the best point: its part (objectives) or met / broken (constraints)
  const partOf = (i: number) => run.objectives.slice(0, i).filter((x) => !isConstraint(x)).length;
  const rowCost = (x: Objective, i: number) => {
    if (isConstraint(x)) {
      const v = run.bestValues[i];
      return v === undefined ? '—' : <Mark ok={violationOf(x, v) <= 0} />;
    }
    return fmt(run.bestParts[partOf(i)] ?? NaN, 4);
  };
  const setCrit = (k: number, patch: Partial<RankCriterion>) => setView((v) => ({ criteria: v.criteria.map((c, j) => (j === k ? { ...c, ...patch } : c)) }));
  const setFilt = (k: number, patch: Partial<RankFilter>) => setView((v) => ({ filters: v.filters.map((c, j) => (j === k ? { ...c, ...patch } : c)) }));
  const [topN, setTopN] = useState(3);
  const qItems = plotQs.map(({ i }) => ({ key: String(i), label: qLabel(i) }));

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Run</h2>
          <span className={`status ${run.status}`}>{run.status}</span>
          <span className="muted">{run.phase} · iteration {run.iteration} · {run.evaluations} evaluations · {run.elapsed.toFixed(1)} s</span>
          {run.message && <span className="err-text">{run.message}</span>}
        </div>
        <div className="two-col wide">
          <div>
            <div className="card-head sub-head">
              <h3>Convergence (best total cost)</h3>
              <FigureTools target={conv} name="convergence" csv={() => exportCsv(['iteration', 'best total cost'], run.history.map((v, i) => [i + 1, v]), 'convergence')} />
            </div>
            {run.history.length > 1 && (
              <AutoWidth figure={conv} max={520}>
                {(w) => <LinePlot xAxis={{ id: 'it', label: 'iteration', unit: '', values: run.history.map((_, i) => i + 1) }} series={[{ key: 'h', label: 'best', color: 'var(--line)', y: run.history }]} yLabel="total cost" yUnit="" width={w} height={240} />}
              </AutoWidth>
            )}
          </div>
          <div>
            <h3>Best (lowest total cost): {fmt(run.best)}</h3>
            <table className="data best-vars">
              <thead>
                <tr><th>Variable</th><th className="num">Start</th><th className="num">Best</th></tr>
              </thead>
              <tbody>
                {run.vars.map((v, i) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td className="num">{varText(i, v.start)}</td>
                    <td className="num"><b>{run.bestX.length ? varText(i, run.bestX[i]) : '—'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="data best-goals">
              <thead>
                <tr><th>Goal</th><th className="num">Start</th><th className="num">Best</th><th className="num">Cost</th></tr>
              </thead>
              <tbody>
                {run.objectives.map((x, i) => {
                  const l = objLabel(x);
                  return (
                    <tr key={x.id}>
                      <td>
                        {isConstraint(x) && <span className="c-tag">C{nums.get(x.id)}</span>}
                        {l.text}
                        {isConstraint(x) && <span className="muted"> {relOf(x.goal)} {x.target}</span>}
                      </td>
                      <td className="num">{fmt(run.start?.values[i] ?? NaN)} {l.unit}</td>
                      <td className="num"><b>{fmt(run.bestValues[i] ?? NaN)}</b> {l.unit}</td>
                      <td className="num">{rowCost(x, i)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="run-row">
              <button className="primary" disabled={!done || !run.bestX.length || otherConfig} onClick={() => apply(run.bestX, run.bestValues)} title="Write these values into the structure (and λ / θ); recorded on the Compare page">Apply to the project</button>
              {!done && <span className="muted small">(when the run ends)</span>}
              {otherConfig && <span className="msg warn inline">This run is of “{project.configs.find((c) => c.id === run.config)?.name ?? 'another configuration'}”: switch to it to apply it.</span>}
            </div>
          </div>
        </div>
      </section>

      {front.length > 0 && (
        <section className="card pareto-card">
          <div className="card-head">
            <h2>Pareto front</h2>
            <span className="sub">{front.length} non-dominated solutions{view.filters.length ? `, ${order.length} within the filters` : ''} · select them in the table or on a view to compare their response</span>
            <span className="spacer" />
            <button type="button" onClick={frontCsv}>
              <Icon name="download" size={14} />
              CSV
            </button>
          </div>

          {/* ranking: criteria (max / min, weights), filters, the method; the top solutions checked at once */}
          <div className="rank-panel">
            <div className="rank-head">
              <b>Rank by</b>
              <Segmented<RankMethod> value={view.method} onChange={(method) => setView({ method })} options={RANK_METHODS.map((m) => ({ id: m.id, label: m.label, title: m.title }))} />
              <span className="spacer" />
              <MenuButton label="Criterion" items={qItems} onPick={(k) => setView((v) => ({ criteria: [...v.criteria, { q: Number(k), goal: 'max', weight: 1 }] }))} />
              <MenuButton label="Filter" items={qItems} onPick={(k) => setView((v) => ({ filters: [...v.filters, { q: Number(k), op: 'le', value: +(front.map((p) => p.values?.[Number(k)] ?? NaN).filter(Number.isFinite).sort((a, b) => a - b)[Math.floor(front.length / 2)] ?? 0).toPrecision(3) }] }))} />
            </div>
            {view.criteria.map((c, k) => (
              <div key={`c${k}`} className="rank-row">
                <span className="muted small rank-n">{view.method === 'lex' ? `${k + 1}.` : ''}</span>
                <select aria-label="Criterion" value={c.q} onChange={(e) => setCrit(k, { q: Number(e.target.value) })}>
                  {plotQs.map(({ i }) => <option key={i} value={i}>{qLabel(i)}</option>)}
                </select>
                <Segmented<'max' | 'min'> value={c.goal} onChange={(goal) => setCrit(k, { goal })} options={[{ id: 'max', label: 'Max' }, { id: 'min', label: 'Min' }]} />
                {view.method !== 'lex' && <NumberField bare label="Weight" value={c.weight} onChange={(weight) => setCrit(k, { weight })} min={0} className="tiny" title="Its weight" />}
                <IconButton icon="x" label="Take this criterion away" onClick={() => setView((v) => ({ criteria: v.criteria.filter((_, j) => j !== k) }))} />
              </div>
            ))}
            {view.filters.map((f, k) => (
              <div key={`f${k}`} className="rank-row">
                <span className="muted small rank-n">only</span>
                <select aria-label="Filter" value={f.q} onChange={(e) => setFilt(k, { q: Number(e.target.value) })}>
                  {plotQs.map(({ i }) => <option key={i} value={i}>{qLabel(i)}</option>)}
                </select>
                <Segmented<'le' | 'ge'> value={f.op} onChange={(op) => setFilt(k, { op })} options={[{ id: 'le', label: '≤' }, { id: 'ge', label: '≥' }]} />
                <NumberField bare label="Limit" value={f.value} onChange={(value) => setFilt(k, { value })} className="tiny" />
                <IconButton icon="x" label="Take this filter away" onClick={() => setView((v) => ({ filters: v.filters.filter((_, j) => j !== k) }))} />
              </div>
            ))}
            {(ranked || view.filters.length > 0) && (
              <div className="rank-row">
                <span className="muted small rank-n" />
                <button type="button" onClick={() => setView(() => ({ checked: order.slice(0, Math.min(topN, MAX_CHECKED)).reduce<{ i: number; color: string }[]>((acc, i) => [...acc, { i, color: nextColor(acc) }], []) }))}>
                  <Icon name="check" size={14} />
                  Check the top
                </button>
                <NumberField bare label="How many" value={topN} onChange={(n) => setTopN(Math.max(1, Math.min(MAX_CHECKED, Math.round(n))))} min={1} max={MAX_CHECKED} className="tiny" />
                {checked.length > 0 && <button type="button" className="link" onClick={() => setView({ checked: [] })}>uncheck all</button>}
              </div>
            )}
            {!ranked && !view.filters.length && <div className="muted small">Add criteria (e.g. Max sensitivity, Min R at the dip) to rank the solutions — by the distance to the ideal point, a weighted sum or lexicographically — and filters to keep those within limits.</div>}
          </div>

          {/* the views of the front: any two quantities, the checked solutions in their colours */}
          {plotQs.length >= 2 && front.some((p) => p.values) && (
            <div className="front-views">
              {view.views.map((fv, k) => (
                <FrontView
                  key={k}
                  fv={fv}
                  qs={plotQs.map(({ i }) => i)}
                  qLabel={qLabel}
                  label={(i) => objLabel(run.objectives[i])}
                  front={front}
                  kept={kept}
                  checked={checked}
                  set={(patch) => setView((v) => ({ views: v.views.map((x, j) => (j === k ? { ...x, ...patch } : x)) }))}
                  remove={view.views.length > 1 ? () => setView((v) => ({ views: v.views.filter((_, j) => j !== k) })) : undefined}
                  onPick={toggle}
                />
              ))}
              <div className="add-row">
                <button
                  type="button"
                  onClick={() =>
                    setView((v) => {
                      const used = v.views.map((x) => `${x.x}|${x.y}`);
                      const pairs = plotQs.flatMap(({ i }) => plotQs.map(({ i: j }) => [i, j])).filter(([i, j]) => i !== j && !used.includes(`${i}|${j}`));
                      const [x, y] = pairs[0] ?? [plotQs[0].i, plotQs[1].i];
                      return { views: [...v.views, { x, y }] };
                    })
                  }
                >
                  <Icon name="plus" size={14} />
                  Add a view
                </button>
              </div>
            </div>
          )}
          {cons.length > 0 && (
            <div className="cons-legend small">
              {cons.map(({ x }) => <span key={x.id}>{consText(x)}</span>)}
              <span className="muted"><Mark ok /> met · <Mark ok={false} /> broken</span>
            </div>
          )}
          <SortTable
            csvName="Pareto front"
            columns={[
              { key: 'n', label: '#', num: true, sticky: true },
              ...(ranked ? [{ key: 'rank', label: 'Rank', num: true, title: 'The position by the criteria (1: the best)' }, { key: 'score', label: view.method === 'lex' ? 'Order' : 'Score', num: true, title: view.method === 'ideal' ? 'The distance to the ideal point (0: at it)' : view.method === 'sum' ? 'The weighted sum of the normalized criteria (0: the best)' : 'The lexicographic order' }] : []),
              ...cons.map(({ x }) => ({ key: `c-${x.id}`, label: `C${nums.get(x.id)}`, title: `${consText(x)} — sort by how far it is broken (0: met)` })),
              ...quantCols.map(({ x }) => ({ key: x.id, label: `${objLabel(x).text}${objLabel(x).unit ? ` [${objLabel(x).unit}]` : ''}`, num: true })),
              ...run.vars.map((v) => ({ key: v.id, label: `${v.name}${v.unit ? ` [${v.unit}]` : ''}`, num: !v.mats })),
            ]}
            rows={(ranked || view.filters.length ? order : front.map((_, i) => i)).map((i) => {
              const p = front[i];
              const viol = cons.map(({ x, i: j }) => (p.values ? violationOf(x, p.values[j]) : NaN));
              const vars = run.vars.map((v, j) => (v.mats ? varText(j, p.x[j]) : v.integer ? Math.round(p.x[j]) : p.x[j]));
              const rank = order.indexOf(i) + 1;
              return {
                key: String(i),
                className: isChecked(i) ? 'chosen' : '',
                onClick: () => toggle(i),
                values: [i + 1, ...(ranked ? [rank, score[i]] : []), ...viol, ...quantCols.map(({ i: j }) => p.values?.[j] ?? NaN), ...vars],
                cells: [
                  i + 1,
                  ...(ranked ? [rank, fmt(score[i], 4)] : []),
                  ...cons.map(({ x, i: j }, k) => (Number.isFinite(viol[k]) ? <Mark key={x.id} ok={viol[k] <= 0} title={`${objLabel(x).text} = ${fmt(p.values?.[j] ?? NaN)}${objLabel(x).unit ? ` ${objLabel(x).unit}` : ''}`} /> : '—')),
                  ...quantCols.map(({ i: j }) => fmt(p.values?.[j] ?? NaN)),
                  ...run.vars.map((_, j) => varText(j, p.x[j])),
                ],
              };
            })}
            lead={(r) => {
              const i = Number(r.key);
              const c = checked.find((x) => x.i === i);
              return (
                <span className="check-cell" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Show solution ${i + 1}`} checked={!!c} disabled={!c && checked.length >= MAX_CHECKED} onChange={() => toggle(i)} />
                  {c && <span className="dot" style={{ background: c.color }} />}
                </span>
              );
            }}
          />
        </section>
      )}

      {cv?.start && (
        <section className="card">
          <div className="card-head">
            <h2>Response: start and {checked.length ? `the checked solution${checked.length === 1 ? '' : 's'}` : 'the best'}</h2>
            <span className="spacer" />
            <span className="inline-tools" title="The metrics drawn over the curves">
              <span className="muted small">Overlays</span>
              <OverlayPicker
                entries={onR.map((m) => ({ id: m.id, label: m.label, color: metricColor(m, project.metrics.indexOf(m)), parts: partsOf(m) }))}
                on={respOn}
                setOn={(respMarks) => setOpt({ respMarks })}
                hidden={project.opt.respHidden}
                setHidden={(respHidden) => setOpt({ respHidden })}
              />
            </span>
            <FigureTools
              target={resp}
              name="optimized response"
              csv={() => exportCsv([`${it.label} [${it.unit}]`, 'R start', ...shown.map((v) => `R ${v.label}`)], cv.xs.map((x, i) => [x, cv.start!.R[i], ...shown.map((v) => curveOf(v)?.R[i] ?? NaN)]), 'optimized response')}
            />
          </div>
          <AutoWidth figure={resp}>
            {(w) => (
              <LinePlot
                xAxis={{ ...it, values: cv.xs }}
                series={[
                  { key: 's', label: 'start', color: 'var(--muted)', y: cv.start!.R, dash: '5 4' },
                  ...shown.flatMap((v) => {
                    const c = curveOf(v);
                    return c ? [{ key: v.key, label: v.label, color: v.color, y: c.R, width: 2.2 }] : [];
                  }),
                ]}
                yLabel="R"
                yUnit=""
                yDomain={[0, 1]}
                width={w}
                height={320}
                overlays={respOverlays}
              />
            )}
          </AutoWidth>
          <div className="legend">
            <span><span className="line-key" style={{ background: 'var(--muted)' }} /> start</span>
            {shown.map((v) => (
              <span key={v.key}><span className="line-key" style={{ background: v.color }} /> {v.label === 'best' ? `best (${unit})` : `solution ${v.label}`}</span>
            ))}
          </div>

          {/* the chosen results of the metrics on each curve */}
          <div className="sub-head results-head">
            <h3>Results</h3>
            <span className="spacer" />
            <Chips
              items={cols.map((c) => ({ key: c.key, label: c.label }))}
              all={allCols.map((c) => ({ key: c.key, label: `${c.label}${c.unit ? ` [${c.unit}]` : ''}` }))}
              onAdd={(k) => setView((v) => ({ columns: [...(v.columns ?? defaultCols), k] }))}
              onRemove={(k) => setView((v) => ({ columns: (v.columns ?? defaultCols).filter((x) => x !== k) }))}
              addLabel="Result"
            />
            <button type="button" onClick={resultsCsv}>
              <Icon name="download" size={14} />
              CSV
            </button>
          </div>
          <div className="table-scroll">
            <table className="data solutions-table">
              <thead>
                <tr>
                  <th>Solution</th>
                  {cols.map((c) => <th key={c.key} className="num">{c.label}{c.unit ? ` [${c.unit}]` : ''}</th>)}
                  {run.vars.map((v) => <th key={v.id} className="num">{v.name}{v.unit ? ` [${v.unit}]` : ''}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="start-row">
                  <td><span className="line-key dashed" /> start</td>
                  {cols.map((c) => <td key={c.key} className="num">{fmt(valueIn(cv.start, c))}</td>)}
                  {run.vars.map((v, j) => <td key={v.id} className="num">{varText(j, v.start)}</td>)}
                  <td />
                </tr>
                {shown.map((v) => (
                  <tr key={v.key}>
                    <td>
                      {v.editable ? (
                        <span className="color-dot" style={{ background: v.color }} title="Its colour">
                          <input type="color" aria-label={`Colour of solution ${v.label}`} value={v.color} onChange={(e) => setView((s2) => ({ checked: s2.checked.map((c) => (c.i === v.i ? { ...c, color: e.target.value } : c)) }))} />
                        </span>
                      ) : (
                        <span className="line-key" style={{ background: v.color }} />
                      )}{' '}
                      {v.label === 'best' ? 'best' : `solution ${v.label}`}
                    </td>
                    {cols.map((c) => <td key={c.key} className="num"><b>{curveOf(v) ? fmt(valueIn(curveOf(v), c)) : '…'}</b></td>)}
                    {run.vars.map((d, j) => <td key={d.id} className="num">{varText(j, v.x[j])}</td>)}
                    <td className="row-actions">
                      <button type="button" disabled={!done || otherConfig} title="Write this solution into the structure; recorded on the Compare page" onClick={() => apply(v.x, v.values)}>Apply</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// A view of the Pareto front: two of its quantities, the solutions within the filters, those checked in their colours;
// a click on a point checks it (or unchecks it).
function FrontView({ fv, qs, qLabel, label, front, kept, checked, set, remove, onPick }: {
  fv: { x: number; y: number };
  qs: number[];
  qLabel: (i: number) => string;
  label: (i: number) => Label;
  front: { values?: number[] }[];
  kept: Set<number>;
  checked: { i: number; color: string }[];
  set: (patch: Partial<{ x: number; y: number }>) => void;
  remove?: () => void;
  onPick: (i: number) => void;
}) {
  const fig = useRef<HTMLDivElement>(null);
  const vx = (i: number) => front[i].values?.[fv.x] ?? NaN;
  const vy = (i: number) => front[i].values?.[fv.y] ?? NaN;
  const inside = front.map((_, i) => i).filter((i) => kept.has(i) && !checked.some((c) => c.i === i));
  const outside = front.map((_, i) => i).filter((i) => !kept.has(i));
  const lx = label(fv.x);
  const ly = label(fv.y);
  const series = [
    ...(outside.length ? [{ key: 'out', label: 'filtered out', color: 'var(--border)', x: outside.map(vx), y: outside.map(vy), noLine: true }] : []),
    { key: 'in', label: 'front', color: 'var(--muted)', x: inside.map(vx), y: inside.map(vy), noLine: true },
    ...checked.map((c) => ({ key: `c${c.i}`, label: `#${c.i + 1}`, color: c.color, x: [vx(c.i)], y: [vy(c.i)], noLine: true, width: 3 })),
  ];
  const pick = (key: string, k: number) => onPick(key === 'in' ? inside[k] : key === 'out' ? outside[k] : Number(key.slice(1)));
  return (
    <div className="front-view">
      <div className="front-view-head">
        <Field label="X">
          <select value={fv.x} onChange={(e) => set({ x: Number(e.target.value) })}>
            {qs.map((i) => <option key={i} value={i}>{qLabel(i)}</option>)}
          </select>
        </Field>
        <Field label="Y">
          <select value={fv.y} onChange={(e) => set({ y: Number(e.target.value) })}>
            {qs.map((i) => <option key={i} value={i}>{qLabel(i)}</option>)}
          </select>
        </Field>
        <span className="spacer" />
        <FigureTools target={fig} name={`Pareto front ${lx.text} vs ${ly.text}`} />
        {remove && <IconButton icon="x" label="Take this view away" onClick={remove} />}
      </div>
      <AutoWidth figure={fig} max={640} min={260}>
        {(w) => (
          <LinePlot
            xAxis={{ id: `fx${fv.x}`, label: lx.text, unit: lx.unit, values: front.map((_, i) => vx(i)) }}
            series={series}
            yLabel={ly.text}
            yUnit={ly.unit}
            width={w}
            height={280}
            onPick={pick}
            overlays={checked.map((c) => ({ kind: 'marker' as const, key: `m${c.i}`, x: vx(c.i), y: vy(c.i), color: c.color }))}
          />
        )}
      </AutoWidth>
    </div>
  );
}
