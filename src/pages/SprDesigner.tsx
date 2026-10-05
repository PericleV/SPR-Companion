// SPR sensors designed by a genetic algorithm over layer sequences (Sebek et al. 2023, spr-forge's engine): the prisms
// and the materials of each role, their limits, the angular scan, the objective (S or S / FWHM), the single-mode
// conditions; the run, its history and the best structure, applied to the project on request.
import { useMemo, useRef } from 'react';
import { useProject } from '../state.tsx';
import { compiled, SPR_CLASSES, SPR_NAMES, type SprClass } from '../engine/sprDesign.ts';
import { describeSpr, problemOf, ROLE_LABEL, structureOf, suggestedRole, termsExpr, type SprDesign, type SprTerm } from '../model/sprGa.ts';

const SPR_NAME_LABEL: Record<string, string> = {
  S: 'sensitivity S [deg/RIU]',
  FWHM: 'FWHM [deg]',
  FOM: 'S / FWHM [1/RIU]',
  Rmin: 'R at the dip',
  depth: 'dip depth',
  theta: 'dip angle [deg]',
  dtheta: 'dip shift [deg]',
  layers: 'number of layers',
  thickness: 'total thickness [nm]',
  asym: 'left / right half width',
};
import { startSpr, stopSpr, useSprRun } from '../workers/optRuntime.ts';
import { groupOf } from '../physics/library.ts';
import { LinePlot } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { MaterialSelect } from '../ui/MaterialSelect.tsx';
import { Field, Icon, IconButton, Segmented, Switch } from '../ui/kit.tsx';

export function SprDesigner() {
  const { project, update, lib, models } = useProject();
  const d = project.spr;
  const set = (patch: Partial<SprDesign>) => update((p) => ({ ...p, spr: { ...p.spr, ...patch } }));
  const setRole = (c: SprClass, patch: Partial<SprDesign['roles'][SprClass]>) => set({ roles: { ...d.roles, [c]: { ...d.roles[c], ...patch } } });
  const run = useSprRun();
  const running = run?.status === 'running';
  const fig = useRef<HTMLDivElement>(null);
  const problem = useMemo(() => problemOf(d, lib, models), [d, lib, models]);
  const all = [...lib.values()];
  const roleOf = useMemo(() => new Map(all.map((m) => [m.id, suggestedRole(lib, models, m.id, d.lambda)])), [lib, models, d.lambda]); // eslint-disable-line react-hooks/exhaustive-deps
  const transparent = all.filter((m) => groupOf(m) !== 'Metals' && roleOf.get(m.id) === 'dielectric' && !m.monolayer);
  const best = run?.progress?.best;

  const apply = () => {
    if (!run || !best) return;
    update((p) => ({ ...p, structure: structureOf(run.problem, best.s, run.medium), sim: { ...p.sim, mode: 'theta', lambda: run.problem.lambda, from: run.problem.thetaMin, to: run.problem.thetaMax } }));
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Sensor</h2>
          <span className="sub">prism | layer sequence of the selected materials | analyte; fitness: angular sensitivity S = Δθ/Δn of the TM resonance, or S/FWHM</span>
        </div>
        <div className="grid-fields">
          <NumberField label="λ" unit="nm" value={d.lambda} onChange={(lambda) => set({ lambda })} min={1} />
          <Field label="Sensing medium">
            <MaterialSelect value={d.medium} onChange={(medium) => set({ medium })} />
          </Field>
          <NumberField label="Δn" value={d.dn} onChange={(dn) => dn > 0 && set({ dn })} min={0} />
          <Field label="Fitness">
            <select value={d.objective} onChange={(e) => set({ objective: e.target.value as SprDesign['objective'] })}>
              <option value="S">S (deg/RIU)</option>
              <option value="FOM">S / FWHM (1/RIU)</option>
              <option value="multi">several objectives</option>
              <option value="custom">a formula</option>
            </select>
          </Field>
          <NumberField label="θ from" unit="°" value={d.thetaMin} onChange={(thetaMin) => set({ thetaMin })} min={0} max={89.99} />
          <NumberField label="θ to" unit="°" value={d.thetaMax} onChange={(thetaMax) => set({ thetaMax })} min={0} max={89.99} />
          <NumberField label="Step" unit="°" value={d.step} onChange={(step) => step > 0 && set({ step })} min={0} />
          <NumberField label="Dips up to" unit="°" value={d.maxTheta} onChange={(maxTheta) => set({ maxTheta })} min={0} max={90} title="Dips beyond this angle do not count (90: no limit)" />
        </div>
        {d.objective === 'multi' && (
          <div className="sub-block">
            <table className="data terms">
              <thead>
                <tr><th>Goal</th><th>Quantity</th><th>Weight (power)</th><th /></tr>
              </thead>
              <tbody>
                {d.terms.map((x, i) => {
                  const setT = (patch: Partial<SprTerm>) => set({ terms: d.terms.map((y, k) => (k === i ? { ...y, ...patch } : y)) });
                  return (
                    <tr key={i}>
                      <td>
                        <Segmented<SprTerm['goal']>
                          value={x.goal}
                          onChange={(goal) => setT({ goal })}
                          options={[
                            { id: 'max', label: 'Max', title: 'Maximize' },
                            { id: 'min', label: 'Min', title: 'Minimize' },
                          ]}
                        />
                      </td>
                      <td>
                        <select aria-label="Quantity" value={x.q} onChange={(e) => setT({ q: e.target.value })}>
                          {SPR_NAMES.map((n) => <option key={n} value={n}>{SPR_NAME_LABEL[n]}</option>)}
                        </select>
                      </td>
                      <td><NumberField bare label="Weight (power)" value={x.weight} onChange={(weight) => setT({ weight })} min={0} className="tiny" /></td>
                      <td className="row-actions"><IconButton icon="x" label="Remove" onClick={() => set({ terms: d.terms.filter((_, k) => k !== i) })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="run-row">
              <button type="button" onClick={() => set({ terms: [...d.terms, { q: 'depth', goal: 'max', weight: 1 }] })}>
                <Icon name="plus" size={14} />
                Objective
              </button>
              <span className="muted small">fitness = <span className="mono">{termsExpr(d.terms)}</span> (scale-free: the weights are powers)</span>
            </div>
          </div>
        )}
        {d.objective === 'custom' && (
          <div className="grid-fields formula-row">
            <Field label="Fitness =" className="span-all" title={`Names: ${SPR_NAMES.join(', ')}; functions abs sqrt exp log log10 min max pow`}>
              <input type="text" className={d.expr && typeof compiled(d.expr) === 'string' ? 'bad' : ''} value={d.expr} onChange={(e) => set({ expr: e.target.value })} placeholder="e.g. S * depth / sqrt(FWHM)" />
            </Field>
            <span className="muted small span-all">{SPR_NAMES.map((n) => `${n} (${SPR_NAME_LABEL[n]})`).join(', ')} — larger is better, must be positive</span>
          </div>
        )}
        <details className="mat-cands">
          <summary>Prisms: {d.prisms.map((id) => lib.get(id)?.name ?? id).join(', ') || '—'} (the algorithm picks one)</summary>
          <div className="mat-picks">
            {transparent.map((m) => (
              <label key={m.id} className="check small">
                <input type="checkbox" checked={d.prisms.includes(m.id)} onChange={(e) => set({ prisms: e.target.checked ? [...d.prisms, m.id] : d.prisms.filter((x) => x !== m.id) })} /> {m.name}
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Roles</h2>
          <span className="sub">bold: the materials whose index at {d.lambda} nm suggests the role</span>
        </div>
        <div className="table-scroll">
        <table className="data roles">
          <thead>
            <tr><th>Role</th><th>Materials</th><th className="num">Layers min</th><th className="num">max</th><th className="num">Thickness min</th><th className="num">max</th></tr>
          </thead>
          <tbody>
            {SPR_CLASSES.map((c) => {
              const r = d.roles[c];
              const u = c === 'twoD' ? 'monolayers' : 'nm';
              return (
                <tr key={c}>
                  <td>{ROLE_LABEL[c]}</td>
                  <td>
                    <details className="mat-cands">
                      <summary>{r.mats.map((id) => lib.get(id)?.name ?? id).join(', ') || '—'}</summary>
                      <div className="mat-picks">
                        {all
                          .filter((m) => (c === 'twoD' ? !!m.monolayer : !m.monolayer))
                          .map((m) => (
                            <label key={m.id} className={`check small${roleOf.get(m.id) === c ? ' strong' : ''}`}>
                              <input type="checkbox" checked={r.mats.includes(m.id)} onChange={(e) => setRole(c, { mats: e.target.checked ? [...r.mats, m.id] : r.mats.filter((x) => x !== m.id) })} /> {m.name}
                            </label>
                          ))}
                      </div>
                    </details>
                  </td>
                  <td className="num"><NumberField bare label={`${ROLE_LABEL[c]}: layers min`} value={r.min} onChange={(min) => setRole(c, { min: Math.max(0, Math.round(min)) })} min={0} className="tiny" /></td>
                  <td className="num"><NumberField bare label={`${ROLE_LABEL[c]}: layers max`} value={r.max} onChange={(max) => setRole(c, { max: Math.max(0, Math.round(max)) })} min={0} className="tiny" /></td>
                  <td className="num"><NumberField bare label={`${ROLE_LABEL[c]}: thickness min`} value={r.tMin} onChange={(tMin) => setRole(c, { tMin: Math.max(1, Math.round(tMin)) })} min={1} className="tiny" /></td>
                  <td className="num"><NumberField bare label={`${ROLE_LABEL[c]}: thickness max`} unit={u} value={r.tMax} onChange={(tMax) => setRole(c, { tMax: Math.max(1, Math.round(tMax)) })} min={1} className="tiny" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="grid-fields roles-settings">
          <NumberField label="At most layers" value={d.maxLayers} onChange={(maxLayers) => set({ maxLayers: Math.max(1, Math.round(maxLayers)) })} min={1} />
          <Field label="Layer maxima" title="The maximum numbers of layers hold in every generation (the article: only in the first population)">
            <Switch checked={d.holdCounts} onChange={(holdCounts) => set({ holdCounts })} label="In every generation" />
          </Field>
          <Field label="Dip shape" title="Single-mode conditions of the article: dip depth, left / right half width, smoothness">
            <Switch checked={d.single} onChange={(single) => set({ single })} label="Single-mode dip" />
          </Field>
          {d.single && (
            <>
              <NumberField label="Min depth" value={d.minDepth} onChange={(minDepth) => set({ minDepth })} min={0} max={1} />
              <NumberField label="Max left / right half width" value={d.maxAsym} onChange={(maxAsym) => set({ maxAsym })} min={1} />
              <Field label="Smoothness">
                <Switch checked={d.smooth} onChange={(smooth) => set({ smooth })} label="Smooth" />
              </Field>
            </>
          )}
          <Field label="n + Δn" title="The dip of n + Δn is the one with the most similar shape (mode jumps)">
            <Switch checked={d.trace} onChange={(trace) => set({ trace })} label="Trace the dip" />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Genetic algorithm</h2>
        </div>
        <div className="grid-fields">
          <NumberField label="Population" value={d.ga.population} onChange={(population) => set({ ga: { ...d.ga, population: Math.max(4, Math.round(population)) } })} min={4} />
          <NumberField label="Generations" value={d.ga.generations} onChange={(generations) => set({ ga: { ...d.ga, generations: Math.max(1, Math.round(generations)) } })} min={1} />
          <NumberField label="Elites (fraction)" value={d.ga.elite} onChange={(elite) => set({ ga: { ...d.ga, elite } })} min={0} max={0.9} />
          <NumberField label="Mutations (fraction of the children)" value={d.ga.mutation} onChange={(mutation) => set({ ga: { ...d.ga, mutation } })} min={0} max={1} />
          <NumberField label="Seed" value={d.ga.seed} onChange={(seed) => set({ ga: { ...d.ga, seed: Math.round(seed) } })} />
        </div>
        <div className="run-row">
          {!running ? (
            <button className="primary" disabled={typeof problem === 'string'} onClick={() => typeof problem !== 'string' && startSpr(problem, d.ga, d.medium)}>
              <Icon name="play" size={14} />
              Start
            </button>
          ) : (
            <button onClick={stopSpr}>Stop</button>
          )}
          {run && (
            <span className="muted">
              {run.status} · {run.progress?.phase === 'initial' ? `first population: ${run.progress.population.length} of ${d.ga.population} found (${run.progress.tried} tried)` : `generation ${run.progress?.generation ?? 0}`} · {run.progress?.evaluations ?? 0} structures · {run.elapsed.toFixed(1)} s
            </span>
          )}
        </div>
        {typeof problem === 'string' && <div className="msg warn">{problem}</div>}
        {run?.message && <div className="msg err">{run.message}</div>}
      </section>

      {run?.progress && (
        <section className="card">
          <div className="card-head">
            <h2>Best structure</h2>
            <span className="spacer" />
            <FigureTools target={fig} name="layer GA history" />
          </div>
          {best ? (
            <>
              <p className="mono">{describeSpr(run.problem, best.s)}</p>
              <div className="metric-values">
                <span>S <b>{best.ev.S.toFixed(1)}</b> deg/RIU</span>
                <span>FWHM <b>{best.ev.fwhm.toFixed(3)}</b>°</span>
                <span>FOM <b>{best.ev.fom.toFixed(1)}</b> 1/RIU</span>
                <span>dip <b>{best.ev.a.theta.toFixed(3)}</b>° → <b>{best.ev.b.theta.toFixed(3)}</b>°</span>
                <span>R min <b>{best.ev.a.R.toFixed(4)}</b></span>
                {(d.objective === 'multi' || d.objective === 'custom') && <span>fitness <b>{+best.ev.fitness.toPrecision(5)}</b></span>}
              </div>
              <p className="muted small">lineage: {best.ops.join(' → ')}</p>
            </>
          ) : (
            <p className="muted">No structure yet.</p>
          )}
          {run.progress.history.length > 1 && (
            <AutoWidth figure={fig} max={720}>
              {(w) => (
                <LinePlot
                  xAxis={{ id: 'g', label: 'generation', unit: '', values: run.progress!.history.map((_, i) => i) }}
                  series={[
                    { key: 'b', label: 'best', color: 'var(--line)', y: run.progress!.history },
                    { key: 'm', label: 'mean', color: 'var(--muted)', y: run.progress!.mean, dash: '5 4' },
                  ]}
                  yLabel={d.objective === 'S' ? 'S' : d.objective === 'FOM' ? 'S / FWHM' : 'fitness'}
                  yUnit={d.objective === 'S' ? 'deg/RIU' : d.objective === 'FOM' ? '1/RIU' : ''}
                  width={w}
                  height={260}
                />
              )}
            </AutoWidth>
          )}
          <div className="run-row">
            <button className="primary" disabled={!best || running} onClick={apply} title="The structure becomes the project's (the Simulation scans θ at λ)">Apply to the project</button>
            {running && <span className="muted small">(when the run ends)</span>}
          </div>
        </section>
      )}
    </>
  );
}
