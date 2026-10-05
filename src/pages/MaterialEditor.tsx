// Editor of a user material: the model and its parameters, with a live preview of n and k.
import { useMemo, useState } from 'react';
import { useProject } from '../state.tsx';
import { FORMULA_TEXT, refractiveIndex, type EmaMethod, type MaterialDef, type MaterialModel } from '../physics/materials.ts';
import { parseTable, type TableColumns, type TableUnit } from '../physics/importers.ts';
import { ENERGY_UNITS, MODEL_LABEL, newMaterialId, nextColor, resample, toEv, type EnergyUnit } from '../model/materials.ts';
import { linspace } from '../model/compute.ts';
import { NumberField } from '../ui/NumberField.tsx';
import { MaterialSelect } from '../ui/MaterialSelect.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { LinePlot } from '../plot/LinePlot.tsx';
import { Field, Switch } from '../ui/kit.tsx';

type Kind = 'constant' | 'tabulated' | 'formula' | 'drude-lorentz' | 'ema' | 'kubo';
const KINDS: Kind[] = ['constant', 'tabulated', 'formula', 'drude-lorentz', 'ema', 'kubo'];

type Draft = {
  name: string;
  color: string;
  kind: Kind;
  is2D: boolean;
  monolayer: number;
  constant: { n: number; k: number };
  tab: { text: string; unit: TableUnit; cols: TableColumns; extrap: 'clamp' | 'linear'; resample: 'none' | 'linear' | 'spline'; count: number };
  formula: { formula: number; coeffs: string; k: number };
  dl: { epsInf: number; wp: number; gamma: number; unit: EnergyUnit; osc: { f: number; w0: number; g: number }[] };
  ema: { host: string; filler: string; porosity: number; method: EmaMethod };
  kubo: { mu: number; T: number; gamma: number; d: number; epsBg: number };
};

function draftOf(def: MaterialDef | null, color: string): Draft {
  const d: Draft = {
    name: def?.name ?? 'New material',
    color: def?.color ?? color,
    kind: 'constant',
    is2D: !!def?.monolayer,
    monolayer: def?.monolayer ?? 0.34,
    constant: { n: 1.5, k: 0 },
    tab: { text: '', unit: 'nm', cols: 'nk', extrap: 'clamp', resample: 'none', count: 200 },
    formula: { formula: 1, coeffs: '0, 1.03961212, 0.07746, 0.231792344, 0.141485, 1.01046945, 10.17647', k: 0 },
    dl: { epsInf: 1, wp: 9, gamma: 0.05, unit: 'eV', osc: [] },
    ema: { host: 'SiO2', filler: 'Air', porosity: 0.5, method: 'bruggeman' },
    kubo: { mu: 0.4, T: 300, gamma: 0.01, d: 0.34, epsBg: 1 },
  };
  const m = def?.model;
  if (!m) return d;
  if (m.type === 'constant') return { ...d, kind: 'constant', constant: { n: m.n, k: m.k } };
  if (m.type === 'tabulated')
    return { ...d, kind: 'tabulated', tab: { ...d.tab, extrap: m.extrap, text: m.table.lambda.map((l, i) => `${+(l * 1000).toPrecision(8)}\t${m.table.n[i]}\t${m.table.k[i]}`).join('\n') } };
  if (m.type === 'formula') return { ...d, kind: 'formula', formula: { formula: m.formula, coeffs: m.coefficients.join(', '), k: m.k } };
  if (m.type === 'drude-lorentz') return { ...d, kind: 'drude-lorentz', dl: { epsInf: m.epsInf, wp: m.wp, gamma: m.gamma, unit: 'eV', osc: m.osc.map((o) => ({ ...o })) } };
  if (m.type === 'ema') return { ...d, kind: 'ema', ema: { host: m.host, filler: m.filler, porosity: m.porosity, method: m.method } };
  if (m.type === 'kubo') return { ...d, kind: 'kubo', kubo: { ...m } };
  return d;
}

// The model of a draft, or what is wrong with it.
function build(d: Draft): { model: MaterialModel; range?: [number, number] } | string {
  switch (d.kind) {
    case 'constant':
      return { model: { type: 'constant', n: d.constant.n, k: d.constant.k } };
    case 'tabulated': {
      const t = parseTable(d.tab.text, d.tab.unit, d.tab.cols);
      if (typeof t === 'string') return t;
      if (t.table.lambda.length < 2 && d.tab.resample !== 'none') return 'Resampling needs at least two rows.';
      const table = d.tab.resample === 'none' ? t.table : resample(t.table, d.tab.count, d.tab.resample);
      return { model: { type: 'tabulated', table, extrap: d.tab.extrap }, range: t.range };
    }
    case 'formula': {
      const coefficients = d.formula.coeffs.split(/[\s,;]+/).filter(Boolean).map(Number);
      if (!coefficients.length || coefficients.some((v) => !Number.isFinite(v))) return 'Coefficients: numbers separated by commas or spaces.';
      return { model: { type: 'formula', formula: d.formula.formula, coefficients, k: d.formula.k } };
    }
    case 'drude-lorentz': {
      const u = d.dl.unit;
      return { model: { type: 'drude-lorentz', epsInf: d.dl.epsInf, wp: toEv(d.dl.wp, u), gamma: toEv(d.dl.gamma, u), osc: d.dl.osc.map((o) => ({ f: o.f, w0: toEv(o.w0, u), g: toEv(o.g, u) })) } };
    }
    case 'ema':
      if (d.ema.host === d.ema.filler) return 'Host and inclusions must be different materials.';
      return { model: { type: 'ema', method: d.ema.method, host: d.ema.host, filler: d.ema.filler, porosity: d.ema.porosity } };
    case 'kubo':
      return { model: { type: 'kubo', ...d.kubo } };
  }
}

export function MaterialEditor({ def, onDone }: { def: MaterialDef | null; onDone: (saved: MaterialDef | null) => void }) {
  const { project, update, lib } = useProject();
  const [d, setD] = useState<Draft>(() => draftOf(def, nextColor(project.materials.length)));
  const set = <K extends keyof Draft>(k: K, v: Partial<Draft[K]> | Draft[K]) => setD((x) => ({ ...x, [k]: typeof v === 'object' && !Array.isArray(v) ? { ...(x[k] as object), ...v } : v }));
  const built = useMemo(() => build(d), [d]);

  const preview = useMemo(() => {
    if (typeof built === 'string') return null;
    const id = '__draft__';
    const models = Object.fromEntries([...lib].map(([k, v]) => [k, v.model]));
    models[id] = built.model;
    const [lo, hi] = built.range ?? [400, 1000];
    const xs = linspace(lo, hi, 300);
    const nk = xs.map((l) => refractiveIndex(id, models, l));
    if (nk.some((z) => !Number.isFinite(z.re) || !Number.isFinite(z.im))) return { error: 'The model gives no finite index over the range (check the parameters).' };
    return { xs, n: nk.map((z) => z.re), k: nk.map((z) => z.im) };
  }, [built, lib]);

  const error = typeof built === 'string' ? built : preview && 'error' in preview ? preview.error : d.is2D && !(d.monolayer > 0) ? 'The monolayer thickness must be > 0.' : !d.name.trim() ? 'Give the material a name.' : '';

  const save = () => {
    if (error || typeof built === 'string') return;
    const kuboFilm = built.model.type === 'kubo';
    const out: MaterialDef = {
      id: def?.id ?? newMaterialId(d.name),
      name: d.name.trim(),
      color: d.color,
      model: built.model,
      ...(built.range ? { range: built.range } : {}),
      // a Kubo film is a 2D material whose monolayer is the film of the model
      ...(kuboFilm ? { monolayer: d.kubo.d } : d.is2D ? { monolayer: d.monolayer } : {}),
    };
    update((p) => ({ ...p, materials: def ? p.materials.map((m) => (m.id === def.id ? out : m)) : [...p.materials, out] }));
    onDone(out);
  };

  const tabFile = async (f: File | undefined) => {
    if (f) set('tab', { text: await f.text() });
  };

  return (
    <section className="card editor">
      <div className="card-head">
        <h2>{def ? `Edit “${def.name}”` : 'New material'}</h2>
      </div>
      <div className="grid-fields editor-head">
        <Field label="Name" className="span-2">
          <input type="text" value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Colour" title="The default colour of its layers on the Structure page (changeable there)">
          <span className="color-dot" style={{ background: d.color }}>
            <input type="color" aria-label="Colour" value={d.color} onChange={(e) => set('color', e.target.value)} />
          </span>
        </Field>
        <Field label="Model">
          <select value={d.kind} onChange={(e) => set('kind', e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{MODEL_LABEL[k]}</option>
            ))}
          </select>
        </Field>
        {d.kind !== 'kubo' && (
          <Field label="2D material" title="Its thickness = number of layers × the monolayer">
            <Switch checked={d.is2D} onChange={(v) => set('is2D', v)} label="Layers × monolayer" />
          </Field>
        )}
        {d.is2D && d.kind !== 'kubo' && <NumberField label="Monolayer" unit="nm" value={d.monolayer} onChange={(v) => set('monolayer', v)} min={0} />}
      </div>

      <div className="form-row model-params">
        {d.kind === 'constant' && (
          <>
            <NumberField label="n" value={d.constant.n} onChange={(v) => set('constant', { n: v })} />
            <NumberField label="k" value={d.constant.k} onChange={(v) => set('constant', { k: v })} min={0} />
          </>
        )}
        {d.kind === 'tabulated' && (
          <div className="tab-import">
            <div className="form-row">
              <label>
                First column
                <select value={d.tab.unit} onChange={(e) => set('tab', { unit: e.target.value as TableUnit })}>
                  <option value="nm">λ [nm]</option>
                  <option value="um">λ [µm] (refractiveindex.info)</option>
                  <option value="eV">E [eV]</option>
                </select>
              </label>
              <label>
                Next columns
                <select value={d.tab.cols} onChange={(e) => set('tab', { cols: e.target.value as TableColumns })}>
                  <option value="nk">n, k</option>
                  <option value="n">n (k = 0)</option>
                  <option value="eps">ε₁, ε₂</option>
                </select>
              </label>
              <label>
                Extrapolation
                <select value={d.tab.extrap} onChange={(e) => set('tab', { extrap: e.target.value as 'clamp' | 'linear' })}>
                  <option value="clamp">constant</option>
                  <option value="linear">linear</option>
                </select>
              </label>
              <label>
                Resample
                <select value={d.tab.resample} onChange={(e) => set('tab', { resample: e.target.value as Draft['tab']['resample'] })}>
                  <option value="none">no (the rows as given)</option>
                  <option value="linear">linear interpolation</option>
                  <option value="spline">cubic spline</option>
                </select>
              </label>
              {d.tab.resample !== 'none' && <NumberField label="points" value={d.tab.count} onChange={(v) => set('tab', { count: Math.round(v) })} min={2} max={100000} />}
              <label>
                CSV / text file
                <input type="file" accept=".csv,.txt,.dat,.tsv" onChange={(e) => tabFile(e.target.files?.[0])} />
              </label>
            </div>
            <textarea rows={8} placeholder={'Paste rows: wavelength  n  k (commas, tabs or spaces; headers are skipped)'} value={d.tab.text} onChange={(e) => set('tab', { text: e.target.value })} />
          </div>
        )}
        {d.kind === 'formula' && (
          <>
            <label>
              Formula (refractiveindex.info, λ in µm)
              <select value={d.formula.formula} onChange={(e) => set('formula', { formula: Number(e.target.value) })}>
                {Object.entries(FORMULA_TEXT).map(([k, t]) => (
                  <option key={k} value={k}>{`${k}. ${t}`}</option>
                ))}
              </select>
            </label>
            <label>
              Coefficients C1, C2, …
              <input type="text" className="wide" value={d.formula.coeffs} onChange={(e) => set('formula', { coeffs: e.target.value })} />
            </label>
            <NumberField label="k" value={d.formula.k} onChange={(v) => set('formula', { k: v })} min={0} />
          </>
        )}
        {d.kind === 'drude-lorentz' && (
          <div className="dl">
            <p className="muted small">ε(E) = ε∞ − ωp²/(E² + iγE) + Σ f·ω0²/(ω0² − E² − iγE)</p>
            <div className="form-row">
              <label>
                Units of ωp, γ, ω0
                <select value={d.dl.unit} onChange={(e) => set('dl', { unit: e.target.value as EnergyUnit })}>
                  {ENERGY_UNITS.map((u) => (
                    <option key={u} value={u}>{u === '1/cm' ? 'cm⁻¹' : u === 'nm' ? 'nm (as λ)' : u}</option>
                  ))}
                </select>
              </label>
              <NumberField label="ε∞" value={d.dl.epsInf} onChange={(v) => set('dl', { epsInf: v })} />
              <NumberField label="ωp" value={d.dl.wp} onChange={(v) => set('dl', { wp: v })} min={0} />
              <NumberField label="γ" value={d.dl.gamma} onChange={(v) => set('dl', { gamma: v })} min={0} />
            </div>
            {d.dl.osc.map((o, i) => (
              <div className="form-row" key={i}>
                <span className="muted">Oscillator {i + 1}</span>
                <NumberField label="f" value={o.f} onChange={(v) => set('dl', { osc: d.dl.osc.map((x, j) => (j === i ? { ...x, f: v } : x)) })} />
                <NumberField label="ω0" value={o.w0} onChange={(v) => set('dl', { osc: d.dl.osc.map((x, j) => (j === i ? { ...x, w0: v } : x)) })} min={0} />
                <NumberField label="γ" value={o.g} onChange={(v) => set('dl', { osc: d.dl.osc.map((x, j) => (j === i ? { ...x, g: v } : x)) })} min={0} />
                <button onClick={() => set('dl', { osc: d.dl.osc.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <button onClick={() => set('dl', { osc: [...d.dl.osc, { f: 1, w0: 3, g: 0.5 }] })}>Add a Lorentz oscillator</button>
          </div>
        )}
        {d.kind === 'ema' && (
          <>
            <label>
              Host
              <MaterialSelect value={d.ema.host} onChange={(id) => set('ema', { host: id })} />
            </label>
            <label>
              Inclusions (pores)
              <MaterialSelect value={d.ema.filler} onChange={(id) => set('ema', { filler: id })} />
            </label>
            <NumberField label="fill fraction of inclusions" value={d.ema.porosity} onChange={(v) => set('ema', { porosity: v })} min={0} max={1} />
            <label>
              Rule
              <select value={d.ema.method} onChange={(e) => set('ema', { method: e.target.value as EmaMethod })}>
                <option value="bruggeman">Bruggeman</option>
                <option value="maxwell-garnett">Maxwell-Garnett</option>
                <option value="looyenga">Looyenga</option>
              </select>
            </label>
          </>
        )}
        {d.kind === 'kubo' && (
          <>
            <NumberField label="μc [eV]" value={d.kubo.mu} onChange={(v) => set('kubo', { mu: v })} />
            <NumberField label="T [K]" value={d.kubo.T} onChange={(v) => set('kubo', { T: v })} min={0} />
            <NumberField label="ħΓ [eV]" value={d.kubo.gamma} onChange={(v) => set('kubo', { gamma: v })} min={0} />
            <NumberField label="film (monolayer) [nm]" value={d.kubo.d} onChange={(v) => set('kubo', { d: v })} min={0.01} />
            <NumberField label="ε background" value={d.kubo.epsBg} onChange={(v) => set('kubo', { epsBg: v })} />
          </>
        )}
      </div>

      {error ? <div className="msg err">{error}</div> : null}
      {preview && !('error' in preview) && (
        <AutoWidth max={760}>
          {(w) => (
            <LinePlot
              xAxis={{ id: 'lambda', label: 'λ', unit: 'nm', values: preview.xs }}
              series={[
                { key: 'n', label: 'n', color: d.color, y: preview.n },
                { key: 'k', label: 'k', color: d.color, y: preview.k, dash: '6 4' },
              ]}
              yLabel="n (solid), k (dashed)"
              yUnit=""
              width={w}
              height={240}
            />
          )}
        </AutoWidth>
      )}
      <div className="form-row actions">
        <button className="primary" disabled={!!error} onClick={save}>{def ? 'Save changes' : 'Add to my materials'}</button>
        <button onClick={() => onDone(null)}>Cancel</button>
        {project.materials.length > 0 && !def && <span className="muted small">{project.materials.length} material(s) of yours in this project</span>}
      </div>
    </section>
  );
}
