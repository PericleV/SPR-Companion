// Sensorgram page: a binding experiment on the configuration's structure (after SPR Forge's Binding kinetics and
// Sensorgram nodes). Left: the analyte and the surface, the kinetics and the protocol (a series of concentrations or of
// a constant, a planner for the concentration series), where the signal changes and how it is read, the instrument.
// Right: the bound amount (live), the sensorgram (on Run: the reflectance recomputed at every time in the workers), its
// summary (calibration, detection limit), the curves over the scan at chosen times and the steady-state analysis.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useProject } from '../state.tsx';
import { interrogationOf } from '../model/analysis.ts';
import { ANALYTES, MODEL_TEXT, SERIES_OF, SG_QUANTITIES, type SgQuantity, applySeriesPlan, kineticsOf, planSeries, rsaModel, sgOf, type SgKinetics, type SgResult, type SgSeriesOf, type SgSettings, type SgStep } from '../model/sensorgram.ts';
import { surfaceOf, type KineticModel } from '../engine/kinetics.ts';
import type { LocateMethod } from '../engine/metrics.ts';
import { clearSg, sgKey, startSg, stopSg, useSgRuns, warmSg, type SgRun } from '../workers/sgRuntime.ts';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import { MapPlot } from '../plot/MapPlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { seriesColor } from '../plot/colors.ts';
import type { Overlay } from '../plot/overlays.ts';
import { exportCsv } from '../plot/export.ts';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { Board, type BoardItem } from '../ui/Board.tsx';
import { Expander, Field, Icon, IconButton, MenuButton, Segmented, Switch } from '../ui/kit.tsx';

const fmt = (v: number, d = 4) => (Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');
const TIME = { id: 'time', label: 't', unit: 's' };
const INJECT = '#4f8ef7'; // (the plot draws a span at 8 % opacity)

// A list of numbers typed as text (comma or space separated): the text kept while typing, the numbers reported.
function ListField({ label, values, onChange, title, className = '', integer }: { label: string; values: number[]; onChange: (v: number[]) => void; title?: string; className?: string; integer?: boolean }) {
  const [text, setText] = useState(values.join(', '));
  const [shown, setShown] = useState(values);
  if (values.join(',') !== shown.join(',')) {
    setShown(values);
    setText(values.join(', '));
  }
  const parse = (t: string) => t.split(/[\s,;]+/).filter(Boolean).map(Number);
  const nums = parse(text);
  const valid = nums.every((x) => Number.isFinite(x) && (!integer || Number.isInteger(x)));
  return (
    <Field label={label} title={title} className={className}>
      <input
        type="text"
        className={valid ? '' : 'bad'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (v.every((x) => Number.isFinite(x) && (!integer || Number.isInteger(x)))) {
            setShown(v);
            onChange(v);
          }
        }}
      />
    </Field>
  );
}

// Spans of the injections (steps with analyte) on a time axis.
const injectionSpans = (kin: SgKinetics): Overlay[] => kin.steps.flatMap((st, i): Overlay[] => (st.c > 0 && st.t1 > st.t0 ? [{ kind: 'span', key: `inj${i}`, lo: st.t0, hi: st.t1, color: INJECT, text: st.label }] : []));

// The quantities of the bound amount (live plot).
const KIN_SHOW: { id: string; label: string; unit: string; swelling?: boolean }[] = [
  { id: 'RU', label: 'R — bound response', unit: 'RU' },
  { id: 'Gamma', label: 'Γ — bound mass', unit: 'ng/mm²' },
  { id: 'jam', label: 'Γ / Γ∞ — fraction of a full random monolayer', unit: '' },
  { id: 'conc', label: 'c — analyte concentration', unit: 'nM' },
  { id: 'swell', label: 's — swelling (relative thickness increase)', unit: '', swelling: true },
];
function kinCurve(kin: SgKinetics, k: number, show: string): number[] {
  const r = kin.runs[k];
  if (show === 'swell') return r.s;
  if (show === 'Gamma') return r.R.map((v) => v / 1000);
  if (show === 'jam') return r.R.map((v) => v / (1000 * kin.surfaces[k].capacity));
  if (show === 'conc') return r.c.map((v) => v * 1e9);
  return r.R;
}

export function Sensorgram() {
  const { project, update, lib, models } = useProject();
  const sg = sgOf(project.sg);
  const set = (patch: Partial<SgSettings>) => update((p) => ({ ...p, sg: { ...sgOf(p.sg), ...patch } }));
  const setInst = (patch: Partial<SgSettings['inst']>) => set({ inst: { ...sg.inst, ...patch } });
  const it = interrogationOf(project.sim);
  const key = sgKey(project.structure, it, sg, project.materials);
  const calcKey = useMemo(() => {
    const { show: _a, kinShow: _b, mapSeries: _c, mapSeed: _d, times: _e, cards: _u, showMap: _v, plan: _w, target: _f, thick: _g, mixing: _h, bulk: _i, drift: _j, scan: _k, readout: _l, at: _m, track: _n, locate: _o, locLevel: _p, locDeg: _q, maxTimes: _r, inst: _s, seeds: _t, ...k } = sg;
    void [_a, _b, _c, _d, _e, _u, _v, _w, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t];
    return JSON.stringify(k);
  }, [sg]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kin = useMemo(() => kineticsOf(sg), [calcKey]);
  const runs = useSgRuns();
  useEffect(() => warmSg(), []); // (the workers start while the settings are read)
  const run: SgRun | undefined = runs[project.configId];
  const running = run?.status === 'running';
  const stale = !!run && run.key !== key;
  const res = run?.result;
  const start = () => startSg(project.configId, project.materials, project.structure, it, sg, lib, models, key);
  const swelling = sg.model === 'swelling';
  const rsa = sg.surface === 'rsa' && rsaModel(sg.model);
  const matName = (id: string) => lib.get(id)?.name ?? id;
  const sensingId = project.structure.reversed ? project.structure.incident.id : project.structure.exit.id;

  const figKin = useRef<HTMLDivElement>(null);
  const figSg = useRef<HTMLDivElement>(null);
  const figMap = useRef<HTMLDivElement>(null);
  const figCurves = useRef<HTMLDivElement>(null);
  const figSteady = useRef<HTMLDivElement>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const cards = sg.cards;
  const removeBtn = (k: string) => <IconButton icon="x" label="Remove this plot (Add plot brings it back)" onClick={() => set({ cards: cards.filter((c) => c !== k) })} />;

  // ---- the analyte and the surface ----
  const preset = sg.analyte !== 'custom' ? ANALYTES[sg.analyte] : null;
  const surf = (() => {
    try {
      const an = preset ?? { name: '', mw: sg.mw, dndc: sg.dndc, rho: sg.rho, dims: sg.dims };
      return an.dims.every((v) => v > 0) && sg.ionic > 0 ? surfaceOf(an, sg.orient, sg.ionic, sg.zeta) : null;
    } catch {
      return null;
    }
  })();
  const analyteCard = (
    <section className="card">
      <div className="card-head">
        <h2>Analyte and surface</h2>
        <span className="sub">the molecule that binds and how it sits on the surface</span>
      </div>
      <div className="grid-fields">
        <Field label="Analyte">
          <select
            value={sg.analyte}
            onChange={(e) => {
              const v = e.target.value;
              const from = ANALYTES[sg.analyte];
              // custom: starts from the preset's values
              set(v === 'custom' && from ? { analyte: v, mw: from.mw, dndc: from.dndc, rho: from.rho, dims: [...from.dims] } : { analyte: v });
            }}
          >
            {Object.entries(ANALYTES).map(([id, a]) => (
              <option key={id} value={id}>{a.name}</option>
            ))}
            <option value="custom">custom…</option>
          </select>
        </Field>
        <Field label="On the surface" title="Lying (its two longest axes on the surface) or standing (its longest axis up)">
          <Segmented value={sg.orient} options={[{ id: 'side', label: 'lying', title: 'side-on: covers a × b, c high' }, { id: 'end', label: 'standing', title: 'end-on: covers b × c, a high' }]} onChange={(orient) => set({ orient })} />
        </Field>
      </div>
      {preset ? (
        <p className="muted small">
          {fmt(preset.mw / 1000)} kDa · dn/dc {preset.dndc} mL/g · ρ {preset.rho} g/cm³ · {preset.dims.join(' × ')} nm
        </p>
      ) : (
        <div className="grid-fields sg-custom">
          <NumberField label="MW" unit="kDa" value={sg.mw / 1000} min={0} onChange={(v) => set({ mw: v * 1000 })} />
          <NumberField label="dn/dc" unit="mL/g" value={sg.dndc} min={0} onChange={(dndc) => set({ dndc })} />
          <NumberField label="ρ" unit="g/cm³" value={sg.rho} min={0} onChange={(rho) => set({ rho })} />
          {(['a', 'b', 'c'] as const).map((n, i) => (
            <NumberField key={n} label={n} unit="nm" value={sg.dims[i]} min={0} onChange={(v) => set({ dims: sg.dims.map((x, j) => (j === i ? v : x)) as [number, number, number] })} />
          ))}
        </div>
      )}
      <div className="sub-title">Surface</div>
      <div className="grid-fields">
        {rsaModel(sg.model) && (
          <Field label="Binds to" className="span-2" title="Ligand sites: the analyte binds to immobilized ligands (free sites Rmax − R). Free surface: the molecules adsorb anywhere and cannot overlap (random sequential adsorption); Rmax is then the jamming capacity.">
            <Segmented value={sg.surface} options={[{ id: 'ligand', label: 'ligand sites' }, { id: 'rsa', label: 'free surface (RSA)' }]} onChange={(surface) => set({ surface })} />
          </Field>
        )}
        <NumberField label="Ionic strength I" unit="mM" value={sg.ionic} min={0} onChange={(ionic) => set({ ionic })} title="Ionic strength of the buffer (1:1 salt): the Debye length κ⁻¹ = 0.304 nm / √I[M]" />
        <NumberField label="ζ potential" unit="mV" value={sg.zeta} onChange={(zeta) => set({ zeta })} title="ζ potential of the analyte: bound molecules repel each other across the double layer and pack as larger hard discs (Adamczyk, 1 kT)" />
      </div>
      {surf && !swelling && (
        <table className="kv sg-kv">
          <tbody>
            <tr><th>molecule</th><td>{fmt(surf.height, 3)} nm high, footprint {fmt(surf.foot, 3)} nm (equivalent disc)</td></tr>
            <tr><th>double layer</th><td>Debye length {fmt(surf.debye, 3)} nm; repulsion adds {fmt(surf.gap, 3)} nm → effective disc {fmt(surf.dEff, 3)} nm</td></tr>
            <tr><th>full random monolayer</th><td>Γ∞ = {fmt(surf.capacity, 3)} ng/mm² = {fmt(surf.capacity * 1000, 3)} RU (projected coverage {fmt(100 * surf.thetaMax, 3)} %)</td></tr>
            {!rsa && <tr><th>Rmax</th><td>{fmt((100 * (sg.model === 'hetero' ? sg.rmax + sg.rmax2 : sg.rmax)) / (surf.capacity * 1000), 3)} % of Γ∞</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );

  // ---- the kinetics, the protocol, the series ----
  const num = (label: string, k: keyof SgSettings, unit: string, title?: string) => <NumberField label={label} unit={unit} value={sg[k] as number} min={0} onChange={(v) => set({ [k]: v } as Partial<SgSettings>)} title={title} />;
  const setStep = (i: number, patch: Partial<SgStep>) => set({ steps: sg.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const plan = planSeries(sg);
  const setPlan = (patch: Partial<SgSettings['plan']>) => set({ plan: { ...sg.plan, ...patch } });
  const seriesOn = sg.seriesOf !== 'none';
  const seriesChoices = (Object.keys(SERIES_OF) as SgSeriesOf[]).filter((k) => {
    if (swelling) return ['none', 'tau'].includes(k);
    if (k === 'tau') return false;
    if (k === 'kt') return sg.model === 'transport';
    if (k === 'ka2' || k === 'kd2') return ['bivalent', 'hetero', 'twostate'].includes(sg.model);
    if (k === 'rmax') return !rsa;
    return true;
  });
  const kineticsCard = (
    <section className="card">
      <div className="card-head">
        <h2>Binding kinetics</h2>
        <span className="sub">the model, its constants and the protocol of injections</span>
      </div>
      <div className="grid-fields">
        <Field label="Model" className="span-2">
          <select value={sg.model} onChange={(e) => set({ model: e.target.value as KineticModel, ...(e.target.value === 'swelling' && sg.seriesOf !== 'tau' ? { seriesOf: 'none' } : {}) })}>
            {(Object.keys(MODEL_TEXT) as KineticModel[]).map((m) => (
              <option key={m} value={m}>{MODEL_TEXT[m]}</option>
            ))}
          </select>
        </Field>
        {swelling ? (
          num('τ', 'tau', 's', 'Time constant of the swelling: ds/dt = (s∞ − s)/τ')
        ) : (
          <>
            {num('ka', 'ka', 'M⁻¹s⁻¹', 'Association rate constant')}
            {num('kd', 'kd', 's⁻¹', 'Dissociation rate constant')}
            {!rsa && num('Rmax', 'rmax', 'RU', 'The response of a full surface (1000 RU = 1 ng/mm²)')}
            {sg.model === 'transport' && num('kt', 'kt', 'RU M⁻¹s⁻¹', 'Mass-transport coefficient (two-compartment model, Myszka 1998): kt = km·MW·10⁹, km in m/s')}
            {sg.model === 'bivalent' && num('ka2', 'ka2', 'RU⁻¹s⁻¹', 'The second site of the analyte: AB + B ⇌ AB₂')}
            {sg.model === 'hetero' && num('ka2', 'ka2', 'M⁻¹s⁻¹', 'The second kind of site')}
            {sg.model === 'twostate' && num('ka2', 'ka2', 's⁻¹', 'The conformational change AB → AB*')}
            {['bivalent', 'hetero', 'twostate'].includes(sg.model) && num('kd2', 'kd2', 's⁻¹')}
            {sg.model === 'hetero' && num('Rmax2', 'rmax2', 'RU')}
          </>
        )}
      </div>
      {!swelling && sg.ka > 0 && sg.kd > 0 && <p className="muted small">KD = kd / ka = {fmt((sg.kd / sg.ka) * 1e9)} nM{rsa ? ' · on a free surface Rmax is the jamming capacity' : ''}</p>}
      <div className="sub-title">Protocol</div>
      <div className="table-scroll">
        <table className="data sg-steps">
          <thead>
            <tr>
              <th>#</th>
              <th>Step</th>
              <th className="num">Duration [s]</th>
              <th className="num">{swelling ? 's∞' : 'c [nM]'}</th>
              {!swelling && <th title="Regeneration: the bound analyte is removed at the start of the step">Regen.</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {sg.steps.map((s, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td><input type="text" aria-label={`Step ${i + 1}: name`} className="name" value={s.label} placeholder={s.c > 0 ? 'injection' : 'buffer'} onChange={(e) => setStep(i, { label: e.target.value })} /></td>
                <td className="num"><NumberField bare label={`Step ${i + 1}: duration`} value={s.t} min={0} onChange={(t) => setStep(i, { t })} className="short" /></td>
                <td className="num">
                  {swelling ? <NumberField bare label={`Step ${i + 1}: s∞`} value={s.swell ?? 0} onChange={(swell) => setStep(i, { swell })} className="short" /> : <NumberField bare label={`Step ${i + 1}: concentration`} value={s.c} min={0} onChange={(c) => setStep(i, { c })} className="short" />}
                </td>
                {!swelling && <td><input type="checkbox" aria-label={`Step ${i + 1}: regeneration`} checked={!!s.regen} onChange={(e) => setStep(i, { regen: e.target.checked })} /></td>}
                <td>
                  <span className="row-actions">
                    <IconButton icon="up" label="Move up" disabled={i === 0} onClick={() => set({ steps: sg.steps.map((x, j) => (j === i - 1 ? sg.steps[i] : j === i ? sg.steps[i - 1] : x)) })} />
                    <IconButton icon="trash" label="Remove the step" onClick={() => set({ steps: sg.steps.filter((_, j) => j !== i) })} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-row sg-row">
        <button type="button" onClick={() => set({ steps: [...sg.steps, { label: '', t: 300, c: 0, ...(swelling ? { swell: 0 } : {}) }] })}>
          <Icon name="plus" size={14} />
          Step
        </button>
        <NumberField label="Sample every" unit="s" value={sg.dt} min={0} onChange={(dt) => set({ dt })} className="tiny" title="Time between the samples of the kinetics (the integration itself is finer)" />
      </div>
      <div className="sub-title">Series</div>
      <div className="grid-fields">
        <Field label="One curve per value of" className="span-2">
          <select value={seriesChoices.includes(sg.seriesOf) ? sg.seriesOf : 'none'} onChange={(e) => set({ seriesOf: e.target.value as SgSeriesOf })}>
            {seriesChoices.map((k) => (
              <option key={k} value={k}>{SERIES_OF[k].label}</option>
            ))}
          </select>
        </Field>
        {seriesOn && <ListField label={`Values${SERIES_OF[sg.seriesOf].unit ? ` [${SERIES_OF[sg.seriesOf].unit}]` : ''}`} values={sg.series} onChange={(series) => set({ series })} className="span-2" title={sg.seriesOf === 'c' ? 'Each value scales the injections: the highest step concentration becomes this value' : undefined} />}
      </div>
      {!swelling && (
        <Expander open={planOpen} onToggle={() => setPlanOpen(!planOpen)} summary={<span className="sub-title sg-plan-title">Plan a concentration series</span>} className="sg-plan">
          {'error' in plan ? (
            <p className="muted small">{plan.error}</p>
          ) : (
            <>
              <p className="muted small">
                Concentrations around KD (the isotherm bends between 0.1 and 10 KD), each injection long enough for the lowest one to reach 95 % of its equilibrium (t₉₅ = ln 20 / (ka·c + kd); ka of the model, kd = KD·ka). Change anything below, type the concentrations over, then Apply.
              </p>
              <div className="grid-fields sg-plan-fields">
                <Field label="KD estimated [nM]" title="Your estimate of KD; empty: kd/ka of the model">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={sg.kd > 0 ? `${fmt((sg.kd / sg.ka) * 1e9)} (kd/ka)` : 'KD'}
                    value={Number.isFinite(sg.plan.KD) ? String(sg.plan.KD) : ''}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPlan({ KD: e.target.value.trim() && v > 0 ? v : NaN });
                    }}
                  />
                </Field>
                <NumberField label="Concentrations" value={sg.plan.count} min={2} max={12} onChange={(count) => setPlan({ count: Math.round(count), cs: undefined })} title="How many (evenly on a log scale)" />
                <NumberField label="From [× KD]" value={sg.plan.from} min={0} onChange={(from) => setPlan({ from, cs: undefined })} />
                <NumberField label="To [× KD]" value={sg.plan.to} min={0} onChange={(to) => setPlan({ to, cs: undefined })} />
                <NumberField label="Longest injection" unit="s" value={sg.plan.maxInject} min={10} onChange={(maxInject) => setPlan({ maxInject })} title="The injection (and the dissociation) at most this long" />
              </div>
              <table className="data sg-plan-table">
                <thead>
                  <tr>
                    <th className="num">c [nM]</th>
                    <th className="num">c / KD</th>
                    <th className="num">kobs [s⁻¹]</th>
                    <th className="num">t₉₅ [s]</th>
                    <th className="num" title="The fraction of its equilibrium each concentration reaches in the planned injection">reached</th>
                    <th className="num">Req / Rmax</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="num"><NumberField bare label={`Concentration ${i + 1}`} value={r.c} min={0} onChange={(c) => setPlan({ cs: plan.cs.map((x, j) => (j === i ? c : x)) })} className="short" /></td>
                      <td className="num">{fmt(r.c / plan.KD, 2)}</td>
                      <td className="num">{fmt(r.kobs, 3)}</td>
                      <td className="num">{fmt(r.t95, 3)}</td>
                      <td className={`num${r.reached < 0.95 ? ' bad-mark' : ''}`}>{Math.round(100 * r.reached)} %</td>
                      <td className="num">{fmt(r.frac, 2)}</td>
                      <td><IconButton icon="x" label="Remove this concentration" onClick={() => setPlan({ cs: plan.cs.filter((_, j) => j !== i) })} disabled={plan.cs.length < 3} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="form-row sg-row">
                <button type="button" onClick={() => setPlan({ cs: [...plan.cs, +(plan.cs[plan.cs.length - 1] * 2).toPrecision(2)] })}>
                  <Icon name="plus" size={14} />
                  Concentration
                </button>
                {plan.custom && (
                  <button type="button" className="link small" onClick={() => setPlan({ cs: undefined })}>
                    back to the generated ones
                  </button>
                )}
              </div>
              <p className="muted small">
                KD {fmt(plan.KD)} nM{plan.auto ? ' (kd/ka of the model)' : ' (estimated)'} · injection {plan.inject} s{plan.capped ? ' (the longest allowed)' : ''} · dissociation {plan.diss} s (10 % of the bound analyte leaves: ln(10/9)/kd; half-life {fmt(plan.half, 3)} s)
              </p>
              {plan.notes.map((n, i) => (
                <div key={i} className="msg warn small">{n}</div>
              ))}
              <div className="form-row sg-row">
                <Switch checked={sg.plan.diss} onChange={(diss) => setPlan({ diss })} label="also the dissociation steps" title="Apply sets the buffer step after each injection to the planned dissociation" />
                <button type="button" className="primary" onClick={() => set(applySeriesPlan(sg, plan))} title="The series of concentrations, every injection (and dissociation) that long">
                  <Icon name="check" size={14} />
                  Apply
                </button>
              </div>
            </>
          )}
        </Expander>
      )}
      {kin.errors.map((e, i) => (
        <div key={i} className="msg err">{e}</div>
      ))}
    </section>
  );

  // ---- where the signal changes, the read-out, the run ----
  const films = project.structure.blocks.flatMap((b, i) => (b.kind === 'film' ? [{ id: b.id, label: `Film ${i + 1}: ${b.label || matName(b.mat.id)}${b.label ? ` · ${matName(b.mat.id)}` : ''}, ${+b.d.toFixed(2)} nm` }] : []));
  const ownScan = sg.scan.mode === 'own';
  const scanUnit = it.mode === 'lambda' ? 'nm' : '°';
  const signalCard = (
    <section className="card">
      <div className="card-head">
        <h2>Signal and read-out</h2>
        <span className="sub">where the bound mass changes the structure, and what the instrument reads</span>
      </div>
      <div className="grid-fields">
        <Field label="Where the signal changes" className="span-all">
          <select value={sg.target} onChange={(e) => set({ target: e.target.value })}>
            <option value="">{`Sensing medium (${matName(sensingId)}): a binding layer on it`}</option>
            {films.map((f) => (
              <option key={f.id} value={f.id}>{`${f.label}: ${swelling ? 'swells' : 'takes up the analyte'}`}</option>
            ))}
          </select>
        </Field>
        {!sg.target && !swelling && (
          <Field label="Binding layer" className="span-2" title="Monolayer → multilayer: as high as the molecule, filled by the bound mass up to a full random monolayer, thicker beyond. Compact: all the mass as a dense layer of the analyte, d = Γ/ρ.">
            <Segmented value={sg.thick} options={[{ id: 'auto', label: 'monolayer → multilayer' }, { id: 'compact', label: 'compact' }]} onChange={(thick) => set({ thick })} />
          </Field>
        )}
        <Field label="Mixing" title="How the analyte (swelling: the solvent) and the layer's medium mix: linear in the index (de Feijter: n = n_buffer + dn/dc · Γ/d) or an effective medium">
          <select value={sg.mixing} onChange={(e) => set({ mixing: e.target.value as SgSettings['mixing'] })}>
            <option value="linear">linear (de Feijter)</option>
            <option value="bruggeman">Bruggeman</option>
            <option value="maxwell-garnett">Maxwell-Garnett</option>
          </select>
        </Field>
        <NumberField label="Drift" unit="µRIU/min" value={sg.drift} onChange={(drift) => set({ drift })} title="Baseline drift: the buffer index changes linearly in time (temperature: water dn/dT ≈ −1·10⁻⁴ /K)" />
        {!swelling && (
          <Field label="Bulk effect" title="The flowing analyte solution raises the index of the buffer: Δn = dn/dc · c · MW">
            <Switch checked={sg.bulk} onChange={(bulk) => set({ bulk })} label="dn/dc · c · MW" />
          </Field>
        )}
      </div>
      <div className="sub-title">Read-out</div>
      <div className="grid-fields">
        <Field label="Scan" className="span-all" title="Around the resonance: at every time a window of a few hundred points placed on the resonance (found first on a coarse grid of the Simulation's whole range, so a jump of any size is followed) — fast and as exact (the resonance is refined between the points). The Simulation's whole scan, or a range of its own: every point at every time.">
          <Segmented
            value={sg.scan.mode}
            options={[
              { id: 'auto', label: 'around the resonance', title: 'A window that follows the resonance at every time, inside the Simulation’s range' },
              { id: 'sim', label: `the Simulation's (${it.points} points)`, title: `${it.from}–${it.to}${scanUnit}, every point at every time` },
              { id: 'own', label: 'own range', title: 'A range of its own, every point at every time' },
            ]}
            onChange={(mode) => set({ scan: { ...sg.scan, mode } })}
          />
        </Field>
        {sg.scan.mode === 'auto' && <NumberField label="Window points" value={sg.scan.win} min={11} max={2001} onChange={(win) => set({ scan: { ...sg.scan, win: Math.round(win) } })} title={`Points of the window (it spans 2 FWHM of the dip of the start on each side; ${it.from}–${it.to}${scanUnit} searched coarsely first)`} />}
        {ownScan && (
          <>
            <NumberField label="From" unit={scanUnit} value={sg.scan.from} onChange={(from) => set({ scan: { ...sg.scan, from } })} />
            <NumberField label="To" unit={scanUnit} value={sg.scan.to} onChange={(to) => set({ scan: { ...sg.scan, to } })} />
            <NumberField label="Points" value={sg.scan.points} min={3} onChange={(points) => set({ scan: { ...sg.scan, points: Math.round(points) } })} />
          </>
        )}
        <Field label="Read" className="span-2" title="The resonance: the position of the dip at every time. A parameter at a point: a quantity (R, T, A, a phase…) at a fixed angle / wavelength.">
          <Segmented value={sg.readout} options={[{ id: 'dip', label: 'Resonance' }, { id: 'value', label: 'Parameter at a point' }]} onChange={(readout) => set({ readout })} />
        </Field>
        {sg.readout === 'value' ? (
          <>
            <Field label="Parameter">
              <select value={sg.quantity} onChange={(e) => set({ quantity: e.target.value as SgQuantity })}>
                {(Object.keys(SG_QUANTITIES) as SgQuantity[]).map((q) => (
                  <option key={q} value={q}>{SG_QUANTITIES[q].label}</option>
                ))}
              </select>
            </Field>
            <Field label={`At ${it.mode === 'lambda' ? 'λ' : 'θ'}`} title="Where it is read: at the resonance of the start (found when you press Run), or at a value of the scan">
              <select value={Number.isFinite(sg.at) ? 'value' : 'res'} onChange={(e) => set({ at: e.target.value === 'res' ? NaN : +((res?.at ?? ((ownScan ? sg.scan.from : it.from) + (ownScan ? sg.scan.to : it.to)) / 2)).toPrecision(6) })}>
                <option value="res">the resonance{res?.atAuto && Number.isFinite(res.at) ? ` (${+res.at.toPrecision(5)}${scanUnit === '°' ? '°' : ' nm'})` : ''}</option>
                <option value="value">a value</option>
              </select>
            </Field>
            {Number.isFinite(sg.at) && <NumberField label={`${it.mode === 'lambda' ? 'λ' : 'θ'} value`} unit={scanUnit} value={sg.at} onChange={(at) => set({ at })} />}
          </>
        ) : (
          <>
            <Field label="Exact resonance" title="The dip found exactly between the grid points at every time (golden-section search with the transfer matrix); without an instrument">
              <Switch checked={sg.track} onChange={(track) => set({ track })} label="refined" />
            </Field>
            <Field label="Locate (measured)" title="How the dip is located on the curves seen through the instrument: a parabola through 3 points, the centroid of the dip below a level, or a polynomial fit">
              <select value={sg.locate} onChange={(e) => set({ locate: e.target.value as LocateMethod })}>
                <option value="parabola">parabola (3 points)</option>
                <option value="centroid">centroid</option>
                <option value="poly">polynomial fit</option>
              </select>
            </Field>
            {sg.locate !== 'parabola' && <NumberField label="Level (of the depth)" value={sg.locLevel} min={0.02} max={1} onChange={(locLevel) => set({ locLevel })} title="The points below this fraction of the depth (0.5 = half depth)" />}
            {sg.locate === 'poly' && <NumberField label="Degree" value={sg.locDeg} min={2} max={6} onChange={(locDeg) => set({ locDeg: Math.round(locDeg) })} />}
          </>
        )}
        <NumberField label="Max times" value={sg.maxTimes} min={2} max={5000} onChange={(maxTimes) => set({ maxTimes: Math.round(maxTimes) })} title="The times of the kinetics computed (evenly picked, the last one kept)" />
      </div>
      <div className="tol-run">
        {running ? (
          <button type="button" onClick={() => stopSg(project.configId)}>Stop</button>
        ) : (
          <button type="button" className="primary" disabled={kin.errors.length > 0} onClick={start} title="Compute the reflectance at every time and read the sensorgram">
            <Icon name="play" size={14} />
            Run
          </button>
        )}
        {run && !running && (
          <button type="button" onClick={() => clearSg(project.configId)}>Clear</button>
        )}
        {run && (
          <span className="tol-progress">
            <span className="bar">
              <span style={{ width: `${(100 * run.done) / Math.max(1, run.total)}%` }} />
            </span>
            <span className="muted small">
              {run.done} / {run.total} times · {(run.elapsed / 1000).toFixed(1)} s{run.status === 'stopped' ? ' · stopped' : ''}
            </span>
          </span>
        )}
      </div>
      {run?.status === 'error' && <div className="msg err">{run.message}</div>}
      {stale && <div className="msg warn">The configuration or the settings changed since this run: run again to update the sensorgram.</div>}
    </section>
  );

  // ---- the instrument ----
  const instrumentCard = (
    <section className="card">
      <div className="card-head">
        <h2>Instrument</h2>
        <span className="sub">what the measurement does to the curves: blur and detector noise</span>
      </div>
      <div className="grid-fields">
        {it.mode !== 'lambda' ? (
          <Field label="Beam angular spread" className="span-2" title="The beam is not collimated: the curves are averaged over its angles (a convolution along θ)">
            <Switch checked={sg.inst.spreadOn} onChange={(spreadOn) => setInst({ spreadOn })} label="on" />
          </Field>
        ) : (
          <Field label="Source bandwidth" className="span-2" title="The source is not monochromatic: the curves are averaged over its spectrum (a Gaussian convolution along λ)">
            <Switch checked={sg.inst.bandOn} onChange={(bandOn) => setInst({ bandOn })} label="on" />
          </Field>
        )}
        {it.mode !== 'lambda' && sg.inst.spreadOn && (
          <>
            <Field label="Shape">
              <select value={sg.inst.spreadShape} onChange={(e) => setInst({ spreadShape: e.target.value as SgSettings['inst']['spreadShape'] })}>
                <option value="gauss">Gaussian, σ</option>
                <option value="uniform">uniform, ±</option>
                <option value="na">NA (± asin NA)</option>
              </select>
            </Field>
            <NumberField label={sg.inst.spreadShape === 'na' ? 'NA' : 'Spread'} unit={sg.inst.spreadShape === 'na' ? '' : '°'} value={sg.inst.spread} min={0} onChange={(spread) => setInst({ spread })} />
          </>
        )}
        {it.mode === 'lambda' && sg.inst.bandOn && <NumberField label="FWHM" unit="nm" value={sg.inst.band} min={0} onChange={(band) => setInst({ band })} />}
      </div>
      <div className="grid-fields">
        <Field label="Detector noise" className="span-2" title="Noise on R, its own for every scan (Piliarik & Homola, Opt. Express 17, 16505 (2009))">
          <Switch checked={sg.inst.noise} onChange={(noise) => setInst({ noise })} label="on" />
        </Field>
        {sg.inst.noise && (
          <>
            <NumberField label="Thermal / read σ" unit="R" value={sg.inst.noiseAdd} min={0} onChange={(noiseAdd) => setInst({ noiseAdd })} title="Additive noise of the detector (thermal, read-out, dark), σ in units of R" />
            <NumberField label="Shot: e⁻ at R = 1" value={sg.inst.noiseShot} min={0} onChange={(noiseShot) => setInst({ noiseShot })} title="Photoelectrons per point at R = 1 (σ = √(R/N)); 0 = none. A CCD pixel holds ~10⁴–10⁵." />
            <NumberField label="Source σ" unit="%" value={sg.inst.noiseSource} min={0} onChange={(noiseSource) => setInst({ noiseSource })} title="Fluctuation of the source intensity: one factor for a whole scan" />
            <NumberField label="Scans averaged" value={sg.inst.noiseAvg} min={1} onChange={(noiseAvg) => setInst({ noiseAvg: Math.round(noiseAvg) })} />
            <NumberField label="ADC bits" value={sg.inst.noiseBits} min={0} onChange={(noiseBits) => setInst({ noiseBits: Math.round(noiseBits) })} title="Resolution over the full scale R = 1 (0 = not quantized)" />
            <ListField label="Noise seeds" values={sg.seeds} integer onChange={(seeds) => set({ seeds })} title="One noisy run of the same experiment per seed (the same seed, the same noise)" />
          </>
        )}
      </div>
    </section>
  );

  // ---- the bound amount (live) ----
  const kinShows = KIN_SHOW.filter((q) => (swelling ? q.swelling : !q.swelling));
  const kinShow = kinShows.find((q) => q.id === sg.kinShow) ?? kinShows[0];
  const nK = kin.runs.length;
  const kinSeries: Series[] = kin.runs.map((r, k) => ({ key: `k${k}`, label: kin.seriesLabel(k), color: seriesColor(k, nK), x: r.t, y: kinCurve(kin, k, kinShow.id) }));
  const bindingCard = (
    <section className="card">
      <div className="card-head">
        <h2>{swelling ? 'Swelling' : 'Bound amount'}</h2>
        <span className="sub">the kinetics alone (updates as you type)</span>
        <span className="spacer" />
        <select aria-label="Quantity of the kinetics" value={kinShow.id} onChange={(e) => set({ kinShow: e.target.value })}>
          {kinShows.map((q) => (
            <option key={q.id} value={q.id}>{q.label}</option>
          ))}
        </select>
        {nK > 0 && <FigureTools target={figKin} name="kinetics" csv={() => exportCsv(['t [s]', ...kin.runs.map((_, k) => `${kin.seriesLabel(k)} ${kinShow.id}${kinShow.unit ? ` [${kinShow.unit}]` : ''}`)], kin.t.map((t, j) => [t, ...kin.runs.map((_, k) => kinCurve(kin, k, kinShow.id)[j])]), 'kinetics')} />}
        {removeBtn('binding')}
      </div>
      {nK ? (
        <AutoWidth figure={figKin}>{(w) => <LinePlot xAxis={{ ...TIME, values: kin.t }} series={kinSeries} overlays={injectionSpans(kin)} yLabel={kinShow.label.split(' — ')[0]} yUnit={kinShow.unit} width={w} height={260} />}</AutoWidth>
      ) : (
        <p className="muted">Fix the settings of the kinetics to see the bound amount.</p>
      )}
      {nK > 1 && <SeriesLegend kin={kin} />}
      {kin.warnings.map((w, i) => (
        <div key={i} className="msg warn">{w}</div>
      ))}
    </section>
  );

  // ---- the sensorgram ----
  const rk = run?.kin;
  const show = res?.meta.find((m) => m.key === sg.show) ?? res?.meta[0];
  const nS = res?.seeds.length ?? 1;
  const sgSeries: Series[] =
    res && rk && show
      ? Array.from({ length: nS * res.nK }, (_, q): Series => {
          const s = Math.floor(q / res.nK);
          const k = q % res.nK;
          const off = (s * res.nK + k) * res.nT;
          return { key: `s${s}k${k}`, label: `${rk.seriesLabel(k)}${nS > 1 ? ` · seed ${res.seeds[s]}` : ''}`, color: seriesColor(k, res.nK), x: res.times, y: res.fields[show.key].subarray(off, off + res.nT), width: nS > 1 ? 1 : 1.6 };
        })
      : [];
  const sgCsv = () => {
    if (!res || !show) return;
    exportCsv(['t [s]', ...sgSeries.map((s) => `${s.label} ${show.short}${show.unit ? ` [${show.unit}]` : ''}`)], res.times.map((t, j) => [t, ...sgSeries.map((s) => s.y[j])]), 'sensorgram');
  };
  const sensorgramCard = (
    <section className="card">
      <div className="card-head">
        <h2>Sensorgram</h2>
        <span className="sub">the read-out at every time</span>
        <span className="spacer" />
        {res && (
          <select aria-label="Quantity of the sensorgram" value={show?.key} onChange={(e) => set({ show: e.target.value })}>
            {res.meta.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        )}
        {res && <FigureTools target={figSg} name="sensorgram" csv={sgCsv} />}
        {removeBtn('sensorgram')}
      </div>
      {res && rk && show ? (
        <AutoWidth figure={figSg}>{(w) => <LinePlot xAxis={{ ...TIME, values: res.times }} series={sgSeries} overlays={injectionSpans(rk)} yLabel={show.short} yUnit={show.unit} width={w} height={300} />}</AutoWidth>
      ) : (
        <p className="muted">{running ? 'computing…' : 'Run to compute the sensorgram: the reflectance of the structure at every time, read like an SPR instrument.'}</p>
      )}
      {res && rk && res.nK > 1 && <SeriesLegend kin={rk} />}
    </section>
  );

  const summaryCard = (
    <section className="card">
      <div className="card-head">
        <h2>Summary</h2>
        <span className="sub">the change, the surface, the calibration and the detection limit</span>
        <span className="spacer" />
        {removeBtn('summary')}
      </div>
      {res ? (
        <ul className="sg-rows">
          {run?.layer && <li><span className="muted">binding layer:</span> {run.layer}</li>}
          {res.rows.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">{running ? 'computing…' : 'Run first.'}</p>
      )}
      {run?.warnings.filter((w) => !kin.warnings.includes(w)).map((w, i) => (
        <div key={i} className="msg warn">{w}</div>
      ))}
    </section>
  );

  // ---- the reflectance at every time ----
  const reflectanceCard =
    res && rk ? (
      <ReflectanceCard res={res} kin={rk} sg={sg} set={set} figMap={figMap} figCurves={figCurves} removeBtn={removeBtn('reflectance')} />
    ) : (
      <section className="card">
        <div className="card-head">
          <h2>Curves over the scan</h2>
          <span className="sub">R (or the parameter read) vs the scan at chosen times</span>
          <span className="spacer" />
          {removeBtn('reflectance')}
        </div>
        <p className="muted">{running ? 'computing…' : 'Run first.'}</p>
      </section>
    );

  // ---- steady state ----
  const st = kin.steady;
  const steadyCard = st ? (
    <section className="card">
      <div className="card-head">
        <h2>Steady state</h2>
        <span className="sub">R at the end of every injection vs its concentration, the Langmuir isotherm</span>
        <span className="spacer" />
        <FigureTools target={figSteady} name="steady state" csv={() => exportCsv(['c [nM]', 'R end [RU]', ...(st.fit ? ['fit [RU]'] : []), ...(st.reached ? ['reached'] : [])], st.cs.map((cc, i) => [cc, st.Req[i], ...(st.fit ? [st.fit[i]] : []), ...(st.reached ? [st.reached[i]] : [])]), 'steady state')} />
        {removeBtn('steady')}
      </div>
      <AutoWidth figure={figSteady} max={720}>
        {(w) => (
          <LinePlot
            xAxis={{ id: 'conc', label: 'c', unit: 'nM', values: st.cs }}
            series={[{ key: 'req', label: 'R end', color: 'var(--line)', y: st.Req, dots: true, noLine: true }, ...(st.fit ? [{ key: 'fit', label: 'Langmuir fit', color: '#e07b39', y: st.fit, dash: '6 4' }] : [])]}
            series2={st.reached ? [{ key: 'reached', label: 'fraction of equilibrium reached', color: '#2e9d5b', y: st.reached, dots: true }] : []}
            yLabel="R end"
            yUnit="RU"
            y2Label="reached"
            y2Unit=""
            y2Domain={[0, 1.05]}
            width={w}
            height={240}
          />
        )}
      </AutoWidth>
      <ul className="sg-rows">
        {st.rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </section>
  ) : null;

  // the right column: the plots chosen (Add plot), each removable
  const RIGHT: { key: string; label: string; node: ReactNode; title: string }[] = [
    { key: 'sensorgram', label: 'Sensorgram', node: sensorgramCard, title: 'The read-out at every time (the shift of the dip, the layer, the coverage…)' },
    { key: 'summary', label: 'Summary', node: summaryCard, title: 'The change, the surface, the calibration and the detection limit' },
    { key: 'binding', label: swelling ? 'Swelling' : 'Bound amount', node: bindingCard, title: 'The kinetics alone, updated as you type' },
    { key: 'reflectance', label: 'Curves over the scan', node: reflectanceCard, title: 'R (or the parameter read) over the scan at chosen times; the map of all the times when asked' },
    ...(steadyCard ? [{ key: 'steady', label: 'Steady state', node: steadyCard, title: 'R at the end of every injection vs its concentration, the Langmuir isotherm' }] : []),
  ];
  const shown = cards.map((k) => RIGHT.find((r) => r.key === k)).filter((r): r is (typeof RIGHT)[number] => !!r);
  const items: BoardItem[] = [
    { key: 'analyte', col: 'left', label: 'Analyte and surface', node: analyteCard },
    { key: 'kinetics', col: 'left', label: 'Binding kinetics', node: kineticsCard },
    { key: 'signal', col: 'left', label: 'Signal and read-out', node: signalCard },
    { key: 'instrument', col: 'left', label: 'Instrument', node: instrumentCard },
    ...shown.map((r) => ({ key: r.key, col: 'right', label: r.label, node: r.node })),
    {
      key: 'add-plot',
      col: 'right',
      label: 'Add plot',
      fixed: true,
      node: (
        <div className="add-row">
          <MenuButton label="Add plot" items={RIGHT.filter((r) => !cards.includes(r.key)).map((r) => ({ key: r.key, label: r.label, hint: r.title }))} onPick={(k) => set({ cards: [...cards, k] })} title="Show another plot of the experiment" />
        </div>
      ),
    },
  ];
  return <Board id="sensorgram" className="opt-layout tol-layout sg-layout" columns={[{ id: 'left' }, { id: 'right' }]} items={items} />;
}

// The colours of the series.
function SeriesLegend({ kin }: { kin: SgKinetics }) {
  return (
    <div className="tol-legend muted small">
      {kin.runs.map((_, k) => (
        <span key={k}>
          <i style={{ background: seriesColor(k, kin.runs.length) }} /> {kin.seriesLabel(k)}
        </span>
      ))}
    </div>
  );
}

// The curves over the scan of one series (and seed) at chosen times — by default the end of every step; times added
// or removed as chips — and, when asked, the map of all the times.
function ReflectanceCard({ res, kin, sg, set, figMap, figCurves, removeBtn }: { res: SgResult; kin: SgKinetics; sg: SgSettings; set: (p: Partial<SgSettings>) => void; figMap: React.RefObject<HTMLDivElement | null>; figCurves: React.RefObject<HTMLDivElement | null>; removeBtn: ReactNode }) {
  const k = Math.min(Math.max(0, sg.mapSeries), res.nK - 1);
  const s = Math.min(Math.max(0, sg.mapSeed), res.seeds.length - 1);
  const [which, setWhich] = useState<'measured' | 'exact'>('measured');
  const [adding, setAdding] = useState('');
  const meas = res.measured && which === 'measured';
  const W = res.W;
  const q = SG_QUANTITIES[res.quantity];
  // the windows of this series (each time its own, following the resonance): the part of the grid they cover
  const [g0, g1] = useMemo(() => {
    let a = Infinity;
    let b = -Infinity;
    for (let j = 0; j < res.nT; j++) {
      a = Math.min(a, res.i0[k * res.nT + j]);
      b = Math.max(b, res.i0[k * res.nT + j] + W);
    }
    return [a, b];
  }, [res, k, W]);
  const span = res.xs.slice(g0, g1);
  // the map: every time over that part of the grid, empty outside its window
  const values = useMemo(() => {
    if (!sg.showMap) return new Float64Array(0);
    const src = meas ? res.measured![s] : res.exact;
    const n = g1 - g0;
    const out = new Float64Array(res.nT * n).fill(NaN);
    for (let j = 0; j < res.nT; j++) {
      const qi = k * res.nT + j;
      for (let i = 0; i < W; i++) out[j * n + res.i0[qi] - g0 + i] = src[qi * W + i];
    }
    return out;
  }, [res, k, s, meas, W, g0, g1, sg.showMap]);
  const xAxis = res.along === 'theta' ? { id: 'theta', label: 'θ', unit: '°', values: span } : { id: 'lambda', label: 'λ', unit: 'nm', values: span };
  // the times of the curves: the chosen ones, else the end of every step (the nearest computed times)
  const custom = sg.times.length > 0;
  const wanted = custom ? sg.times : kin.steps.map((st) => st.t1);
  const nearest = (t: number) => res.times.reduce((b, v, j) => (Math.abs(v - t) < Math.abs(res.times[b] - t) ? j : b), 0);
  const idx = [...new Set(wanted.map(nearest))].sort((a, b) => a - b);
  const tEnd = res.times[res.times.length - 1];
  const addTime = () => {
    const t = Number(adding);
    if (!(t >= 0 && t <= tEnd)) return;
    set({ times: [...new Set([...idx.map((j) => res.times[j]), res.times[nearest(t)]])].sort((x, y) => x - y) });
    setAdding('');
  };
  const removeTime = (j: number) => set({ times: idx.filter((x) => x !== j).map((x) => res.times[x]) });
  // a curve: its window of the grid (x) and its values
  const xOf = (j: number) => res.xs.slice(res.i0[k * res.nT + j], res.i0[k * res.nT + j] + W);
  const curve = (src: ArrayLike<number>, j: number) => Array.from({ length: W }, (_, i) => src[(k * res.nT + j) * W + i]);
  const series: Series[] = idx.map((j, n) => ({ key: `t${j}`, label: `t = ${fmt(res.times[j])} s`, color: seriesColor(n, idx.length), x: xOf(j), y: curve(meas ? res.measured![s] : res.exact, j) }));
  const overlays: Overlay[] = [
    ...(meas ? idx.map((j, n): Overlay => ({ kind: 'curve', key: `x${j}`, x: xOf(j), y: curve(res.exact, j), color: seriesColor(n, idx.length), dash: '5 4', width: 1 })) : []),
    ...(Number.isFinite(res.at) && !res.fields.Rmin ? [{ kind: 'vline', key: 'at', x: res.at, color: 'var(--accent)' } as Overlay] : []),
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Curves over the scan</h2>
        <span className="sub">{q.short} vs {xAxis.label} at chosen times</span>
        <span className="spacer" />
        {res.nK > 1 && (
          <select aria-label="Series" value={k} onChange={(e) => set({ mapSeries: Number(e.target.value) })}>
            {Array.from({ length: res.nK }, (_, i) => (
              <option key={i} value={i}>{kin.seriesLabel(i)}</option>
            ))}
          </select>
        )}
        {res.measured && res.seeds.length > 1 && (
          <select aria-label="Noise seed" value={s} onChange={(e) => set({ mapSeed: Number(e.target.value) })}>
            {res.seeds.map((sd, i) => (
              <option key={i} value={i}>seed {sd}</option>
            ))}
          </select>
        )}
        {res.measured && <Segmented value={which} options={[{ id: 'measured', label: 'measured' }, { id: 'exact', label: 'exact' }]} onChange={setWhich} />}
        <FigureTools target={figCurves} name="scan curves" csv={() => exportCsv(series.flatMap((x) => [`${xAxis.label} [${xAxis.unit}] (${x.label})`, `${q.short} ${x.label}`]), Array.from({ length: W }, (_, i) => series.flatMap((c) => [c.x![i], c.y[i]])), 'scan curves')} />
        {removeBtn}
      </div>
      <div className="sg-times">
        <span className="muted small">At</span>
        {idx.map((j, n) => (
          <span key={j} className="chip">
            <i className="sg-dot" style={{ background: seriesColor(n, idx.length) }} />
            {fmt(res.times[j])} s
            <button type="button" className="chip-x" aria-label={`Remove t = ${fmt(res.times[j])} s`} title="Remove this time" onClick={() => removeTime(j)}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <span className="with-unit sg-add-time">
          <input
            type="text"
            inputMode="decimal"
            aria-label="A time to add"
            placeholder={`0 – ${fmt(tEnd)}`}
            className="tiny"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTime()}
          />
          <span className="unit">s</span>
          <button type="button" onClick={addTime} disabled={!(Number(adding) >= 0 && Number(adding) <= tEnd) || !adding.trim()} title="Add a curve at this time (the nearest computed one)">
            <Icon name="plus" size={13} />
            Add
          </button>
        </span>
        {custom && (
          <button type="button" className="link small" onClick={() => set({ times: [] })} title="Back to the end of every step">
            the end of every step
          </button>
        )}
        <span className="spacer" />
        {meas && <span className="muted small">dashed: exact</span>}
      </div>
      <AutoWidth figure={figCurves}>{(w) => <LinePlot xAxis={xAxis} series={series} overlays={overlays} yLabel={q.short} yUnit={q.unit} width={w} height={280} />}</AutoWidth>
      <div className="card-head sg-map-head">
        <Switch checked={sg.showMap} onChange={(showMap) => set({ showMap })} label={`Map of ${q.short}(t, ${xAxis.label})`} title="Every computed time as a map (time vertically)" />
        <span className="spacer" />
        {sg.showMap && <FigureTools target={figMap} name="scan map" />}
      </div>
      {sg.showMap && <AutoWidth figure={figMap}>{(w) => <MapPlot xAxis={xAxis} yAxis={{ ...TIME, values: res.times }} values={values} zLabel={q.short} zUnit={q.unit} width={w} height={300} />}</AutoWidth>}
    </section>
  );
}
