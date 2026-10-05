// Tolerances page: fabrication tolerances of the configuration by Monte Carlo. The variations (which layers or media,
// thickness / n / k, the distribution, its amount, independent or systematic, a limit) make seeded samples of the
// structure; each is computed over the configuration's interrogation (one scan). The spread of the response (nominal,
// mean, median, a band, the samples), of every metric's result (statistics, histogram, against a variation) and pass /
// fail criteria with the yield.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../state.tsx';
import { interrogationOf } from '../model/analysis.ts';
import { LAMBDA_AXIS, POINT_META, THETA_AXIS } from '../model/compute.ts';
import { quantitiesOf, type Metric } from '../model/metrics.ts';
import { defaultTol, newVariation, passes, statsOf, tolSamples, type Stats, type TolCriterion, type TolSettings, type TolVariation } from '../model/tolerance.ts';
import { clearTol, startTol, stopTol, useTolRuns, warmTol, type TolRun } from '../workers/tolRuntime.ts';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import type { Overlay } from '../plot/overlays.ts';
import { exportCsv } from '../plot/export.ts';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { Board } from '../ui/Board.tsx';
import { Field, Icon, IconButton, Segmented, Switch } from '../ui/kit.tsx';
import { QuantityPicker, type PickGroup } from '../ui/QuantityPicker.tsx';

const fmt = (v: number, d = 5) => (Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');
const pct = (v: number) => (Number.isFinite(v) ? `${+(100 * v).toFixed(1)}%` : '—');
const PASS = '#2e9d5b';
const FAIL = '#d9534f';
const MEAN = '#2563eb';
const MEDIAN = '#e07b39';
const MAX_DRAWN = 80; // sample curves drawn

type Q = { key: string; label: string; unit: string; m: Metric };
const BANDS: { id: TolSettings['band']; label: string; title: string }[] = [
  { id: 'p5', label: 'P5–P95', title: 'The 5th to the 95th percentile at each point' },
  { id: 'minmax', label: 'Min–max', title: 'The whole range of the samples at each point' },
  { id: 'sigma', label: '±σ', title: 'The mean ± one standard deviation at each point' },
];

// The value of a quantity ('metricId|key') in a row of a run.
const valueIn = (run: TolRun, row: number, key: string) => {
  const [mid, qk] = key.split('|');
  const j = run.metrics.findIndex((m) => m.id === mid);
  return run.rows[row]?.values[j]?.[qk] ?? NaN;
};

// The samples computed (row 0: the nominal).
const doneRows = (run: TolRun) => run.rows.map((r, i) => (i > 0 && r && !r.error ? i : -1)).filter((i) => i > 0);

// At each point of the scan: the mean, the median and the band of a quantity over the samples (rows).
function responseStats(run: TolRun, field: string, band: TolSettings['band']) {
  const rows = doneRows(run);
  if (!run.xs.length || !rows.length) return null;
  const n = run.xs.length;
  const out = { mean: new Float64Array(n), median: new Float64Array(n), lo: new Float64Array(n), hi: new Float64Array(n) };
  const col = new Float64Array(rows.length);
  for (let x = 0; x < n; x++) {
    rows.forEach((r, j) => (col[j] = run.rows[r]?.fields[field]?.[x] ?? NaN));
    const st = statsOf(col);
    out.mean[x] = st.mean;
    out.median[x] = st.median;
    out.lo[x] = band === 'p5' ? st.p5 : band === 'minmax' ? st.min : st.mean - st.std;
    out.hi[x] = band === 'p5' ? st.p95 : band === 'minmax' ? st.max : st.mean + st.std;
  }
  return out;
}

// One variation: where (a medium, a layer; a DBR: every layer, one layer of its period, a cavity), what, how it is
// distributed, how much, correlated or not, its limit.
function VariationRow({ v, set, remove, places, partsOf }: { v: TolVariation; set: (patch: Partial<TolVariation>) => void; remove: () => void; places: { id: string; label: string }[]; partsOf: (place: string) => { id: string; label: string }[] }) {
  const medium = v.place === 'incident' || v.place === 'exit';
  const unit = v.what === 'd' ? (v.relative ? '%' : 'nm') : 'RIU';
  const [limitText, setLimitText] = useState(Number.isFinite(v.limit) ? String(v.limit) : '');
  const where = (place: string, part: string) => {
    const toMedium = place === 'incident' || place === 'exit';
    set({ place, part, ...(toMedium && v.what === 'd' ? { what: 'n', relative: false, amount: 0.001, limit: NaN } : {}) });
  };
  return (
    <div className={`tol-var${v.on ? '' : ' off'}`}>
      <Switch checked={v.on} onChange={(on) => set({ on })} title={v.on ? 'In use' : 'Not in use'} />
      <Field label="Where" className="tol-where">
        <select
          value={`${v.place}|${v.part}`}
          onChange={(e) => {
            const [place, part] = e.target.value.split('|');
            where(place, part);
          }}
        >
          {places.map((p) => {
            const parts = partsOf(p.id);
            return parts.length > 1 ? (
              <optgroup key={p.id} label={p.label}>
                {parts.map((q) => (
                  <option key={q.id} value={`${p.id}|${q.id}`}>{`${p.label.replace(/ \(DBR\)$/, '')} · ${q.label}`}</option>
                ))}
              </optgroup>
            ) : (
              <option key={p.id} value={`${p.id}|all`}>{p.label}</option>
            );
          })}
        </select>
      </Field>
      <Field label="Quantity">
        <select value={v.what} onChange={(e) => set({ what: e.target.value as TolVariation['what'], relative: false, amount: e.target.value === 'd' ? 1 : 0.001, limit: NaN })}>
          {!medium && <option value="d">Thickness d</option>}
          <option value="n">Refractive index n</option>
          <option value="k">Extinction coefficient k</option>
        </select>
      </Field>
      <Field label="Distribution">
        <select value={v.dist} onChange={(e) => set({ dist: e.target.value as TolVariation['dist'] })}>
          <option value="gauss">Gaussian, σ</option>
          <option value="uniform">Uniform, ±a</option>
        </select>
      </Field>
      <Field label={v.dist === 'gauss' ? 'σ' : '±a'}>
        <span className="tol-amount">
          <NumberField bare label="Amount" value={v.amount} min={0} onChange={(amount) => set({ amount })} className="tiny" />
          {v.what === 'd' ? (
            <select aria-label="Unit" value={v.relative ? '%' : 'nm'} onChange={(e) => set({ relative: e.target.value === '%' })}>
              <option value="nm">nm</option>
              <option value="%">%</option>
            </select>
          ) : (
            <span className="unit">RIU</span>
          )}
        </span>
      </Field>
      <Field label="Correlation" title="Independent: every layer its own deviation; systematic: one deviation for all its layers (e.g. a deposition rate off)">
        <select value={v.mode} onChange={(e) => set({ mode: e.target.value as TolVariation['mode'] })}>
          <option value="independent">Independent</option>
          <option value="systematic">Systematic</option>
        </select>
      </Field>
      <Field label="Limit |Δ|" title="The largest |deviation| (empty: none) — a truncated distribution">
        <span className="with-unit">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Limit"
            className={`tiny${limitText.trim() && !(Number(limitText) > 0) ? ' bad' : ''}`}
            placeholder="none"
            value={limitText}
            onChange={(e) => {
              setLimitText(e.target.value);
              const x = Number(e.target.value);
              if (!e.target.value.trim()) set({ limit: NaN });
              else if (x > 0) set({ limit: x });
            }}
          />
          <span className="unit">{unit}</span>
        </span>
      </Field>
      <span className="spacer" />
      <IconButton icon="trash" label="Remove the variation" onClick={remove} />
    </div>
  );
}

// A histogram of a quantity over the samples: the nominal and the mean, the criteria's limits; bars coloured by pass /
// fail of the criteria on that quantity.
function Histogram({ values, nominal, mean, criteria, label, width, height = 240 }: { values: number[]; nominal: number; mean: number; criteria: TolCriterion[]; label: string; width: number; height?: number }) {
  const v = values.filter(Number.isFinite);
  const M = { l: 48, r: 12, t: 12, b: 40 };
  const pw = width - M.l - M.r;
  const ph = height - M.t - M.b;
  if (!v.length) return <p className="muted">No value.</p>;
  let lo = Math.min(...v, ...(Number.isFinite(nominal) ? [nominal] : []));
  let hi = Math.max(...v, ...(Number.isFinite(nominal) ? [nominal] : []));
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) [lo, hi] = [lo - 0.5 * Math.max(1e-9, Math.abs(lo) * 1e-3), hi + 0.5 * Math.max(1e-9, Math.abs(hi) * 1e-3)];
  const nb = Math.max(8, Math.min(40, Math.round(Math.sqrt(v.length) * 1.5)));
  const w = (hi - lo) / nb;
  const counts = new Array<number>(nb).fill(0);
  for (const x of v) counts[Math.min(nb - 1, Math.floor((x - lo) / w))]++;
  const top = Math.max(...counts);
  const sx = (x: number) => M.l + ((x - lo) / (hi - lo)) * pw;
  const sy = (c: number) => M.t + ph - (c / top) * ph;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const yt = [0, Math.round(top / 2), top];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="histogram" role="img" aria-label={`Histogram of ${label}`}>
      <rect x={M.l} y={M.t} width={pw} height={ph} fill="none" stroke="var(--grid)" />
      {yt.map((c) => (
        <g key={c}>
          <line x1={M.l} x2={M.l + pw} y1={sy(c)} y2={sy(c)} stroke="var(--grid)" />
          <text x={M.l - 6} y={sy(c) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{c}</text>
        </g>
      ))}
      {counts.map((c, i) => {
        const mid = lo + (i + 0.5) * w;
        const color = criteria.length ? (criteria.every((k) => passes(k, mid)) ? PASS : FAIL) : 'var(--accent)';
        return c ? <rect key={i} x={sx(lo + i * w) + 0.5} y={sy(c)} width={Math.max(1, (w / (hi - lo)) * pw - 1)} height={M.t + ph - sy(c)} fill={color} fillOpacity={0.55} stroke={color} /> : null;
      })}
      {criteria.map((k, i) =>
        k.value >= lo && k.value <= hi ? <line key={`c${i}`} x1={sx(k.value)} x2={sx(k.value)} y1={M.t} y2={M.t + ph} stroke={FAIL} strokeWidth={1.5} strokeDasharray="5 3" /> : null,
      )}
      {Number.isFinite(nominal) && <line x1={sx(nominal)} x2={sx(nominal)} y1={M.t} y2={M.t + ph} stroke="var(--text)" strokeWidth={1.8} />}
      {Number.isFinite(mean) && <line x1={sx(mean)} x2={sx(mean)} y1={M.t} y2={M.t + ph} stroke={MEAN} strokeWidth={1.8} strokeDasharray="6 3" />}
      {ticks.map((t, i) => (
        <text key={i} x={sx(t)} y={M.t + ph + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmt(t, 4)}</text>
      ))}
      <text x={M.l + pw / 2} y={height - 6} textAnchor="middle" fontSize="12" fill="var(--text)">{label}</text>
      <text x={12} y={M.t + ph / 2} textAnchor="middle" fontSize="12" fill="var(--text)" transform={`rotate(-90 12 ${M.t + ph / 2})`}>samples</text>
    </svg>
  );
}

export function Tolerances() {
  const { project, update, lib, models } = useProject();
  const tol: TolSettings = { ...defaultTol(), ...project.tol };
  const variations = tol.variations.map((v) => ({ ...v, limit: Number.isFinite(v.limit) ? v.limit : NaN }));
  const setTol = (patch: Partial<TolSettings>) => update((p) => ({ ...p, tol: { ...defaultTol(), ...p.tol, ...patch } }));
  const setVar = (id: string, patch: Partial<TolVariation>) => setTol({ variations: variations.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  const runs = useTolRuns();
  useEffect(() => warmTol(), []); // (the workers start while the variations are set)
  const run = runs[project.configId];
  const running = run?.status === 'running';
  const s = project.sim;
  const spectral = s.mode === 'lambda';
  const unit = spectral ? 'nm' : '°';
  const axis = spectral ? LAMBDA_AXIS : THETA_AXIS;
  const resp = useRef<HTMLDivElement>(null);
  const hist = useRef<HTMLDivElement>(null);
  const scat = useRef<HTMLDivElement>(null);
  const pf = useRef<HTMLDivElement>(null);

  // where a variation can act: the media and the blocks; a DBR: every layer, one layer of its period, a cavity
  const matName = (id: string) => lib.get(id)?.name ?? id;
  const places = [
    { id: 'incident', label: `Incident medium · ${matName(project.structure.incident.id)}` },
    ...project.structure.blocks.map((b, i) => ({ id: b.id, label: `${i + 1}. ${b.label || (b.kind === 'film' ? matName(b.mat.id) : 'DBR')}${b.kind === 'dbr' ? ' (DBR)' : ''}` })),
    { id: 'exit', label: `Exit medium · ${matName(project.structure.exit.id)}` },
  ];
  const partsOf = (place: string) => {
    const b = project.structure.blocks.find((x) => x.id === place);
    if (!b || b.kind === 'film') return [{ id: 'all', label: place === 'incident' || place === 'exit' ? '—' : 'the layer' }];
    return [
      { id: 'all', label: 'every layer' },
      ...b.period.map((p, j) => ({ id: `p${j}`, label: `${p.label || matName(p.mat.id)} (every period)` })),
      ...b.cavities.map((_, i) => ({ id: `c${i}`, label: `cavity ${i + 1}` })),
    ];
  };
  const addVariation = () => {
    const b = project.structure.blocks[0];
    setTol({ variations: [...variations, newVariation(b ? { place: b.id } : { place: 'exit', what: 'n', amount: 0.001 })] });
  };

  // the quantities: every result of every metric in use
  const metrics = project.metrics.filter((m) => m.on);
  const qs: Q[] = metrics.flatMap((m) => quantitiesOf(m, spectral).map((q) => ({ key: `${m.id}|${q.key}`, label: `${m.label}: ${q.label}`, unit: q.unit(unit), m })));
  const qOf = (key: string) => qs.find((q) => q.key === key);
  const columns = (tol.columns.length ? tol.columns : metrics.map((m) => `${m.id}|${quantitiesOf(m, spectral)[0]?.key}`)).filter((k) => qOf(k));
  const [sel, setSel] = useState<string>('');
  const selKey = columns.includes(sel) ? sel : (columns[0] ?? '');
  const [vsVar, setVsVar] = useState<string>('');

  // what a run depends on (a change: its results are out of date)
  const key = JSON.stringify({ s: project.structure, it: interrogationOf(s), m: project.metrics, d: project.derived, v: variations.filter((v) => v.on), n: tol.samples, seed: tol.seed, mat: project.materials });
  const stale = !!run && run.key !== key;
  const active = variations.filter((v) => v.on && v.amount > 0);
  const start = () => {
    const samples = tolSamples(project.structure, lib, models, { variations, samples: Math.max(1, Math.round(tol.samples)), seed: tol.seed });
    const fields = ['R', 'T', 'A', 'phiR', ...(s.mode === 'theta' || tol.field === 'gh' ? ['gh'] : []), ...project.derived.map((d) => d.name)];
    startTol(project.configId, project.materials, samples, interrogationOf(s), project.metrics, project.derived, fields, variations, key);
  };

  // the samples computed (row 0: the nominal)
  const rowsDone = useMemo(() => (run ? doneRows(run) : []), [run]);
  const failed = run ? run.rows.filter((r, i) => i > 0 && r?.error).length : 0;
  const crit = tol.criteria.filter((c) => qOf(c.key));
  const passAll = (i: number) => crit.every((c) => passes(c, valueIn(run!, i, c.key)));

  // the response: nominal, mean, median, a band, the samples
  const fieldKeys = run?.rows[0]?.fields ? Object.keys(run.rows[0].fields) : [];
  const wantField = project.tol?.field ?? 'R';
  const field = fieldKeys.includes(wantField) ? wantField : 'R';
  const fieldLabel = (k: string) => (k in POINT_META ? POINT_META[k as keyof typeof POINT_META].label : k);
  const fieldUnit = (k: string) => (k in POINT_META ? POINT_META[k as keyof typeof POINT_META].unit : (project.derived.find((d) => d.name === k)?.unit ?? ''));
  const band = project.tol?.band ?? 'p5';
  const respStats = useMemo(() => (run ? responseStats(run, field, band) : null), [run, field, band]);

  // the statistics of every column (and of the criteria's quantities)
  const statKeys = [...new Set([...columns, ...crit.map((c) => c.key)])].join(',');
  const stats = useMemo(() => {
    const out: Record<string, { st: Stats; nominal: number; values: number[] }> = {};
    if (!run) return out;
    for (const k of statKeys.split(',').filter(Boolean)) {
      const values = rowsDone.map((i) => valueIn(run, i, k));
      out[k] = { st: statsOf(values), nominal: valueIn(run, 0, k), values };
    }
    return out;
  }, [run, rowsDone, statKeys]);

  const nPass = run && crit.length ? rowsDone.filter(passAll).length : 0;
  const yieldAll = rowsDone.length && crit.length ? nPass / rowsDone.length : NaN;
  const critRate = (c: TolCriterion) => (rowsDone.length ? rowsDone.filter((i) => passes(c, valueIn(run!, i, c.key))).length / rowsDone.length : NaN);

  const pickGroups: PickGroup[] = metrics.map((m) => ({
    id: m.id,
    title: `${m.label} · ${m.ref}`,
    items: quantitiesOf(m, spectral).map((q) => {
      const v = run ? valueIn(run, 0, `${m.id}|${q.key}`) : NaN;
      const u = q.unit(unit);
      return { key: q.key, label: q.label, value: Number.isFinite(v) ? `${fmt(v, 4)}${u ? ` ${u}` : ''}` : '' };
    }),
  }));
  const addCriterion = (mid: string, qk: string) => {
    const k = `${mid}|${qk}`;
    const nominal = run ? valueIn(run, 0, k) : NaN;
    const lower = ['width', 'R', 'rmse', 'cost', 'mse', 'maxErr', 'fwhm'].includes(qk);
    setTol({ criteria: [...tol.criteria, { key: k, op: lower ? 'le' : 'ge', value: Number.isFinite(nominal) ? +(nominal * (lower ? 1.2 : 0.8)).toPrecision(3) : 0 }] });
  };
  const setCrit = (i: number, patch: Partial<TolCriterion>) => setTol({ criteria: tol.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const csv = () => {
    if (!run) return;
    const vs = run.variations.filter((v) => v.on && v.amount > 0);
    const vIdx = vs.map((v) => run.variations.indexOf(v));
    const head = ['sample', ...vs.map((v) => `Δ${v.what} ${places.find((p) => p.id === v.place)?.label ?? v.place}${v.part !== 'all' ? ` ${v.part}` : ''} [${v.what === 'd' ? 'nm' : 'RIU'}]`), ...columns.map((k) => `${qOf(k)?.label}${qOf(k)?.unit ? ` [${qOf(k)?.unit}]` : ''}`), ...(crit.length ? ['pass'] : [])];
    const rows = [0, ...rowsDone].map((i) => [i === 0 ? 'nominal' : i, ...vIdx.map((j) => run.dev[i][j]), ...columns.map((k) => valueIn(run, i, k)), ...(crit.length ? [passAll(i) ? 1 : 0] : [])]);
    exportCsv(head, rows, `${project.name} tolerances`);
  };

  if (s.mode === 'map')
    return (
      <section className="card">
        <div className="card-head">
          <h2>Tolerances</h2>
        </div>
        <p className="muted">The tolerances run on an angular or a spectral scan: this configuration has a dispersion map. Switch its interrogation on the Simulation page.</p>
      </section>
    );

  const sel0 = stats[selKey];
  const selQ = qOf(selKey);
  const vsList = run ? run.variations.map((v, i) => ({ v, i })).filter(({ v }) => v.on && v.amount > 0) : [];
  const vs = vsList.find((x) => x.v.id === vsVar) ?? vsList[0];
  const vLabel = (v: TolVariation) => `Δ${v.what} · ${places.find((p) => p.id === v.place)?.label.replace(/^\d+\. /, '') ?? v.place}${v.part !== 'all' ? ` · ${partsOf(v.place).find((p) => p.id === v.part)?.label ?? v.part}` : ''}`;
  const selCrit = crit.filter((c) => c.key === selKey);

  const variationsCard = (
    <section className="card tol-vars-card">
      <div className="card-head">
        <h2>Variations</h2>
        <span className="sub">random deviations of the stack, applied to each sample (Monte Carlo)</span>
      </div>
      {variations.length ? (
        <div className="tol-vars">
          {variations.map((v) => (
            <VariationRow key={v.id} v={v} set={(patch) => setVar(v.id, patch)} remove={() => setTol({ variations: variations.filter((x) => x.id !== v.id) })} places={places} partsOf={partsOf} />
          ))}
        </div>
      ) : (
        <p className="muted">No variation yet. Add one per source of error: e.g. the gold thickness ± 2 nm (Gaussian), the index of a DBR's high-index layers ± 0.01 (systematic), the analyte index.</p>
      )}
      <div className="add-row">
        <button type="button" onClick={addVariation}>
          <Icon name="plus" size={14} />
          Variation
        </button>
      </div>
      <div className="tol-run">
        <NumberField label="Samples" value={tol.samples} min={1} max={5000} onChange={(samples) => setTol({ samples: Math.round(samples) })} className="tiny" />
        <NumberField label="Seed" value={tol.seed} min={0} onChange={(seed) => setTol({ seed: Math.round(seed) })} className="tiny" title="The same seed gives the same samples" />
        {running ? (
          <button type="button" onClick={() => stopTol(project.configId)}>
            Stop
          </button>
        ) : (
          <button type="button" className="primary" disabled={!active.length} onClick={start} title={active.length ? 'Compute the nominal structure and the samples' : 'Add a variation first'}>
            <Icon name="play" size={14} />
            Run
          </button>
        )}
        {run && !running && (
          <button type="button" onClick={() => clearTol(project.configId)}>
            Clear
          </button>
        )}
        {run && (
          <span className="tol-progress">
            <span className="bar">
              <span style={{ width: `${(100 * run.done) / Math.max(1, run.total)}%` }} />
            </span>
            <span className="muted small">
              {Math.max(0, run.done - 1)} / {run.total - 1} samples · {(run.elapsed / 1000).toFixed(1)} s{run.status === 'stopped' ? ' · stopped' : run.status === 'error' ? ` · ${run.message}` : ''}
              {failed ? ` · ${failed} invalid` : ''}
            </span>
          </span>
        )}
      </div>
      {stale && <div className="msg warn">The configuration or the variations changed since this run: run again to update the results.</div>}
      {Boolean(project.sweep.axes.length) && <p className="muted small">The swept parameters are not used here: every sample is one scan of the interrogation.</p>}
    </section>
  );

  const responseCard = (
    <section className="card">
      <div className="card-head">
        <h2>Response</h2>
        <span className="sub">the nominal, the mean and the median of the samples, their spread</span>
        <span className="spacer" />
        <select aria-label="Quantity of the response" value={field} onChange={(e) => setTol({ field: e.target.value })}>
          {(fieldKeys.length ? fieldKeys : ['R', 'T', 'A', 'phiR', 'gh']).map((k) => (
            <option key={k} value={k}>{fieldLabel(k)}</option>
          ))}
        </select>
        <Segmented value={tol.band} options={BANDS} onChange={(band) => setTol({ band })} />
        <Switch checked={tol.showSamples} onChange={(showSamples) => setTol({ showSamples })} label="Samples" title={`Draw the sample curves (at most ${MAX_DRAWN})`} />
        {run && respStats && (
          <FigureTools
            target={resp}
            name="tolerances response"
            csv={() =>
              exportCsv(
                [`${axis.label} [${axis.unit}]`, `${field} nominal`, `${field} mean`, `${field} median`, `${field} band low`, `${field} band high`],
                run.xs.map((x, i) => [x, run.rows[0]?.fields[field]?.[i] ?? NaN, respStats.mean[i], respStats.median[i], respStats.lo[i], respStats.hi[i]]),
                'tolerances response',
              )
            }
          />
        )}
      </div>
      {!run || !run.rows[0] || !respStats ? (
        <p className="muted">{running ? 'computing…' : 'Run the samples to see the spread of the response.'}</p>
      ) : (
        <AutoWidth figure={resp}>
          {(w) => (
            <LinePlot
              xAxis={{ ...axis, values: run.xs }}
              series={[
                { key: 'nom', label: 'nominal', color: 'var(--text)', y: run.rows[0]!.fields[field] ?? [], width: 2 },
                { key: 'mean', label: 'mean', color: MEAN, y: respStats.mean, width: 2 },
                { key: 'median', label: 'median', color: MEDIAN, y: respStats.median, dash: '6 4', width: 1.8 },
              ]}
              overlays={[
                { kind: 'area', key: 'band', x: run.xs, lo: respStats.lo, hi: respStats.hi, color: MEAN },
                ...(tol.showSamples
                  ? rowsDone.slice(0, MAX_DRAWN).map((i): Overlay => ({ kind: 'curve', key: `s${i}`, x: run.xs, y: run.rows[i]!.fields[field] ?? [], color: 'rgb(120 130 150 / 0.35)', solid: true, width: 0.7 }))
                  : []),
              ]}
              yLabel={fieldLabel(field)}
              yUnit={fieldUnit(field)}
              width={w}
              height={300}
            />
          )}
        </AutoWidth>
      )}
      {run && respStats && (
        <div className="tol-legend muted small">
          <span><i style={{ background: 'var(--text)' }} /> nominal</span>
          <span><i style={{ background: MEAN }} /> mean</span>
          <span><i className="dashed" style={{ borderColor: MEDIAN }} /> median</span>
          <span><i className="area" style={{ background: MEAN }} /> {BANDS.find((b) => b.id === tol.band)?.label}</span>
          {tol.showSamples && <span><i style={{ background: 'rgb(120 130 150 / 0.6)' }} /> samples</span>}
        </div>
      )}
    </section>
  );

  const metricsCard = (
    <section className="card">
      <div className="card-head">
        <h2>Metrics</h2>
        <span className="sub">statistics of each result over the samples (click a row: its distribution)</span>
        <span className="spacer" />
        <QuantityPicker label="Quantity" groups={pickGroups} onPick={(mid, qk) => setTol({ columns: [...new Set([...columns, `${mid}|${qk}`])] })} />
        <button type="button" onClick={csv} disabled={!run || !rowsDone.length} title="Every sample: its deviations, its results, pass / fail">
          <Icon name="download" size={14} />
          CSV
        </button>
      </div>
      {!columns.length ? (
        <p className="muted">No metric switched on: add metrics on the Simulation page.</p>
      ) : (
        <div className="table-scroll">
          <table className="data tol-stats">
            <thead>
              <tr>
                <th>Quantity</th>
                <th className="num">Nominal</th>
                <th className="num">Mean</th>
                <th className="num">σ</th>
                <th className="num">Median</th>
                <th className="num">P5</th>
                <th className="num">P95</th>
                <th className="num">Min</th>
                <th className="num">Max</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {columns.map((k) => {
                const q = qOf(k)!;
                const x = stats[k];
                return (
                  <tr key={k} className={`clickable${k === selKey ? ' selected' : ''}`} onClick={() => setSel(k)}>
                    <td>
                      {q.label}
                      {q.unit && <span className="muted"> [{q.unit}]</span>}
                    </td>
                    <td className="num">{fmt(x?.nominal ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.mean ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.std ?? NaN, 3)}</td>
                    <td className="num">{fmt(x?.st.median ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.p5 ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.p95 ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.min ?? NaN)}</td>
                    <td className="num">{fmt(x?.st.max ?? NaN)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <IconButton icon="x" label="Take this quantity away" onClick={() => setTol({ columns: columns.filter((c) => c !== k) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const distributionCard = (
    <section className="card">
      <div className="card-head">
        <h2>Distribution</h2>
        <span className="spacer" />
        <select aria-label="Quantity of the distribution" value={selKey} onChange={(e) => setSel(e.target.value)}>
          {columns.map((k) => (
            <option key={k} value={k}>{qOf(k)?.label}</option>
          ))}
        </select>
      </div>
      {!run || !sel0 || !selQ ? (
        <p className="muted">{running ? 'computing…' : 'Run the samples to see the distribution of each result.'}</p>
      ) : (
        <div className="tol-dist">
          <div className="front-view">
            <div className="card-head">
              <span className="muted small">histogram · black: nominal · blue dashed: mean{selCrit.length ? ' · red dashed: the criteria' : ''}</span>
              <span className="spacer" />
              <FigureTools target={hist} name={`histogram ${selQ.label}`} />
            </div>
            <AutoWidth figure={hist} max={620} min={260}>
              {(w) => <Histogram values={sel0.values} nominal={sel0.nominal} mean={sel0.st.mean} criteria={selCrit} label={`${selQ.label}${selQ.unit ? ` [${selQ.unit}]` : ''}`} width={w} />}
            </AutoWidth>
          </div>
          <div className="front-view">
            <div className="card-head">
              <span className="muted small">against</span>
              <select aria-label="Variation on the X axis" value={vs?.v.id ?? ''} onChange={(e) => setVsVar(e.target.value)}>
                {vsList.map(({ v }) => (
                  <option key={v.id} value={v.id}>{vLabel(v)}</option>
                ))}
              </select>
              <span className="spacer" />
              <FigureTools target={scat} name={`${selQ.label} vs deviation`} />
            </div>
            {vs && (
              <AutoWidth figure={scat} max={620} min={260}>
                {(w) => {
                  const xs = rowsDone.map((i) => run.dev[i][vs.i]);
                  const ys = rowsDone.map((i) => valueIn(run, i, selKey));
                  if (xs.length < 2 || Math.min(...xs) === Math.max(...xs)) return <p className="muted">This variation does not change from sample to sample.</p>;
                  const ok = rowsDone.map((i) => !crit.length || passAll(i));
                  const series: Series[] = crit.length
                    ? [
                        { key: 'pass', label: 'pass', color: PASS, x: xs.filter((_, j) => ok[j]), y: ys.filter((_, j) => ok[j]), dots: true, noLine: true },
                        { key: 'fail', label: 'fail', color: FAIL, x: xs.filter((_, j) => !ok[j]), y: ys.filter((_, j) => !ok[j]), dots: true, noLine: true },
                      ]
                    : [{ key: 'all', label: 'samples', color: MEAN, x: xs, y: ys, dots: true, noLine: true }];
                  return <LinePlot xAxis={{ id: 'dev', label: `Δ${vs.v.what}${vs.v.what === 'd' ? '' : ''}`, unit: vs.v.what === 'd' ? 'nm' : 'RIU', values: xs }} series={series} overlays={Number.isFinite(sel0.nominal) ? [{ kind: 'marker', key: 'nom', x: 0, y: sel0.nominal, color: 'var(--text)', text: 'nominal' }] : []} yLabel={selQ.label} yUnit={selQ.unit} width={w} height={240} />;
                }}
              </AutoWidth>
            )}
          </div>
        </div>
      )}
    </section>
  );

  const passCard = (
    <section className="card">
      <div className="card-head">
        <h2>Pass / fail</h2>
        <span className="sub">criteria on the results; the yield: the fraction of the samples that meets all of them</span>
        <span className="spacer" />
        <QuantityPicker label="Criterion" groups={pickGroups} onPick={addCriterion} />
        {run && crit.length > 0 && <FigureTools target={pf} name="pass fail" />}
      </div>
      {!tol.criteria.length ? (
        <p className="muted">No criterion yet. Add one per specification: e.g. the minimum of R ≤ 0.2, the sensitivity ≥ 100 °/RIU, the FWHM ≤ 5°.</p>
      ) : (
        <div className="tol-pass">
          <div className="tol-crit">
            {tol.criteria.map((c, i) => {
              const q = qOf(c.key);
              const nominal = run ? valueIn(run, 0, c.key) : NaN;
              const rate = q ? critRate(c) : NaN;
              return (
                <div key={i} className={`tol-crit-row${q ? '' : ' invalid'}`}>
                  <span className="c-tag">C{i + 1}</span>
                  <span className="goal-name">{q ? q.label : '(a removed metric)'}</span>
                  <Segmented
                    value={c.op}
                    options={[
                      { id: 'le', label: '≤', title: 'At most' },
                      { id: 'ge', label: '≥', title: 'At least' },
                    ]}
                    onChange={(op) => setCrit(i, { op })}
                  />
                  <NumberField bare label={`C${i + 1}: value`} unit={q?.unit} value={c.value} onChange={(value) => setCrit(i, { value })} className="tiny" />
                  <span className="muted small" title="The nominal structure">
                    nominal {fmt(nominal, 4)} {Number.isFinite(nominal) && (passes(c, nominal) ? <span className="ok-mark">✓</span> : <span className="bad-mark">✗</span>)}
                  </span>
                  <span className="tol-rate" title="The samples that meet it">
                    <span className="bar">
                      <span style={{ width: `${Number.isFinite(rate) ? 100 * rate : 0}%`, background: PASS }} />
                    </span>
                    {pct(rate)}
                  </span>
                  <IconButton icon="trash" label="Remove the criterion" onClick={() => setTol({ criteria: tol.criteria.filter((_, j) => j !== i) })} />
                </div>
              );
            })}
          </div>
          {run && crit.length > 0 && rowsDone.length > 0 && (
            <div className="tol-yield">
              <div className="yield-big">
                <span className="muted small">Yield</span>
                <b>{pct(yieldAll)}</b>
                <span className="muted small">
                  {nPass} of {rowsDone.length} samples pass {crit.length > 1 ? 'every criterion' : 'the criterion'}
                </span>
              </div>
              <AutoWidth figure={pf} max={560} min={240}>
                {(w) => {
                  const bars = [...crit.map((c) => ({ label: `C${tol.criteria.indexOf(c) + 1}`, title: `${qOf(c.key)?.label} ${c.op === 'le' ? '≤' : '≥'} ${c.value}`, rate: critRate(c) })), { label: 'All', title: 'every criterion', rate: yieldAll }];
                  const bw = w - 100;
                  return (
                    <svg className="yield-bars" width={w} height={24 * bars.length + 6} viewBox={`0 0 ${w} ${24 * bars.length + 6}`} role="img" aria-label="Pass rate per criterion">
                      {bars.map((b, i) => (
                        <g key={b.label} transform={`translate(0 ${4 + i * 24})`}>
                          <title>{b.title}</title>
                          <text x={0} y={14} fontSize="12" fontWeight={b.label === 'All' ? 600 : 400} fill="var(--text)">{b.label}</text>
                          <rect x={40} y={2} width={bw} height={16} fill={FAIL} fillOpacity={0.3} />
                          <rect x={40} y={2} width={bw * (Number.isFinite(b.rate) ? b.rate : 0)} height={16} fill={PASS} fillOpacity={0.8} />
                          <text x={w - 4} y={14} fontSize="12" textAnchor="end" fill="var(--text)">{pct(b.rate)}</text>
                        </g>
                      ))}
                    </svg>
                  );
                }}
              </AutoWidth>
            </div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <Board
      id="tolerances"
      className="opt-layout tol-layout"
      columns={[{ id: 'left' }, { id: 'right' }]}
      items={[
        { key: 'variations', col: 'left', label: 'Variations', node: variationsCard },
        { key: 'pass', col: 'left', label: 'Pass / fail', node: passCard },
        { key: 'response', col: 'right', label: 'Response', node: responseCard },
        { key: 'metrics', col: 'right', label: 'Metrics', node: metricsCard },
        { key: 'distribution', col: 'right', label: 'Distribution', node: distributionCard },
      ]}
    />
  );
}