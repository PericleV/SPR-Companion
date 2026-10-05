// A plot of the field inside the stack: |E|², |H|², the absorption or any component (Ex … Hz as |·|², |·|, Re, Im) vs
// depth, at the position of a metric or at a chosen point of the scan, for the curve chosen in the plots; the layers as
// coloured bands; the 1/e penetration depth into a chosen medium. Its settings are the plot's own (spec.field).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useProject } from '../state.tsx';
import { penetration, profileAt, type FieldSettings, type Interrogation, type Profile } from '../model/analysis.ts';
import type { Expanded, Structure } from '../model/structure.ts';
import { expand } from '../model/structure.ts';
import type { Metric, SensTarget } from '../model/metrics.ts';
import type { SimSettings } from '../model/project.ts';
import type { PlotSpec } from '../model/sweep.ts';
import type { AnalysisGroup } from '../model/sweepAnalysis.ts';
import { defaultField } from '../model/project.ts';
import { colorOf } from '../model/materials.ts';
import { COMPONENTS, type Component } from '../physics/field.ts';
import { LinePlot } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import type { Overlay } from '../plot/overlays.ts';
import { exportCsv } from '../plot/export.ts';
import { NumberField } from '../ui/NumberField.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { useSensTargets } from '../ui/useSensTargets.ts';
import { DataSelect } from '../ui/PlotCard.tsx';
import { BoundField } from '../ui/MetricsEditor.tsx';
import { Field, IconButton, Segmented } from '../ui/kit.tsx';

const PARTS = { abs2: '|·|²', abs: '|·|', re: 'Re', im: 'Im' } as const;
const SCALARS: Record<string, string> = { E2: '|E|² / |E₀|²', H2: '|H|² / |H₀|²', absorption: 'absorbed power density [1/nm]' };

type Props = {
  spec: PlotSpec;
  set: (patch: Partial<PlotSpec>) => void;
  remove?: () => void;
  groups: AnalysisGroup[];
  structureAt: (metricId?: string) => { structure: Structure; it: Interrogation } | null; // the structure of the chosen curve
  positionOf: (metricId: string) => number | undefined; // the position of a metric on that curve
  unit: string;
  extraHead?: ReactNode; // after the name (the Compare page: the configuration)
  // the configuration's own metrics and interrogation (the Compare page; default: the current configuration's)
  metrics?: Metric[];
  sim?: SimSettings;
};

export function FieldCard({ spec, set: setSpec, remove, groups, structureAt, positionOf, unit, extraHead, metrics: ownMetrics, sim }: Props) {
  const { project, lib, models } = useProject();
  const s = sim ?? project.sim;
  const metrics = ownMetrics ?? project.metrics;
  const f: FieldSettings = { ...defaultField(), ...spec.field };
  const set = (patch: Partial<FieldSettings>) => setSpec({ field: { ...f, ...patch } });
  const figure = useRef<HTMLDivElement>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const targets = useSensTargets();
  const tkey = (t: SensTarget) => JSON.stringify(t);
  const lim = spec.lim ?? {};

  const base = structureAt(f.at === 'metric' ? f.metric : undefined);
  const at = f.at === 'metric' ? positionOf(f.metric) : f.value;
  const baseKey = base ? JSON.stringify(base) : '';
  const mediumKey = tkey(f.medium);
  const res = useMemo((): { error: string } | { ex: Expanded; prof: Profile; pen: ReturnType<typeof penetration> } | null => {
    if (!base || at === undefined || !Number.isFinite(at)) return null;
    const ex = expand(base.structure, lib, models);
    if (ex.errors.length) return { error: ex.errors[0] };
    try {
      const prof = profileAt(ex, models, base.it, at, f.zIn, f.zOut);
      const pen = penetration(ex, models, base.it, at, f.medium);
      return { ex, prof, pen };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [baseKey, at, f.zIn, f.zOut, mediumKey, lib, models]); // eslint-disable-line react-hooks/exhaustive-deps

  const prof = res && 'prof' in res ? res.prof : null;
  const comp = (COMPONENTS as string[]).includes(f.show) ? (f.show as Component) : null;
  let y: Float64Array | null = null;
  let yLabel = '';
  if (prof) {
    if (comp && prof.comps) {
      const c = prof.comps[comp];
      y = c.re.map((re, i) => {
        const im = c.im[i];
        return f.part === 're' ? re : f.part === 'im' ? im : f.part === 'abs' ? Math.hypot(re, im) : re * re + im * im;
      });
      yLabel = f.part === 'abs2' ? `|${comp}|²` : f.part === 'abs' ? `|${comp}|` : `${PARTS[f.part]} ${comp}`;
    } else {
      const k = (comp ? 'E2' : f.show) as 'E2' | 'H2' | 'absorption';
      y = prof[k] ?? prof.E2;
      yLabel = SCALARS[k] ?? SCALARS.E2;
    }
  }

  const overlays: Overlay[] = [];
  if (res && 'prof' in res && prof) {
    const b = prof.boundaries; // the start of layer 1 … the start of the exit medium
    res.ex.layers.forEach((L, i) => {
      overlays.push({ kind: 'band', key: `L${i}`, lo: b[i], hi: b[i + 1], color: colorOf(project.colors, lib, L.mat.id), label: lib.get(L.mat.id)?.name });
    });
    if (res.pen) {
      const t = f.medium;
      const L = res.ex.layers;
      const first =
        t.kind === 'incident' ? 0 : t.kind === 'exit' ? L.length + 1 : 1 + L.findIndex((x) => x.block === t.block && (t.kind !== 'cavity' || (x.role === 'cavity' && x.index === t.index)));
      const penZ = t.kind === 'incident' ? -res.pen.depth : b[first - 1] + res.pen.depth;
      if (Number.isFinite(penZ)) overlays.push({ kind: 'vline', key: 'pen', x: penZ, color: 'var(--accent)' });
    }
  }

  const label = (t: SensTarget) => targets.find((x) => tkey(x.t) === tkey(t))?.label ?? 'the exit medium';
  const csv = prof && y ? () => exportCsv(['z_nm', yLabel], Array.from(prof.z, (z, i) => [z, y![i]]), `${project.name} field ${+prof.at.toFixed(4)}`) : undefined;
  return (
    <section className="card plot-card" id={`plot-${spec.id}`}>
      <div className="card-head">
        <input type="text" className="plot-title" value={spec.title ?? ''} placeholder="Plot name" title="The name of this plot" onChange={(e) => setSpec({ title: e.target.value })} />
        {extraHead}
        <DataSelect value="field" groups={groups} onChange={(source) => source !== 'field' && setSpec({ source, left: source === 'response' ? ['R'] : [], right: [], color: '' })} />
        <span className="spacer" />
        <IconButton icon="settings" label="Axis limits" active={limitsOpen} onClick={() => setLimitsOpen(!limitsOpen)} />
        <FigureTools target={figure} name={`${project.name} ${spec.title || 'field'}`} csv={csv} />
        {remove && <IconButton icon="x" label="Remove this plot" onClick={remove} />}
      </div>
      <div className="grid-fields plot-controls">
        <Field label="At" className="span-2">
          <select
            value={f.at === 'value' ? '@value' : metrics.some((m) => m.id === f.metric) ? f.metric : ''}
            onChange={(e) => (e.target.value === '@value' ? set({ at: 'value' }) : e.target.value && set({ at: 'metric', metric: e.target.value }))}
          >
            {f.at === 'metric' && !metrics.some((m) => m.id === f.metric) && <option value="">a metric's position…</option>}
            {metrics
              .filter((m) => !['custom', 'match', 'zones'].includes(m.kind) && !(m.kind === 'fit' && m.fit?.mode === 'dispersion'))
              .map((m) => (
                <option key={m.id} value={m.id}>{`the position of “${m.label}”`}</option>
              ))}
            <option value="@value">a given {s.mode === 'theta' ? 'angle' : 'wavelength'}</option>
          </select>
        </Field>
        {f.at === 'value' && <NumberField label={s.mode === 'theta' ? 'Angle θ' : 'Wavelength λ'} unit={unit} value={f.value} onChange={(value) => set({ value })} />}
        <NumberField label="Before the stack" unit="nm" value={f.zIn} onChange={(zIn) => set({ zIn })} min={0} />
        <NumberField label="After the stack" unit="nm" value={f.zOut} onChange={(zOut) => set({ zOut })} min={0} />
        <Field label="Show">
          <select value={f.show} onChange={(e) => set({ show: e.target.value })}>
            {Object.entries(SCALARS).map(([k, v]) => (
              <option key={k} value={k}>{v.split(' [')[0]}</option>
            ))}
            {COMPONENTS.map((c) => (
              <option key={c} value={c} disabled={s.pol === 'u'}>{c}{s.pol === 'u' ? ' (polarized only)' : ''}</option>
            ))}
          </select>
        </Field>
        {comp && (
          <Field label="As">
            <Segmented<FieldSettings['part']> value={f.part} onChange={(part) => set({ part })} options={Object.entries(PARTS).map(([k, v]) => ({ id: k as FieldSettings['part'], label: v }))} />
          </Field>
        )}
        <Field label="1/e depth into" title="The 1/e depth of |E|² from the first interface of this medium (the exit medium: the evanescent wave)">
          <select value={tkey(f.medium)} onChange={(e) => set({ medium: JSON.parse(e.target.value) as SensTarget })}>
            {targets.map((x) => (
              <option key={tkey(x.t)} value={tkey(x.t)}>{x.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {limitsOpen && (
        <div className="limits-panel">
          {(['x', 'y'] as const).map((k) => (
            <span key={k} className="lim">
              <BoundField label={`${k.toUpperCase()} min`} value={lim[k]?.[0] ?? NaN} onChange={(v) => setSpec({ lim: { ...lim, [k]: [v, lim[k]?.[1] ?? NaN] } })} />
              <BoundField label={`${k.toUpperCase()} max`} value={lim[k]?.[1] ?? NaN} onChange={(v) => setSpec({ lim: { ...lim, [k]: [lim[k]?.[0] ?? NaN, v] } })} />
            </span>
          ))}
          <button type="button" onClick={() => setSpec({ lim: {} })}>Automatic</button>
        </div>
      )}
      {res && 'prof' in res && (
        <div className="field-info muted small">
          {res.pen ? <>1/e depth in {label(f.medium)}: <b>{+res.pen.depth.toPrecision(5)} nm</b> (the line) · </> : `no 1/e decay in ${label(f.medium)} · `}
          λ = {+res.prof.lambda.toFixed(3)} nm, θ = {+res.prof.theta.toFixed(4)}°
        </div>
      )}
      {!base && <p className="muted">No data yet.</p>}
      {base && (at === undefined || !Number.isFinite(at)) && <p className="muted">{f.at === 'metric' ? 'Choose a metric with a position (on, and found in its region).' : 'Enter a value.'}</p>}
      {res && 'error' in res && <div className="msg err">{res.error}</div>}
      {prof && y && (
        <AutoWidth figure={figure}>
          {(w) => (
            <LinePlot
              xAxis={{ id: 'z', label: 'z (depth from the first interface)', unit: 'nm', values: Array.from(prof.z) }}
              series={[{ key: 'f', label: yLabel, color: 'var(--line)', y: y!, x: prof.z }]}
              yLabel={yLabel}
              yUnit=""
              xLim={lim.x}
              yLim={lim.y}
              width={w}
              height={320}
              overlays={overlays}
            />
          )}
        </AutoWidth>
      )}
    </section>
  );
}
