// Structure page: the stack as one table — the incident medium, the films and DBR blocks (a DBR opens to its period
// layers and cavities), the exit medium — with the material, the thickness and the material's own parameter (n of a
// constant material, a carrier density, a fill fraction) of every row; the values that are parameters carry a tag. The
// parameters (what is swept or optimized) below; the drawing of the stack beside.
import { useRef, useState, type ReactNode } from 'react';
import { useProject } from '../state.tsx';
import { expand, newId, withoutRough, type Block, type Cavity, type Dbr, type DbrLayer, type Film, type MatRef, type Structure as S } from '../model/structure.ts';
import { hasRough, type Rough, type Roughs, type RoughSide } from '../model/rough.ts';
import { RoughEditor } from '../ui/RoughEditor.tsx';
import { colorOf, paramOf } from '../model/materials.ts';
import type { ParamRef } from '../model/params.ts';
import { MaterialSelect } from '../ui/MaterialSelect.tsx';
import { NumberField } from '../ui/NumberField.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { ParamsPanel, VaryTag } from '../ui/ParamsPanel.tsx';
import { Icon, IconButton, Segmented, Switch } from '../ui/kit.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { exportCsv } from '../plot/export.ts';
import { StackDrawing } from './StackDrawing.tsx';
import { Board } from '../ui/Board.tsx';

type Prop = 'd' | 'layers2D' | 'mat' | 'param' | 'dn' | 'dk' | 'after' | 'm';
type RefOf = (prop: Prop) => ParamRef;
const fmtOff = (v: number) => `${v > 0 ? '+' : ''}${+v.toPrecision(4)}`;

// The material: its colour (a dot that opens a colour picker), its name, its tag when it is a parameter.
function MatCell({ value, onChange, refOf }: { value: MatRef; onChange: (m: MatRef) => void; refOf: RefOf }) {
  const { project, update, lib } = useProject();
  return (
    <span className="matcell">
      <label className="color-dot" title="Its colour in the drawings" style={{ background: colorOf(project.colors, lib, value.id) }}>
        <input type="color" value={colorOf(project.colors, lib, value.id)} onChange={(e) => update((x) => ({ ...x, colors: { ...x.colors, [value.id]: e.target.value } }))} aria-label="Material colour" />
      </label>
      <MaterialSelect value={value.id} onChange={(id) => onChange({ id })} />
      <VaryTag pref={refOf('mat')} />
    </span>
  );
}

// The material's own parameter (n of a constant material, N of a doped one, a fill fraction), and its index shifts
// when they are set.
function ParamCell({ value, onChange, refOf }: { value: MatRef; onChange: (m: MatRef) => void; refOf: RefOf }) {
  const { lib } = useProject();
  const p = paramOf(lib.get(value.id));
  return (
    <span className="paramcell">
      {p && (
        <>
          <span className="muted small">{p.label}</span>
          <NumberField bare label={p.label} value={value.param ?? p.value} onChange={(v) => onChange({ ...value, param: v })} min={p.min} max={p.max} className="short" />
          <VaryTag pref={refOf('param')} />
        </>
      )}
      {!!value.dn && <span className="tag-off" title="A constant added to n(λ) (a parameter: Δn)">n {fmtOff(value.dn)}</span>}
      {!!value.dk && <span className="tag-off" title="A constant added to k(λ) (a parameter: Δk)">k {fmtOff(value.dk)}</span>}
      {(value.dn || value.dk) && (
        <>
          <VaryTag pref={refOf('dn')} />
          <VaryTag pref={refOf('dk')} />
        </>
      )}
    </span>
  );
}

// The thickness in nm (or λ₀/(4n) of a quarter-wave layer), or the number of monolayers of a 2D material.
function ThickCell({ id, d, layers2D, onD, onLayers, refOf, fixed }: { id: string; d: number; layers2D: number; onD: (v: number) => void; onLayers: (v: number) => void; refOf: RefOf; fixed?: string }) {
  const { lib } = useProject();
  const mono = lib.get(id)?.monolayer;
  if (mono)
    return (
      <span className="thickcell">
        <NumberField bare label="Number of layers" unit={`× ${mono} nm`} value={layers2D} onChange={(v) => onLayers(Math.max(1, Math.round(v)))} min={1} className="short" />
        <VaryTag pref={refOf('layers2D')} />
      </span>
    );
  return (
    <span className="thickcell">
      {fixed ? <span className="muted">{fixed}</span> : <NumberField bare label="Thickness" unit="nm" value={d} onChange={onD} min={0} className="short" />}
      <VaryTag pref={refOf('d')} />
    </span>
  );
}

const move = <T,>(xs: T[], i: number, j: number) => {
  if (j < 0 || j >= xs.length) return xs;
  const out = xs.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

// The roughness of a layer in the table: a tag with its heights, a button that opens its editor (a row below).
type Named = { id: string; name: string };
type RoughCtx = { open: string | null; setOpen: (k: string | null) => void; neighbours: (block: string, role: 'film' | 'period' | 'cavity', index: number) => { above: Named; layer: Named; below: Named } };
// The roughness of a layer (under its name): a small button with the heights of its rough interfaces, which opens the
// editor (below the table).
function RoughChip({ k, r, ctx }: { k: string; r?: Roughs; ctx: RoughCtx }) {
  const on = hasRough(r);
  const t = (x?: Rough) => (x?.on && x.size > 0 ? `${+x.size.toPrecision(3)}` : '—');
  return (
    <button type="button" className={`rough-chip${on ? ' on' : ''}${ctx.open === k ? ' open' : ''}`} title="The roughness of its top and bottom interfaces (heights in nm): open the editor" aria-expanded={ctx.open === k} onClick={() => ctx.setOpen(ctx.open === k ? null : k)}>
      <Icon name="wave" size={13} />
      {on ? `${t(r?.top)} / ${t(r?.bottom)} nm` : 'roughness'}
    </button>
  );
}

function RowActions({ i, n, onMove, onCopy, onRemove, extra }: { i: number; n: number; onMove: (j: number) => void; onCopy: () => void; onRemove: () => void; extra?: ReactNode }) {
  return (
    <span className="row-actions">
      {extra}
      <IconButton icon="up" label="Move towards the incident medium" disabled={i === 0} onClick={() => onMove(i - 1)} />
      <IconButton icon="down" label="Move towards the exit medium" disabled={i === n - 1} onClick={() => onMove(i + 1)} />
      <IconButton icon="copy" label="Duplicate" onClick={onCopy} />
      <IconButton icon="x" label="Remove" onClick={onRemove} />
    </span>
  );
}

// The rows of a DBR block (opened): its settings, its period layers, its cavities.
function DbrRows({ b, set, ctx }: { b: Dbr; set: (patch: Partial<Dbr>) => void; ctx: RoughCtx }) {
  const { lib } = useProject();
  const setLayer = (j: number, patch: Partial<DbrLayer>) => set({ period: b.period.map((p, k) => (k === j ? { ...p, ...patch } : p)) });
  const setCav = (j: number, patch: Partial<Cavity>) => set({ cavities: b.cavities.map((c, k) => (k === j ? { ...c, ...patch } : c)) });
  const per = (j: number): RefOf => (prop) => ({ kind: 'period', block: b.id, index: j, prop: prop as 'd' });
  const cav = (j: number): RefOf => (prop) => ({ kind: 'cavity', block: b.id, index: j, prop: prop as 'd' });
  return (
    <>
      <tr className="sub-row dbr-settings">
        <td />
        <td colSpan={5}>
          <div className="dbr-settings-row">
            <span className="inline-field">
              Periods N
              <NumberField bare label="Periods N" value={b.periods} onChange={(v) => set({ periods: Math.max(1, Math.round(v)) })} min={1} max={500} className="tiny" />
              <VaryTag pref={{ kind: 'dbr', block: b.id, prop: 'periods' }} />
            </span>
            <span className="inline-field" title="The design wavelength of the λ₀/4 layers and the mλ₀/2 cavities">
              λ₀
              <NumberField bare label="Design wavelength λ₀" unit="nm" value={b.lambda0} onChange={(v) => set({ lambda0: v })} min={1} className="short" />
              <VaryTag pref={{ kind: 'dbr', block: b.id, prop: 'lambda0' }} />
            </span>
            <Switch checked={b.closing} onChange={(closing) => set({ closing })} label="Closing layer" title="One more first layer after the last period: (HL)^N H" />
            <Switch checked={b.mirrorAfterCavity} onChange={(mirrorAfterCavity) => set({ mirrorAfterCavity })} label="Mirror after a cavity" title="After each cavity the period is mirrored: (HL)^N C (LH)^N" />
          </div>
        </td>
      </tr>
      {b.period.map((p, j) => (
        <tr key={`p${j}`} className="sub-row">
          <td className="no muted">{String.fromCharCode(65 + j)}</td>
          <td><input type="text" className="name" aria-label="Layer label" placeholder={`layer ${String.fromCharCode(65 + j)}`} value={p.label} onChange={(e) => setLayer(j, { label: e.target.value })} /><RoughChip k={`p:${b.id}:${j}`} r={p.rough} ctx={ctx} /></td>
          <td><MatCell value={p.mat} onChange={(mat) => setLayer(j, { mat })} refOf={per(j)} /></td>
          <td>
            <span className="thick-mode">
              {!lib.get(p.mat.id)?.monolayer && (
                <select aria-label="Thickness mode" value={p.mode} onChange={(e) => setLayer(j, { mode: e.target.value as DbrLayer['mode'] })}>
                  <option value="qw">λ₀/4</option>
                  <option value="nm">nm</option>
                </select>
              )}
              <ThickCell id={p.mat.id} d={p.d} layers2D={p.layers2D} onD={(d) => setLayer(j, { d })} onLayers={(layers2D) => setLayer(j, { layers2D })} refOf={per(j)} fixed={p.mode === 'qw' ? 'λ₀/(4n)' : undefined} />
            </span>
          </td>
          <td><ParamCell value={p.mat} onChange={(mat) => setLayer(j, { mat })} refOf={per(j)} /></td>
          <td><RowActions i={j} n={b.period.length} onMove={(k) => set({ period: move(b.period, j, k) })} onCopy={() => set({ period: [...b.period.slice(0, j + 1), { ...p }, ...b.period.slice(j + 1)] })} onRemove={() => set({ period: b.period.filter((_, k) => k !== j) })} /></td>
        </tr>
      ))}
      {b.cavities.map((c, j) => (
        <tr key={`c${j}`} className="sub-row cavity">
          <td className="no muted">C{j + 1}</td>
          <td>
            <span className="inline-field">
              after period
              <NumberField bare label="Cavity position (after period)" value={c.after} onChange={(v) => setCav(j, { after: Math.max(0, Math.round(v)) })} min={0} className="tiny" />
              <VaryTag pref={cav(j)('after')} />
            </span>
            <RoughChip k={`c:${b.id}:${j}`} r={c.rough} ctx={ctx} />
          </td>
          <td><MatCell value={c.mat} onChange={(mat) => setCav(j, { mat })} refOf={cav(j)} /></td>
          <td>
            <span className="thick-mode">
              {!lib.get(c.mat.id)?.monolayer && (
                <select aria-label="Thickness mode" value={c.mode} onChange={(e) => setCav(j, { mode: e.target.value as Cavity['mode'] })}>
                  <option value="half">m·λ₀/2</option>
                  <option value="nm">nm</option>
                </select>
              )}
              {c.mode === 'half' && !lib.get(c.mat.id)?.monolayer ? (
                <span className="thickcell">
                  m
                  <NumberField bare label="Order m" value={c.m} onChange={(v) => setCav(j, { m: Math.max(1, Math.round(v)) })} min={1} className="tiny" />
                  <VaryTag pref={cav(j)('m')} />
                </span>
              ) : (
                <ThickCell id={c.mat.id} d={c.d} layers2D={c.layers2D} onD={(d) => setCav(j, { d })} onLayers={(layers2D) => setCav(j, { layers2D })} refOf={cav(j)} />
              )}
            </span>
          </td>
          <td><ParamCell value={c.mat} onChange={(mat) => setCav(j, { mat })} refOf={cav(j)} /></td>
          <td><RowActions i={j} n={b.cavities.length} onMove={(k) => set({ cavities: move(b.cavities, j, k) })} onCopy={() => set({ cavities: [...b.cavities, { ...c }] })} onRemove={() => set({ cavities: b.cavities.filter((_, k) => k !== j) })} /></td>
        </tr>
      ))}
      <tr className="sub-row">
        <td />
        <td colSpan={5}>
          <span className="row-buttons">
            <button type="button" onClick={() => set({ period: [...b.period, { label: '', mat: { id: 'SiO2' }, mode: 'qw', d: 100, layers2D: 1 }] })}>+ Period layer</button>
            <button type="button" onClick={() => set({ cavities: [...b.cavities, { mat: { id: 'SiO2' }, after: Math.floor(b.periods / 2), mode: 'half', d: 200, m: 1, layers2D: 1 }] })}>+ Cavity</button>
          </span>
        </td>
      </tr>
    </>
  );
}

const newFilm = (): Film => ({ kind: 'film', id: newId('f'), label: '', mat: { id: 'SiO2' }, d: 10, layers2D: 1 });
const newDbr = (): Dbr => ({
  kind: 'dbr', id: newId('d'), label: 'DBR', periods: 8, lambda0: 650, closing: false, mirrorAfterCavity: true, cavities: [],
  period: [{ label: 'H', mat: { id: 'TiO2' }, mode: 'qw', d: 70, layers2D: 1 }, { label: 'L', mat: { id: 'SiO2' }, mode: 'qw', d: 110, layers2D: 1 }],
});

export function Structure() {
  const { project, update, lib, models } = useProject();
  const s = project.structure;
  const drawing = useRef<HTMLDivElement>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const setS = (patch: Partial<S>) => update((p) => ({ ...p, structure: { ...p.structure, ...patch } }));
  const setBlocks = (blocks: Block[]) => setS({ blocks });
  const setBlock = (i: number, patch: Partial<Film> | Partial<Dbr>) => setBlocks(s.blocks.map((b, k) => (k === i ? ({ ...b, ...patch } as Block) : b)));
  const ex = expand(s, lib, models);
  const name = (m: MatRef) => lib.get(m.id)?.name ?? m.id;
  const total = ex.layers.reduce((a, L) => a + L.d, 0);
  const medium = (which: 'incident' | 'exit'): RefOf => (prop) => ({ kind: 'medium', which, prop: prop as 'mat' });
  const film = (b: Film): RefOf => (prop) => ({ kind: 'film', block: b.id, prop: prop as 'd' });
  const isOpen = (b: Block) => open[b.id] ?? true;
  // the roughness editors: which one is open; the materials around a layer (in the order of the structure)
  const [roughOpen, setRoughOpen] = useState<string | null>(null);
  const plain = expand({ ...withoutRough(s), reversed: false }, lib, models);
  const named = (m: MatRef): Named => ({ id: m.id, name: name(m) });
  // the open roughness editor (below the table): a film 'f:id', a DBR period layer 'p:id:j' or cavity 'c:id:j'
  const roughPanel = () => {
    if (!roughOpen) return null;
    const [kind, id, jj] = roughOpen.split(':');
    const j = Number(jj ?? 0);
    const i = s.blocks.findIndex((b) => b.id === id);
    const b = s.blocks[i];
    if (!b) return null;
    const refOf = (part: 'film' | 'period' | 'cavity') => (side: RoughSide, prop: 'size' | 'cl' | 'seed'): ParamRef => ({ kind: 'rough', block: id, part, index: j, side, prop });
    if (kind === 'f' && b.kind === 'film')
      return <RoughEditor value={b.rough} onChange={(rough) => setBlock(i, { rough })} title={`${i + 1}. ${b.label || name(b.mat)}`} {...ctx.neighbours(id, 'film', 0)} dbr={false} refOf={refOf('film')} onClose={() => setRoughOpen(null)} />;
    if (b.kind !== 'dbr') return null;
    if (kind === 'p' && b.period[j])
      return <RoughEditor value={b.period[j].rough} onChange={(rough) => setBlock(i, { period: b.period.map((p, k) => (k === j ? { ...p, rough } : p)) })} title={`${b.label || 'DBR'}, layer ${String.fromCharCode(65 + j)} (${name(b.period[j].mat)})`} {...ctx.neighbours(id, 'period', j)} dbr refOf={refOf('period')} onClose={() => setRoughOpen(null)} />;
    if (kind === 'c' && b.cavities[j])
      return <RoughEditor value={b.cavities[j].rough} onChange={(rough) => setBlock(i, { cavities: b.cavities.map((c, k) => (k === j ? { ...c, rough } : c)) })} title={`${b.label || 'DBR'}, cavity ${j + 1} (${name(b.cavities[j].mat)})`} {...ctx.neighbours(id, 'cavity', j)} dbr={false} refOf={refOf('cavity')} onClose={() => setRoughOpen(null)} />;
    return null;
  };
  const ctx: RoughCtx = {
    open: roughOpen,
    setOpen: setRoughOpen,
    neighbours: (block, role, index) => {
      const L = plain.layers;
      const i = L.findIndex((x) => x.block === block && (role === 'film' || ((x.role === role || (role === 'period' && x.role === 'closing')) && x.index === index)));
      return { above: named(i > 0 ? L[i - 1].mat : s.incident), layer: named(i >= 0 ? L[i].mat : s.incident), below: named(i >= 0 && i + 1 < L.length ? L[i + 1].mat : s.exit) };
    },
  };

  const rows = ex.layers.map((L, i) => {
    const where = L.role === 'rough' ? 'rough interface' : L.role === 'film' ? '' : L.role === 'cavity' ? `cavity ${(L.index ?? 0) + 1}` : L.role === 'closing' ? 'closing layer' : `period ${L.period}, layer ${String.fromCharCode(65 + (L.index ?? 0))}`;
    const block = s.blocks.find((b) => b.id === L.block);
    const material = L.mix ? L.mix.mats.map((m, k) => `${name(m)} ${Math.round(100 * L.mix!.f[k])}%`).join(' + ') : name(L.mat);
    return { no: i + 1, block: block?.label || (block?.kind === 'dbr' ? 'DBR' : ''), where, material, d: L.d, layers2D: L.layers2D };
  });
  const csv = () =>
    exportCsv(
      ['#', 'block', 'position', 'material', 'thickness_nm', 'monolayers'],
      [[0, 'incident medium', '', name(ex.incident), '', ''], ...rows.map((r) => [r.no, r.block, r.where, r.material, r.d, r.layers2D ?? '']), [rows.length + 1, 'exit medium', '', name(ex.exit), '', '']],
      `${project.name} layers`,
    );
  const mediumRow = (which: 'incident' | 'exit') => (
    <tr className="medium-row">
      <td className="no muted">{which === 'incident' ? 'in' : 'out'}</td>
      <td className="muted">{which === 'incident' ? 'Incident medium' : 'Exit medium'}</td>
      <td><MatCell value={s[which]} onChange={(m) => setS({ [which]: m })} refOf={medium(which)} /></td>
      <td className="muted">∞</td>
      <td><ParamCell value={s[which]} onChange={(m) => setS({ [which]: m })} refOf={medium(which)} /></td>
      <td />
    </tr>
  );

  const layersCard = (
        <section className="card">
          <div className="card-head">
            <h2>Layers</h2>
            <span className="sub">multilayer stack, from the incident to the exit medium</span>
            <span className="spacer" />
            <Switch checked={!!s.reversed} onChange={(reversed) => setS({ reversed })} label="Light from the exit side" title="The light comes from the exit medium: the layers are met in reverse order" />
            <button type="button" onClick={() => setBlocks([...s.blocks, newFilm()])}>+ Film</button>
            <button type="button" onClick={() => setBlocks([...s.blocks, newDbr()])}>+ DBR</button>
          </div>
          <div className="table-scroll">
            <table className="data layers">
              <thead>
                <tr><th className="no">#</th><th>Name</th><th>Material</th><th>Thickness</th><th title="The material's own parameter: n of a constant material, a carrier density, a fill fraction">n / param.</th><th /></tr>
              </thead>
              <tbody>
                {mediumRow('incident')}
                {s.blocks.map((b, i) =>
                  b.kind === 'film' ? (
                    <tr key={b.id}>
                      <td className="no">{i + 1}</td>
                      <td><input type="text" className="name" aria-label="Layer name" placeholder="name" value={b.label} onChange={(e) => setBlock(i, { label: e.target.value })} /><RoughChip k={`f:${b.id}`} r={b.rough} ctx={ctx} /></td>
                      <td><MatCell value={b.mat} onChange={(mat) => setBlock(i, { mat })} refOf={film(b)} /></td>
                      <td><ThickCell id={b.mat.id} d={b.d} layers2D={b.layers2D} onD={(d) => setBlock(i, { d })} onLayers={(layers2D) => setBlock(i, { layers2D })} refOf={film(b)} /></td>
                      <td><ParamCell value={b.mat} onChange={(mat) => setBlock(i, { mat })} refOf={film(b)} /></td>
                      <td><RowActions i={i} n={s.blocks.length} onMove={(j) => setBlocks(move(s.blocks, i, j))} onCopy={() => setBlocks([...s.blocks.slice(0, i + 1), { ...structuredClone(b), id: newId('f') }, ...s.blocks.slice(i + 1)])} onRemove={() => setBlocks(s.blocks.filter((_, k) => k !== i))} /></td>
                    </tr>
                  ) : (
                    <DbrBlockRows key={b.id} b={b} i={i} n={s.blocks.length} open={isOpen(b)} toggle={() => setOpen({ ...open, [b.id]: !isOpen(b) })} ctx={ctx} set={(patch) => setBlock(i, patch)} onMove={(j) => setBlocks(move(s.blocks, i, j))} onCopy={() => setBlocks([...s.blocks.slice(0, i + 1), { ...structuredClone(b), id: newId('d') }, ...s.blocks.slice(i + 1)])} onRemove={() => setBlocks(s.blocks.filter((_, k) => k !== i))} />
                  ),
                )}
                {mediumRow('exit')}
              </tbody>
            </table>
          </div>
          {roughPanel()}
          {ex.errors.map((e) => <div key={e} className="msg err">{e}</div>)}
          {ex.warnings.map((w) => <div key={w} className="msg warn">{w}</div>)}
        </section>
  );
  // the stack, beside the tables (below them on narrow screens)
  const stackCard = (
        <section className="card">
          <div className="card-head">
            <h2>Stack</h2>
            <span className="sub">{ex.errors.length ? '—' : `${rows.length} layers, ${+total.toFixed(2)} nm`}</span>
            <span className="spacer" />
            <FigureTools target={drawing} name={`${project.name} stack`} />
          </div>
          <div className="stack-tools">
            <Segmented
              value={project.light ?? 'left'}
              onChange={(light) => update((p) => ({ ...p, light }))}
              title="The light's arrow on the drawing"
              options={[
                { id: 'left', label: '↘', title: 'Light from the left' },
                { id: 'normal', label: '↓', title: 'Light at normal incidence' },
                { id: 'right', label: '↙', title: 'Light from the right' },
              ]}
            />
            <Switch checked={showLayers} onChange={setShowLayers} label="Layer list" />
          </div>
          {ex.errors.length ? (
            <p className="muted small">Fix the structure to see it.</p>
          ) : (
            <AutoWidth figure={drawing} max={420}>{(w) => <StackDrawing ex={ex} lib={lib} width={w} colors={project.colors} light={project.light} />}</AutoWidth>
          )}
          {showLayers && !ex.errors.length && (
            <div className="layer-list">
              <div className="layer-list-head">
                <span className="muted small">The real layers</span>
                <span className="spacer" />
                <IconButton icon="download" label="The layers as CSV" onClick={csv} />
              </div>
              <ol>
                <li className="medium"><span className="dot" style={{ background: colorOf(project.colors, lib, ex.incident.id) }} /> <span className="mat">{name(ex.incident)}</span> <span className="muted small">incident</span></li>
                {rows.map((r, i) => (
                  <li key={r.no} title={[r.block, r.where].filter(Boolean).join(' · ')}>
                    <span className="no">{r.no}</span>
                    <span className="dot" style={{ background: colorOf(project.colors, lib, ex.layers[i].mat.id) }} />
                    <span className="mat">{r.material}</span>
                    <span className="num">{+r.d.toFixed(2)} nm{r.layers2D ? ` (${r.layers2D} L)` : ''}</span>
                  </li>
                ))}
                <li className="medium"><span className="dot" style={{ background: colorOf(project.colors, lib, ex.exit.id) }} /> <span className="mat">{name(ex.exit)}</span> <span className="muted small">exit</span></li>
              </ol>
            </div>
          )}
        </section>
  );
  return (
    <Board
      id="structure"
      className="structure-layout"
      columns={[{ id: 'main', className: 'structure' }, { id: 'side', className: 'stack-side' }]}
      items={[
        { key: 'layers', col: 'main', label: 'Layers', node: layersCard },
        { key: 'params', col: 'main', label: 'Parameters', node: <ParamsPanel /> },
        { key: 'stack', col: 'side', label: 'Stack', node: stackCard },
      ]}
    />
  );
}

// A DBR block: its row (name, a summary, open / close), and when open its settings, period layers and cavities.
function DbrBlockRows({ b, i, n, open, toggle, set, onMove, onCopy, onRemove, ctx }: { b: Dbr; i: number; n: number; open: boolean; toggle: () => void; set: (patch: Partial<Dbr>) => void; onMove: (j: number) => void; onCopy: () => void; onRemove: () => void; ctx: RoughCtx }) {
  const { lib } = useProject();
  const summary = `(${b.period.map((p) => lib.get(p.mat.id)?.name ?? p.mat.id).join(' / ')})×${b.periods}${b.cavities.length ? `, ${b.cavities.length} cavit${b.cavities.length === 1 ? 'y' : 'ies'}` : ''}, λ₀ ${b.lambda0} nm`;
  return (
    <>
      <tr className="dbr-row">
        <td className="no">{i + 1}</td>
        <td><input type="text" className="name" aria-label="Block name" placeholder="DBR" value={b.label} onChange={(e) => set({ label: e.target.value })} /></td>
        <td colSpan={3}>
          <button type="button" className="link-row" onClick={toggle} aria-expanded={open}>
            <span className="chev">{open ? '▾' : '▸'}</span> DBR {summary}
          </button>
        </td>
        <td><RowActions i={i} n={n} onMove={onMove} onCopy={onCopy} onRemove={onRemove} /></td>
      </tr>
      {open && <DbrRows b={b} set={set} ctx={ctx} />}
    </>
  );
}
