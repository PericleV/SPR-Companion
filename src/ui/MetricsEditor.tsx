// The project's metrics as a list: each row on / off, its colour, name, formula name, kind and main value; opened, its
// settings in a grid (the data it reduces, the axis, the curve, the region — typed or drawn on a plot — and what its
// kind needs), its kind's own editor (fit components, a target curve, zones) and its results as a table. Every result
// can be an objective or a constraint of the optimization (chosen there).
import { COMPONENTS, guessSpectrum, newComponent, paramUnit, type ComponentType, type FitComponent } from '../engine/fitmodels.ts';
import { windowOf } from '../engine/metrics.ts';
import { compile } from '../engine/expr.ts';
import { fitKeys, KIND_LABEL, newMetric, newZone, quantitiesOf, type Feature, type FitSettings, type Metric, type MetricKind, type MetricResult, type SensTarget, type Zone, type ZoneStat } from '../model/metrics.ts';
import { NumberField } from './NumberField.tsx';
import { metricColor } from './roiColor.ts';
import { useSensTargets } from './useSensTargets.ts';
import { compShown } from './metricOverlays.ts';
import type { RoiDraw } from './roiDraw.ts';
import { Field, IconButton, Segmented, Switch } from './kit.tsx';

const KINDS: MetricKind[] = ['min', 'max', 'fwhm', 'sens', 'fom', 'phase', 'gh', 'penetration', 'propagation', 'fit', 'match', 'zones', 'custom'];
const TYPES: ComponentType[] = ['baseline', 'lorentz', 'gauss', 'fano', 'coupled'];
const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(7)) : '—');
// kinds that need the structure (Δn, the field): on the response only
const RESPONSE_ONLY: MetricKind[] = ['sens', 'fom', 'phase', 'gh', 'penetration', 'propagation'];

// A region bound: empty = the end of the scan.
export function BoundField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <Field label={label}>
      <input
        type="text"
        className="short"
        placeholder="scan end"
        defaultValue={Number.isFinite(value) ? String(value) : ''}
        key={Number.isFinite(value) ? value : 'open'}
        onChange={(e) => {
          const t = e.target.value.trim();
          const v = t === '' ? NaN : Number(t);
          if (t === '' || Number.isFinite(v)) onChange(v);
        }}
      />
    </Field>
  );
}

// The data a metric can reduce: the response (key 'response') or the values of the metrics along an axis.
export type MetricSource = { key: string; label: string; axes: { id: string; label: string; unit: string }[]; fields: string[]; defaultAlong: string };

type Props = {
  metrics: Metric[];
  set: (metrics: Metric[]) => void;
  results: (MetricResult | undefined)[]; // the values shown (the curve chosen in a plot)
  sources: MetricSource[];
  dataOf: (m: Metric) => { xs: ArrayLike<number>; R: ArrayLike<number> } | null; // the metric's curve (for Guess)
  // the plots a metric can be drawn on (its data, its axis along X — or X or Y of a map) and the ROI being drawn
  plotsFor?: (m: Metric) => { id: string; label: string; map: boolean }[];
  draw?: RoiDraw | null;
  onDraw?: (d: RoiDraw | null) => void;
  onConfirm?: () => void;
  open: Record<string, boolean>;
  setOpen: (id: string, open: boolean) => void;
};

// A label made by the editor (it follows the kind) rather than typed.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const autoLabel = (m: Metric) => new RegExp(`^(${Object.values(KIND_LABEL).map(esc).join('|')})( \\d+)?$`).test(m.label);

export function MetricsEditor({ metrics, set, results, sources, dataOf, plotsFor, draw, onDraw, onConfirm, open, setOpen }: Props) {
  const targets = useSensTargets();
  const tkey = (t: SensTarget) => JSON.stringify(t);
  const setM = (i: number, patch: Partial<Metric>) => set(metrics.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const sourceOf = (m: Metric) => sources.find((s) => s.key === (m.source ?? 'response')) ?? sources[0];

  if (!metrics.length) return <p className="muted">No metrics yet: add one to measure the response (a resonance, its width, a sensitivity, a fit…).</p>;
  return (
    <div className="metric-list">
      {metrics.map((m, i) => {
        const r = results[i];
        const src = sourceOf(m);
        const along = src?.axes.find((a) => a.id === m.along) ?? src?.axes.find((a) => a.id === src.defaultAlong) ?? src?.axes[0];
        const unit = along?.unit ?? '';
        const spectral = along?.id === 'lambda';
        const disp = m.kind === 'fit' && m.fit?.mode === 'dispersion';
        const needsFeature = ['fwhm', 'sens', 'fom', 'penetration', 'propagation'].includes(m.kind);
        // (the phase and GH metrics: their own curves, φr and GH; Δn for their sensitivities)
        const needsShift = m.kind === 'sens' || m.kind === 'fom' || m.kind === 'phase' || m.kind === 'gh';
        const hasRoi = m.kind !== 'custom' && m.kind !== 'zones';
        const fields = src?.fields ?? ['R'];
        const onResponse = !m.source || m.source === 'response';
        const qs = quantitiesOf(m, spectral);
        const main = qs[0];
        const isOpen = !!open[m.id];
        const plots = plotsFor?.(m) ?? [];
        return (
          <div key={m.id} className={`metric-item${m.on ? '' : ' off'}${isOpen ? ' open' : ''}`}>
            <div className="metric-head">
              <Switch checked={m.on} onChange={(on) => setM(i, { on })} title="Compute this metric" />
              <span className="color-dot" style={{ background: metricColor(m, i) }} title="Its colour on the plots">
                <input type="color" aria-label="Metric colour" value={metricColor(m, i)} onChange={(e) => setM(i, { color: e.target.value })} />
              </span>
              <input type="text" className="metric-name" aria-label="Metric name" value={m.label} onChange={(e) => setM(i, { label: e.target.value })} />
              <input
                type="text"
                className="metric-ref"
                aria-label="Name in formulas"
                title="Its name in formulas: name.quantity"
                value={m.ref}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\w]/g, '');
                  if (v && !metrics.some((x, k) => k !== i && x.ref === v)) setM(i, { ref: v });
                }}
              />
              <select
                aria-label="Kind"
                value={m.kind}
                onChange={(e) => {
                  const k = e.target.value as MetricKind;
                  const fresh = newMetric(k, {}, metrics.filter((x) => x.id !== m.id).map((x) => x.ref));
                  // a label and a name the editor made follow the kind (typed ones stay)
                  const label = autoLabel(m) ? `${KIND_LABEL[k]} ${metrics.filter((x) => x.kind === k).length + 1}` : m.label;
                  const ref = autoLabel(m) && !metrics.some((x) => x.id !== m.id && x.ref === fresh.ref) ? fresh.ref : m.ref;
                  setM(i, { kind: k, label, ref, field: fresh.field ?? (m.field === 'phiR' || m.field === 'gh' ? undefined : m.field), fit: m.fit ?? fresh.fit, match: m.match ?? fresh.match, zones: m.zones ?? fresh.zones, expr: m.expr ?? fresh.expr, ...(RESPONSE_ONLY.includes(k) ? { source: undefined } : {}) });
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k} disabled={!onResponse && RESPONSE_ONLY.includes(k)}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              <span className="metric-main" title={`${m.ref}.${main.key}`}>
                {m.on && r ? (
                  <>
                    <span className="muted">{main.label}</span> <b>{fmt(r.values[main.key] ?? NaN)}</b>
                    {main.unit(unit) ? ` ${main.unit(unit)}` : ''}
                  </>
                ) : (
                  <span className="muted">{m.on ? '—' : 'off'}</span>
                )}
                {r?.error && m.on && <span className="warn-dot" title={r.error}>!</span>}
              </span>
              <IconButton icon={isOpen ? 'chevronUp' : 'chevronDown'} label={isOpen ? 'Close' : 'Open its settings'} onClick={() => setOpen(m.id, !isOpen)} />
              <IconButton icon="trash" label="Remove the metric" onClick={() => set(metrics.filter((_, k) => k !== i))} />
            </div>
            {isOpen && (
              <div className="metric-body">
                <div className="grid-fields">
                  {m.kind !== 'custom' && sources.length > 1 && (
                    <Field label="Data" title="The response, or the values of other metrics (e.g. their positions vs a swept parameter)">
                      <select value={src?.key ?? 'response'} onChange={(e) => setM(i, { source: e.target.value === 'response' ? undefined : e.target.value, along: undefined, follow: undefined, field: undefined, field2: undefined })}>
                        {sources.map((s) => (
                          <option key={s.key} value={s.key} disabled={s.key !== 'response' && RESPONSE_ONLY.includes(m.kind)}>{s.label}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {m.kind !== 'custom' && src && src.axes.length > 1 && (
                    <Field label="Along">
                      <select value={along?.id ?? ''} onChange={(e) => setM(i, { along: e.target.value, follow: undefined })}>
                        {src.axes.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                    </Field>
                  )}
                  {hasRoi && !needsShift && (
                    <Field label={disp ? 'Branch 1' : 'Curve'}>
                      <select value={m.field ?? (onResponse ? 'R' : '')} onChange={(e) => setM(i, { field: e.target.value === 'R' && onResponse ? undefined : e.target.value })}>
                        {!fields.includes(m.field ?? 'R') && <option value="">choose…</option>}
                        {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                  )}
                  {disp && (
                    <Field label="Branch 2">
                      <select value={m.field2 ?? ''} onChange={(e) => setM(i, { field2: e.target.value })}>
                        {!fields.includes(m.field2 ?? '') && <option value="">choose…</option>}
                        {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                  )}
                  {needsFeature && (
                    <Field label="Feature">
                      <Segmented<Feature> value={m.feature} onChange={(feature) => setM(i, { feature })} options={[{ id: 'dip', label: 'Dip', title: 'A resonance (a minimum)' }, { id: 'peak', label: 'Peak', title: 'A peak or a band (e.g. a stop band)' }]} />
                    </Field>
                  )}
                  {needsShift && (
                    <>
                      <NumberField label="Δn" value={m.dn} onChange={(dn) => dn !== 0 && setM(i, { dn })} />
                      <Field label="Changed medium">
                        <select value={tkey(m.target)} onChange={(e) => setM(i, { target: JSON.parse(e.target.value) as SensTarget })}>
                          {targets.map((x) => <option key={tkey(x.t)} value={tkey(x.t)}>{x.label}</option>)}
                        </select>
                      </Field>
                    </>
                  )}
                  {m.kind === 'penetration' && (
                    <Field label="Medium" title="The medium (or block) of the penetration depth and the absorbed fraction">
                      <select value={tkey(m.target)} onChange={(e) => setM(i, { target: JSON.parse(e.target.value) as SensTarget })}>
                        {targets.map((x) => <option key={tkey(x.t)} value={tkey(x.t)}>{x.label}</option>)}
                      </select>
                    </Field>
                  )}
                  {hasRoi && (
                    <>
                      <BoundField label={`Region from${unit ? ` [${unit}]` : ''}`} value={m.lo} onChange={(lo) => setM(i, { lo, follow: undefined })} />
                      <BoundField label={`To${unit ? ` [${unit}]` : ''}`} value={m.hi} onChange={(hi) => setM(i, { hi, follow: undefined })} />
                    </>
                  )}
                  {plotsFor && m.kind !== 'custom' && (
                    <Field label="Shown on">
                      <select value={m.plot ?? ''} onChange={(e) => setM(i, { plot: e.target.value || undefined })}>
                        <option value="">all plots</option>
                        {plots.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </Field>
                  )}
                  {plotsFor && hasRoi && (
                    <RoiDrawField m={m} plots={plots} draw={draw?.metric === m.id ? draw : null} start={(plot) => onDraw?.({ metric: m.id, plot, pts: [] })} cancel={() => onDraw?.(null)} confirm={() => onConfirm?.()} />
                  )}
                  {m.kind === 'custom' && <CustomExpr m={m} before={metrics.slice(0, i)} set={(expr) => setM(i, { expr })} />}
                </div>
                {draw?.metric === m.id && <DrawHint draw={draw} plots={plots} />}
                {m.follow && !draw && (
                  <div className="muted small region-note">
                    Region: {m.follow.poly ? `drawn on a map (${m.follow.poly.length} corners — drag them there)` : `zone points along ${m.follow.param}`}.{' '}
                    <button type="button" className="link" onClick={() => setM(i, { follow: undefined })}>Use the fixed region</button>
                  </div>
                )}
                {m.kind === 'fit' && <FitEditor m={m} r={r} unit={unit} data={dataOf(m)} set={(patch) => setM(i, patch)} />}
                {m.kind === 'match' && <MatchEditor m={m} unit={unit} data={dataOf(m)} set={(patch) => setM(i, patch)} />}
                {m.kind === 'zones' && <ZonesEditor m={m} r={r} unit={unit} fields={fields} set={(patch) => setM(i, patch)} />}
                {r?.error && m.on && <div className="msg warn small">{r.error}</div>}
                {m.on && r && (
                  <table className="data results">
                    <thead>
                      <tr><th>Result</th><th className="num">Value</th><th>Unit</th><th>Name</th></tr>
                    </thead>
                    <tbody>
                      {qs.map((q) => (
                        <tr key={q.key}>
                          <td>{q.label}</td>
                          <td className="num">{fmt(r.values[q.key] ?? NaN)}</td>
                          <td className="muted">{q.unit(unit)}</td>
                          <td className="muted mono">{m.ref}.{q.key}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Draw the region on a plot: the button, or (drawing) Confirm / Cancel.
function RoiDrawField({ m, plots, draw, start, cancel, confirm }: { m: Metric; plots: { id: string; label: string; map: boolean }[]; draw: RoiDraw | null; start: (plot: string) => void; cancel: () => void; confirm: () => void }) {
  const target = plots.find((p) => p.id === m.plot) ?? plots[0];
  const ready = !!draw && (draw.pts.length >= 3 || (Number.isFinite(draw.lo) && Number.isFinite(draw.hi)));
  if (draw)
    return (
      <Field label="Drawing">
        <span className="btn-pair">
          <button type="button" className="primary" disabled={!ready} onClick={confirm}>Confirm</button>
          <button type="button" onClick={cancel}>Cancel</button>
        </span>
      </Field>
    );
  return (
    <Field label="Region on a plot">
      <button type="button" disabled={!target} onClick={() => target && start(target.id)} title={target ? `Draw it on “${target.label}”` : 'No plot shows this curve along its axis: add one'}>
        Draw region
      </button>
    </Field>
  );
}
function DrawHint({ draw, plots }: { draw: RoiDraw; plots: { id: string; label: string; map: boolean }[] }) {
  const p = plots.find((x) => x.id === draw.plot);
  return (
    <div className="msg inline small draw-hint">
      {p?.map ? `On “${p.label}”: click the corners of the region (${draw.pts.length} so far), then Confirm.` : `On “${p?.label ?? '?'}”: drag across the plot${Number.isFinite(draw.lo) ? ` (${+draw.lo!.toPrecision(5)} – ${+draw.hi!.toPrecision(5)})` : ''}, then Confirm.`}
    </div>
  );
}

// The formula of a custom metric, with the names it can use (the quantities of the metrics before it).
function CustomExpr({ m, before, set }: { m: Metric; before: Metric[]; set: (expr: string) => void }) {
  const names = before.filter((x) => x.on).flatMap((x) => quantitiesOf(x, true).map((q) => `${x.ref}.${q.key}`));
  const c = compile(m.expr ?? '');
  const bad = typeof c === 'string' ? c : c.names.filter((n) => !names.includes(n)).map((n) => `unknown ${n}`).join(', ');
  return (
    <Field label="Formula" className="span-all" title={`Names: ${names.join(', ') || '(add metrics above this one)'}; functions abs sqrt exp log log10 min max pow`}>
      <input type="text" className={bad && m.expr ? 'bad' : ''} placeholder="sens.S / res.width" value={m.expr ?? ''} onChange={(e) => set(e.target.value)} list={`names-${m.id}`} />
      <datalist id={`names-${m.id}`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      {bad && m.expr ? <span className="err-text small">{bad}</span> : null}
    </Field>
  );
}

// Zones: in each, a statistic of a quantity to maximize or minimize (drawn green / red on the plot).
function ZonesEditor({ m, r, unit, fields, set }: { m: Metric; r: MetricResult | undefined; unit: string; fields: string[]; set: (patch: Partial<Metric>) => void }) {
  const zs = m.zones ?? [];
  const setZ = (k: number, patch: Partial<Zone>) => set({ zones: zs.map((z, j) => (j === k ? { ...z, ...patch } : z)) });
  return (
    <div className="sub-editor">
      <table className="data">
        <thead>
          <tr><th>Zone</th><th>Goal</th><th>Of</th><th>From{unit ? ` [${unit}]` : ''}</th><th>To{unit ? ` [${unit}]` : ''}</th><th className="num">Value</th><th /></tr>
        </thead>
        <tbody>
          {zs.map((z, k) => (
            <tr key={z.id}>
              <td><span className={`zone-tag ${z.goal}`}>z{k + 1}</span></td>
              <td><Segmented<Zone['goal']> value={z.goal} onChange={(goal) => setZ(k, { goal })} options={[{ id: 'max', label: 'Max' }, { id: 'min', label: 'Min' }]} /></td>
              <td>
                <span className="cell-pair">
                  <select aria-label="Statistic" value={z.stat} onChange={(e) => setZ(k, { stat: e.target.value as ZoneStat })}>
                    <option value="mean">mean</option>
                    <option value="min">minimum</option>
                    <option value="max">maximum</option>
                    <option value="int">integral</option>
                  </select>
                  <select aria-label="Quantity" value={z.field || 'R'} onChange={(e) => setZ(k, { field: e.target.value })}>
                    {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </span>
              </td>
              <td><RangeInput value={z.lo} onChange={(lo) => setZ(k, { lo })} label="From" /></td>
              <td><RangeInput value={z.hi} onChange={(hi) => setZ(k, { hi })} label="To" /></td>
              <td className="num">{r ? fmt(r.values[`z${k + 1}`] ?? NaN) : '—'}</td>
              <td><IconButton icon="x" label="Remove the zone" onClick={() => set({ zones: zs.filter((_, j) => j !== k) })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-buttons">
        <button type="button" onClick={() => set({ zones: [...zs, newZone({ goal: 'max' })] })}>+ Zone to maximize</button>
        <button type="button" onClick={() => set({ zones: [...zs, newZone({ goal: 'min' })] })}>+ Zone to minimize</button>
      </div>
    </div>
  );
}
function RangeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      type="text"
      className="short"
      aria-label={label}
      placeholder="scan end"
      defaultValue={Number.isFinite(value) ? String(value) : ''}
      key={Number.isFinite(value) ? value : 'open'}
      onChange={(e) => {
        const t = e.target.value.trim();
        const v = t === '' ? NaN : Number(t);
        if (t === '' || Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

// The target of a curve match: components (baseline, Lorentz, Gauss…), the cost and the level below which points count.
function MatchEditor({ m, unit, data, set }: { m: Metric; unit: string; data: { xs: ArrayLike<number>; R: ArrayLike<number> } | null; set: (patch: Partial<Metric>) => void }) {
  const s = m.match ?? { comps: [], cost: 'msemax' as const, lambdaMax: 0.01, below: 1 };
  const setS = (patch: Partial<typeof s>) => set({ match: { ...s, ...patch } });
  const keys = fitKeys(s.comps);
  const setParam = (ci: number, key: string, value: number) => setS({ comps: s.comps.map((c, k) => (k === ci ? { ...c, params: { ...c.params, [key]: { ...c.params[key], value } } } : c)) });
  const place = (cs: FitComponent[]) => {
    if (!data) return cs;
    const [i0, i1] = windowOf(data.xs, m.lo, m.hi);
    if (i1 - i0 < 4) return cs;
    const x = Array.from({ length: i1 - i0 + 1 }, (_, i) => data.xs[i0 + i]);
    return guessSpectrum(cs, x, Array.from({ length: i1 - i0 + 1 }, (_, i) => data.R[i0 + i]));
  };
  return (
    <div className="sub-editor">
      <div className="grid-fields">
        <Field label="Cost">
          <Segmented<'mse' | 'msemax'> value={s.cost} onChange={(cost) => setS({ cost })} options={[{ id: 'mse', label: 'MSE' }, { id: 'msemax', label: 'MSE + λ·max²' }]} />
        </Field>
        {s.cost === 'msemax' && <NumberField label="λ" value={s.lambdaMax} onChange={(lambdaMax) => setS({ lambdaMax })} />}
        <NumberField label="Only where the target <" value={s.below} onChange={(below) => setS({ below })} title="1: every point counts" />
        <Field label="Target components">
          <select value="" onChange={(e) => e.target.value && setS({ comps: place([...s.comps, newComponent(e.target.value as ComponentType)]) })}>
            <option value="">+ add…</option>
            {(['baseline', 'lorentz', 'gauss', 'fano'] as ComponentType[]).map((t) => <option key={t} value={t}>{COMPONENTS[t].label}</option>)}
          </select>
        </Field>
      </div>
      {s.comps.length > 0 && (
        <table className="data comps">
          <tbody>
            {s.comps.map((c, ci) => (
              <tr key={c.id}>
                <td><b>{keys.find((k) => k.ci === ci)?.key.split('_')[0]}</b> {COMPONENTS[c.type].label}</td>
                <td>
                  <span className="params-cell">
                    {COMPONENTS[c.type].params.map((d) => {
                      const u = paramUnit(d.kind, unit, '');
                      return <NumberField key={d.key} label={`${d.label}${u ? ` [${u}]` : ''}`} value={+c.params[d.key].value.toPrecision(8)} onChange={(v) => setParam(ci, d.key, v)} className="param" />;
                    })}
                  </span>
                </td>
                <td><IconButton icon="x" label="Remove" onClick={() => setS({ comps: s.comps.filter((_, k) => k !== ci) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// A fit: the components (start values, fixed or free, each drawn or not, the fitted values), or the coupled-oscillator
// dispersion of two branches.
function FitEditor({ m, r, unit, data, set }: { m: Metric; r: MetricResult | undefined; unit: string; data: { xs: ArrayLike<number>; R: ArrayLike<number> } | null; set: (patch: Partial<Metric>) => void }) {
  const fit: FitSettings = m.fit ?? { comps: [], guess: true, run: false };
  const comps = fit.comps;
  // a change of the start shows the start again (Fit refits)
  const setFit = (patch: Partial<FitSettings>) => set({ fit: { ...fit, run: false, ...patch } });
  const setShow = (patch: NonNullable<FitSettings['show']>) => set({ fit: { ...fit, show: { ...fit.show, ...patch } } });
  const model = (
    <Field label="Model">
      <Segmented<NonNullable<FitSettings['mode']>>
        value={fit.mode ?? 'spectrum'}
        onChange={(mode) => set({ fit: { ...fit, mode, run: mode === 'dispersion' ? true : fit.run } })}
        options={[
          { id: 'spectrum', label: 'Components', title: 'Components on a curve' },
          { id: 'dispersion', label: 'Two-branch dispersion', title: 'The coupled-oscillator dispersion of two branches (e.g. two resonance positions vs a swept thickness or the angle)' },
        ]}
      />
    </Field>
  );
  if (fit.mode === 'dispersion')
    return (
      <div className="sub-editor">
        <div className="grid-fields">
          {model}
          <Field label="Mode 2">
            <Segmented<'linear' | 'angle'> value={fit.model ?? 'linear'} onChange={(mm) => set({ fit: { ...fit, model: mm } })} options={[{ id: 'linear', label: 'Linear', title: 'Linear in the parameter (e.g. a thickness)' }, { id: 'angle', label: 'Cavity vs angle', title: 'E₀/√(1 − sin²θ/n²)' }]} />
          </Field>
          <Field label="Fitted branches">
            <Switch checked={fit.show?.fitted !== false} onChange={(fitted) => setShow({ fitted })} />
          </Field>
          <Field label="Uncoupled modes">
            <Switch checked={fit.show?.start !== false} onChange={(start) => setShow({ start })} />
          </Field>
        </div>
      </div>
    );
  // the region's part of the curve
  const roiData = () => {
    if (!data) return null;
    const [i0, i1] = windowOf(data.xs, m.lo, m.hi);
    if (i1 - i0 < 4) return null;
    return { x: Array.from({ length: i1 - i0 + 1 }, (_, i) => data.xs[i0 + i]), y: Array.from({ length: i1 - i0 + 1 }, (_, i) => data.R[i0 + i]) };
  };
  const guess = (cs: FitComponent[]) => {
    const d = roiData();
    return d ? guessSpectrum(cs, d.x, d.y) : cs;
  };
  const setParam = (ci: number, key: string, patch: Partial<FitComponent['params'][string]>) => setFit({ comps: comps.map((c, k) => (k === ci ? { ...c, params: { ...c.params, [key]: { ...c.params[key], ...patch } } } : c)) });
  const keys = fitKeys(comps);
  const useFitted = () => {
    if (!r) return;
    setFit({ comps: comps.map((c, ci) => ({ ...c, params: Object.fromEntries(Object.entries(c.params).map(([k, p]) => { const key = keys.find((x) => x.ci === ci && x.param === k)?.key; const v = key ? r.values[key] : NaN; return [k, { ...p, value: Number.isFinite(v) ? v : p.value }]; })) })), guess: false });
  };
  return (
    <div className="sub-editor">
      <div className="grid-fields">
        {model}
        <Field label="Add a component">
          <select value="" onChange={(e) => e.target.value && setFit({ comps: guess([...comps, newComponent(e.target.value as ComponentType)]) })}>
            <option value="">+ add…</option>
            {TYPES.map((t) => <option key={t} value={t}>{COMPONENTS[t].label}</option>)}
          </select>
        </Field>
        <Field label="Start" title="Place the components on the data before every fit (each curve of a sweep); off: start from the values below">
          <Switch checked={fit.guess} onChange={(g) => setFit({ guess: g })} label="Guess on every curve" />
        </Field>
        <Field label={' '}>
          <span className="btn-pair">
            {comps.length > 0 && <button type="button" onClick={() => setFit({ comps: guess(comps) })} title="Place the start values on the current curve">Guess now</button>}
            {comps.length > 0 && (fit.run ? <button type="button" onClick={() => setFit({ run: false })} title="Show only the start model again">Show the start</button> : <button type="button" className="primary" onClick={() => setFit({ run: true })} title="Fit the components to the curve in the region (Levenberg-Marquardt)">Fit</button>)}
            {fit.run && comps.length > 0 && r && Number.isFinite(r.values.r2) && <button type="button" onClick={useFitted} title="The fitted values become the start (guessing off)">Keep as start</button>}
          </span>
        </Field>
      </div>
      <table className="data comps">
        <thead>
          <tr><th>Shown</th><th>Component</th><th>Start values (fixed: kept in the fit){fit.run ? ' · fitted' : ''}</th><th /></tr>
        </thead>
        <tbody>
          <tr>
            <td><Switch checked={fit.show?.start !== false} onChange={(start) => setShow({ start })} /></td>
            <td>Start model <span className="muted small">(dashed)</span></td>
            <td />
            <td />
          </tr>
          <tr>
            <td><Switch checked={fit.show?.fitted !== false} onChange={(fitted) => setShow({ fitted })} /></td>
            <td>Fitted model <span className="muted small">(solid)</span></td>
            <td className="muted">{fit.run && r && Number.isFinite(r.values.r2) ? `R² ${r.values.r2.toFixed(5)}` : 'press Fit'}</td>
            <td />
          </tr>
          {comps.map((c, ci) => (
            <tr key={c.id}>
              <td><Switch checked={compShown(fit, c.id)} onChange={(on) => setShow({ comps: { ...fit.show?.comps, [c.id]: on } })} /></td>
              <td title={COMPONENTS[c.type].note}><b>{keys.find((k) => k.ci === ci)?.key.split('_')[0]}</b> {COMPONENTS[c.type].label}</td>
              <td>
                <span className="params-cell">
                  {COMPONENTS[c.type].params.map((d) => {
                    const u = paramUnit(d.kind, unit, '');
                    const key = keys.find((k) => k.ci === ci && k.param === d.key)!.key;
                    return (
                      <span key={d.key} className="fit-param">
                        <NumberField label={`${d.label}${u ? ` [${u}]` : ''}`} value={+c.params[d.key].value.toPrecision(8)} onChange={(value) => setParam(ci, d.key, { value })} className="param" />
                        <button type="button" className={`lock${c.params[d.key].fixed ? ' on' : ''}`} title={c.params[d.key].fixed ? 'Fixed in the fit (click to free it)' : 'Free in the fit (click to fix it)'} onClick={() => setParam(ci, d.key, { fixed: !c.params[d.key].fixed })}>
                          {c.params[d.key].fixed ? 'fixed' : 'free'}
                        </button>
                        {r && fit.run && <span className="fitted" title={`${m.ref}.${key}`}>{fmt(r.values[key] ?? NaN)}</span>}
                      </span>
                    );
                  })}
                </span>
              </td>
              <td><IconButton icon="x" label="Remove the component" onClick={() => setFit({ comps: comps.filter((_, k) => k !== ci) })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
