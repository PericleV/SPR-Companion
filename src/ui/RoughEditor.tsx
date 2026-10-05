// The roughness of a layer (Structure page): its top and its bottom interface, each drawn — the height profile over the
// cell with the material above and below it, the slices and their mixtures (what the transfer matrices see) — with
// its settings: the kind of interface, the height (RMS or peak-to-peak), the mixing rule, and for a random profile its
// correlation length, cell, points and seed; a DBR layer: every period its own realization or the same shape.
import { useRef } from 'react';
import { useProject } from '../state.tsx';
import { colorOf } from '../model/materials.ts';
import { corrLength, defaultRough, heightsOf, mixIndex, wienerEps, ROUGH_MIX, ROUGH_TYPES, statsOf, type Rough, type RoughMix, type RoughSide, type Roughs, type RoughType } from '../model/rough.ts';
import type { ParamRef } from '../model/params.ts';
import { refractiveIndex } from '../physics/materials.ts';
import { NumberField } from './NumberField.tsx';
import { VaryTag } from './ParamsPanel.tsx';
import { AutoWidth } from './AutoWidth.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { Field, IconButton, Segmented, Switch } from './kit.tsx';

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');

// The slices of one interface: depth from the highest to the lowest point, the fraction of the material below.
function slicesOf(h: Float64Array, n: number) {
  const s = statsOf(h);
  const w = (s.max - s.min) / n;
  return Array.from({ length: n }, (_, k) => {
    const zc = s.min + (k + 0.5) * w;
    let below = 0;
    for (let i = 0; i < h.length; i++) if (h[i] <= zc) below++;
    return { z0: s.min + k * w, z1: s.min + (k + 1) * w, below: below / h.length };
  });
}

const hexMix = (a: string, b: string, f: number) => {
  const p = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : [128, 128, 128]);
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v * (1 - f) + y[i] * f)).join(' ')})`;
};

// One interface drawn: the profile h(x) (positive = deeper, towards the exit), the material above and below, the
// slices with their mixture colour and the fraction of the lower material.
function InterfaceDrawing({ r, above, below, width }: { r: Rough; above: { id: string; name: string }; below: { id: string; name: string }; width: number }) {
  const { project, lib } = useProject();
  const px = r.type === 'profile' ? Math.max(4, Math.round(r.px)) : 400;
  const h = heightsOf(r, px);
  const st = statsOf(h);
  const n = r.type === 'effective' ? 1 : Math.max(1, Math.round(r.slices));
  const sl = slicesOf(h, n);
  const [ca, cb] = [colorOf(project.colors, lib, above.id), colorOf(project.colors, lib, below.id)];
  const H = 150;
  const barW = 64;
  const W = Math.max(160, width - barW - 70);
  const span = Math.max(1e-9, st.max - st.min);
  const pad = span * 0.6;
  const z0 = st.min - pad;
  const z1 = st.max + pad;
  const y = (z: number) => 6 + ((z - z0) / (z1 - z0)) * (H - 12);
  // a random profile: its first part (≈ 12 correlation lengths), else the whole cell is noise at this width
  const shown = r.type === 'profile' ? Math.max(8, Math.min(px, Math.round((12 * r.cl * px) / Math.max(1, r.cell)))) : r.type === 'effective' ? 16 : px;
  const xs = (i: number) => 40 + (i / Math.max(1, shown - 1)) * W;
  const pts = Array.from({ length: shown }, (_, i) => (r.type === 'effective' ? [xs(i), y(h[i])] : [xs(i), y(h[i])]));
  const line = r.type === 'effective' ? pts.flatMap(([x, yy], i) => (i ? [`H ${x} V ${yy}`] : [`M ${x} ${yy}`])).join(' ') : pts.map(([x, yy], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${yy.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={H + 24} viewBox={`0 0 ${width} ${H + 24}`} className="rough-drawing" role="img" aria-label="The interface profile and its slices">
      <rect x={40} y={6} width={W} height={H - 12} fill={cb} />
      <path d={`${line} L ${last[0]} 6 L 40 6 Z`} fill={ca} />
      <path d={line} fill="none" stroke="var(--text)" strokeWidth={1} />
      {sl.map((s, k) => (
        <line key={k} x1={40} x2={40 + W} y1={y(s.z0)} y2={y(s.z0)} stroke="var(--panel)" strokeOpacity={0.55} strokeDasharray="2 3" />
      ))}
      <line x1={40} x2={40 + W} y1={y(sl[sl.length - 1].z1)} y2={y(sl[sl.length - 1].z1)} stroke="var(--panel)" strokeOpacity={0.55} strokeDasharray="2 3" />
      <line x1={40} x2={40 + W} y1={y(0)} y2={y(0)} stroke="var(--accent)" strokeWidth={1} strokeDasharray="5 3" />
      <text x={36} y={y(0) + 4} fontSize="10" textAnchor="end" fill="var(--accent)">0</text>
      <text x={36} y={y(st.min) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{fmt(st.min, 2)}</text>
      <text x={36} y={y(st.max) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{fmt(st.max, 2)}</text>
      <text x={44} y={18} fontSize="11" fill="var(--text)" paintOrder="stroke" stroke="var(--panel)" strokeWidth={3}>{above.name}</text>
      <text x={44} y={H - 10} fontSize="11" fill="var(--text)" paintOrder="stroke" stroke="var(--panel)" strokeWidth={3}>{below.name}</text>
      <text x={40} y={H + 18} fontSize="10" fill="var(--muted)">{r.type === 'profile' ? `x: ${fmt((shown / px) * r.cell, 3)} of ${fmt(r.cell, 4)} nm` : 'across the interface'} · heights in nm</text>
      {sl.map((s, k) => (
        <g key={`b${k}`}>
          <rect x={48 + W} y={y(s.z0)} width={barW - 18} height={Math.max(0.5, y(s.z1) - y(s.z0))} fill={hexMix(ca, cb, s.below)} stroke="var(--panel)" strokeWidth={0.5} />
          {y(s.z1) - y(s.z0) > 10 && <text x={52 + W + barW - 18} y={(y(s.z0) + y(s.z1)) / 2 + 3} fontSize="9" fill="var(--muted)">{Math.round(100 * s.below)}%</text>}
        </g>
      ))}
      <text x={48 + W} y={H + 18} fontSize="10" fill="var(--muted)">slices</text>
    </svg>
  );
}

function SideEditor({ side, r, set, above, below, dbr, refOf, lambda }: { side: RoughSide; r: Rough | undefined; set: (r: Rough | undefined) => void; above: { id: string; name: string }; below: { id: string; name: string }; dbr: boolean; refOf: (prop: 'size' | 'cl' | 'seed') => ParamRef; lambda: number }) {
  const { models } = useProject();
  const fig = useRef<HTMLDivElement>(null);
  const on = !!r?.on;
  const x = r ?? defaultRough();
  const patch = (p: Partial<Rough>) => set({ ...x, ...p });
  const h = on ? heightsOf(x, x.type === 'profile' ? Math.max(4, Math.round(x.px)) : 400) : null;
  const st = h ? statsOf(h) : null;
  const clMeasured = h && x.type === 'profile' ? (corrLength(h) * x.cell) / h.length : NaN;
  // the index of the interface layer (effective) at the Simulation's wavelength
  const n2 = () => [refractiveIndex(above.id, models, lambda), refractiveIndex(below.id, models, lambda)];
  const nEff = on && x.type === 'effective' && x.mix !== 'wiener' ? mixIndex(x.mix, n2(), [0.5, 0.5]) : null;
  // (a lamellar interface layer: its tensor, as indices along the lamellae and across them)
  const tensor = on && x.type === 'effective' && x.mix === 'wiener' ? wienerEps(n2(), [0.5, 0.5], 'x') : null;
  const nOf = (e: { re: number; im: number }) => {
    const v = Math.sqrt(Math.hypot(e.re, e.im));
    const a = Math.atan2(e.im, e.re) / 2;
    return `${(v * Math.cos(a)).toFixed(3)} + ${(v * Math.sin(a)).toFixed(3)}i`;
  };
  return (
    <div className={`rough-side${on ? '' : ' off'}`}>
      <div className="rough-side-head">
        <Switch checked={on} onChange={(v) => set(v ? { ...x, on: true } : r ? { ...r, on: false } : undefined)} label={<b>{side === 'top' ? 'Top' : 'Bottom'} interface</b>} />
        <span className="muted small">
          {above.name} / {below.name}
        </span>
        <span className="spacer" />
        {on && <FigureTools target={fig} name={`roughness ${side}`} />}
      </div>
      {on && (
        <>
          <div className="grid-fields">
            <Field label="Kind" className="span-all">
              <Segmented value={x.type} options={(Object.keys(ROUGH_TYPES) as RoughType[]).map((t) => ({ id: t, label: ROUGH_TYPES[t].label, title: ROUGH_TYPES[t].title }))} onChange={(type) => patch({ type, ...(type === 'graded' && x.type !== 'graded' ? { mix: 'linear' as RoughMix } : {}) })} />
            </Field>
            <Field label="Height" title={x.type === 'profile' ? 'The RMS (standard deviation) or the peak-to-peak height of the profile' : 'The interface layer is the peak-to-peak height thick, or 2·RMS'}>
              <span className="rough-size">
                <select aria-label="Height given as" value={x.kind} onChange={(e) => patch({ kind: e.target.value as Rough['kind'] })}>
                  <option value="rms">RMS</option>
                  <option value="pp">peak-to-peak</option>
                </select>
                <NumberField bare label="Height" unit="nm" value={x.size} min={0} onChange={(size) => patch({ size })} className="tiny" />
                <VaryTag pref={refOf('size')} />
              </span>
            </Field>
            <Field label="Mixing of a slice" className={x.mix === 'wiener' ? 'span-2' : ''} title="How the materials of a slice mix: Bruggeman, Maxwell-Garnett (the larger fraction as host), Looyenga (LLL), linearly in n, or lamellar (the limits of Wiener: a 1D profile, the arithmetic mean of ε along the lamellae and the harmonic mean across them — an anisotropic slice, valid for a correlation length ≪ λ)">
              <select value={x.mix} onChange={(e) => patch({ mix: e.target.value as RoughMix })}>
                {(Object.keys(ROUGH_MIX) as RoughMix[]).map((m) => (
                  <option key={m} value={m}>{ROUGH_MIX[m]}</option>
                ))}
              </select>
            </Field>
            {x.mix === 'wiener' && (
              <Field label="The profile runs" className="span-2" title="A 1D profile: its grooves normal to the plane of incidence (the profile along x, in that plane: TE sees the arithmetic mean, TM the harmonic one across x and the arithmetic one along z) or parallel to it (the profile along y: TE sees the harmonic mean, TM the arithmetic one)">
                <Segmented value={x.orient ?? 'x'} options={[{ id: 'x', label: 'in the plane of incidence' }, { id: 'y', label: 'across it' }]} onChange={(orient) => patch({ orient })} />
              </Field>
            )}
            {x.type !== 'effective' && <NumberField label="Slices" value={x.slices} min={1} max={200} onChange={(slices) => patch({ slices: Math.round(slices) })} title="Horizontal slices of the rough zone (each an effective medium)" />}
            {x.type === 'profile' && (
              <>
                <Field label="Correlation length" title="The autocorrelation of the heights is exp(−r²/cl²): small cl, sharp features; large cl, smooth hills">
                  <span className="rough-size">
                    <NumberField bare label="Correlation length" unit="nm" value={x.cl} min={0.1} onChange={(cl) => patch({ cl })} className="tiny" />
                    <VaryTag pref={refOf('cl')} />
                  </span>
                </Field>
                <NumberField label="Cell" unit="nm" value={x.cell} min={1} onChange={(cell) => patch({ cell })} title="Length of the periodic cell of the profile" />
                <NumberField label="Points" value={x.px} min={16} max={8000} onChange={(px) => patch({ px: Math.round(px) })} title="Points of the profile over the cell" />
                <Field label="Seed" title="The random realization (integers): sweep it for the statistics — the Simulation plots all, the mean or the median over the seeds">
                  <span className="rough-size">
                    <NumberField bare label="Seed" value={x.seed} min={0} onChange={(seed) => patch({ seed: Math.round(seed) })} className="tiny" />
                    <VaryTag pref={refOf('seed')} />
                  </span>
                </Field>
              </>
            )}
            {dbr && x.type === 'profile' && (
              <Field label="In every period" title="Independent: every period its own realization (seed + period); replicated: the same shape in every period (a roughness that grows conformally)">
                <select value={x.repeat} onChange={(e) => patch({ repeat: e.target.value as Rough['repeat'] })}>
                  <option value="independent">its own realization</option>
                  <option value="replicated">the same shape</option>
                </select>
              </Field>
            )}
          </div>
          <AutoWidth figure={fig} max={560} min={240}>{(w) => <InterfaceDrawing r={x} above={above} below={below} width={w} />}</AutoWidth>
          {st && (
            <p className="muted small rough-stats">
              {x.type === 'profile' ? `RMS ${fmt(st.rms)} nm · peak-to-peak ${fmt(st.pp)} nm · zone ${fmt(st.pp)} nm` : `interface layer ${fmt(x.kind === 'rms' ? 2 * x.size : x.size)} nm thick (${x.kind === 'rms' ? '2·RMS' : 'the peak-to-peak height'})`}, centred on the interface: each material keeps its thickness on average
              {x.type === 'profile' && ` · correlation length of this realization ${fmt(clMeasured)} nm`}
              {nEff && ` · interface layer n = ${nEff.re.toFixed(3)} + ${nEff.im.toFixed(3)}i at ${lambda} nm`}
              {tensor && ` · interface layer at ${lambda} nm: n along the lamellae ${nOf(tensor.y)}, across them ${nOf(tensor.x)}`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// The editor of a layer's two rough interfaces.
export function RoughEditor({ value, onChange, title, above, layer, below, dbr, refOf, onClose }: {
  value: Roughs | undefined;
  onChange: (r: Roughs | undefined) => void;
  title: string;
  above: { id: string; name: string };
  layer: { id: string; name: string };
  below: { id: string; name: string };
  dbr: boolean;
  refOf: (side: RoughSide, prop: 'size' | 'cl' | 'seed') => ParamRef;
  onClose: () => void;
}) {
  const { project } = useProject();
  const setSide = (side: RoughSide, r: Rough | undefined) => {
    const next: Roughs = { ...value, [side]: r };
    if (!next.top) delete next.top;
    if (!next.bottom) delete next.bottom;
    onChange(next.top || next.bottom ? next : undefined);
  };
  return (
    <div className="rough-editor">
      <div className="card-head">
        <h3>Roughness · {title}</h3>
        <span className="sub muted small">{dbr ? 'applies to this layer in every period' : 'the interfaces of this layer'}; top = towards the incident medium</span>
        <span className="spacer" />
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className="rough-sides">
        <SideEditor side="top" r={value?.top} set={(r) => setSide('top', r)} above={above} below={layer} dbr={dbr} refOf={(p) => refOf('top', p)} lambda={project.sim.lambda} />
        <SideEditor side="bottom" r={value?.bottom} set={(r) => setSide('bottom', r)} above={layer} below={below} dbr={dbr} refOf={(p) => refOf('bottom', p)} lambda={project.sim.lambda} />
      </div>
    </div>
  );
}
