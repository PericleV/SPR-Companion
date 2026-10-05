// The parameters of the project: what changes (a thickness, a material, an index n or k, a number of periods…) and
// how — swept over values, optimized within bounds, or both. "Add parameter" picks where (the incident medium, a layer,
// a DBR and its period layers and cavities, the exit medium), what, and the values; the table edits them.
import { useState } from 'react';
import { useProject } from '../state.tsx';
import { applyParams, paramKey, type ParamInfo, type ParamRef } from '../model/params.ts';
import { exposeDefaults, sweepValues, type Exposed, type ValueMode } from '../model/exposed.ts';
import { colorOf, paramOf } from '../model/materials.ts';
import type { Library } from '../physics/library.ts';
import type { Structure } from '../model/structure.ts';
import { NumberField } from './NumberField.tsx';
import { MaterialSelect } from './MaterialSelect.tsx';
import { useParamInfos } from './useParamInfos.ts';
import { Field, IconButton, Segmented, Switch } from './kit.tsx';

const fmt = (v: number | string) => (typeof v === 'number' ? String(+v.toPrecision(6)) : v);
const letter = (j: number) => String.fromCharCode(65 + j);

// The places of the structure that have parameters.
type Place = { key: string; label: string; color: string; match: (r: ParamRef) => boolean };
function placesOf(s: Structure, lib: Library, colors: Record<string, string>): Place[] {
  const name = (id: string) => lib.get(id)?.name ?? id;
  const out: Place[] = [{ key: 'incident', label: `Incident medium · ${name(s.incident.id)}`, color: colorOf(colors, lib, s.incident.id), match: (r) => r.kind === 'medium' && r.which === 'incident' }];
  s.blocks.forEach((b, i) => {
    if (b.kind === 'film') out.push({ key: b.id, label: `${i + 1}. ${b.label || name(b.mat.id)}`, color: colorOf(colors, lib, b.mat.id), match: (r) => (r.kind === 'film' || r.kind === 'rough') && r.block === b.id });
    else out.push({ key: b.id, label: `${i + 1}. ${b.label || 'DBR'} (DBR)`, color: colorOf(colors, lib, b.period[0]?.mat.id ?? ''), match: (r) => (r.kind === 'dbr' || r.kind === 'period' || r.kind === 'cavity' || r.kind === 'rough') && r.block === b.id });
  });
  out.push({ key: 'exit', label: `Exit medium · ${name(s.exit.id)}`, color: colorOf(colors, lib, s.exit.id), match: (r) => r.kind === 'medium' && r.which === 'exit' });
  return out;
}

// What a parameter is, in words (null: not offered — the n shift of a material whose n is itself a parameter).
function whatOf(info: ParamInfo, s: Structure, lib: Library): string | null {
  const r = info.ref;
  const matOf = (): string | undefined => {
    if (r.kind === 'medium') return s[r.which].id;
    const b = s.blocks.find((x) => 'block' in r && x.id === r.block);
    if (!b) return undefined;
    if (r.kind === 'film' && b.kind === 'film') return b.mat.id;
    if (r.kind === 'period' && b.kind === 'dbr') return b.period[r.index]?.mat.id;
    if (r.kind === 'cavity' && b.kind === 'dbr') return b.cavities[r.index]?.mat.id;
    if (r.kind === 'rough') return b.kind === 'film' ? b.mat.id : r.part === 'period' ? b.period[r.index]?.mat.id : b.cavities[r.index]?.mat.id;
    return undefined;
  };
  const def = lib.get(matOf() ?? '');
  const p = paramOf(def);
  const constant = def?.model.type === 'constant';
  const part = r.kind === 'rough' ? r.part : r.kind;
  const prefix = part === 'period' && 'index' in r ? `Layer ${letter(r.index)} (${def?.name ?? '?'}) · ` : part === 'cavity' && 'index' in r ? `Cavity ${r.index + 1} (${def?.name ?? '?'}) · ` : '';
  if (r.kind === 'scan') return null;
  if (r.kind === 'rough') return `${prefix}Roughness, ${r.side} · ${r.prop === 'size' ? info.label.replace(/.*roughness, /, '') : r.prop === 'cl' ? 'correlation length' : 'seed (realization)'}`;
  if (!('prop' in r)) return null;
  switch (r.prop) {
    case 'd':
      return `${prefix}Thickness`;
    case 'layers2D':
      return `${prefix}Number of layers`;
    case 'mat':
      return `${prefix}Material`;
    case 'param':
      return `${prefix}${p?.label === 'n' ? 'Refractive index n' : (p?.label ?? 'Parameter')}`;
    case 'dn':
      return p?.label === 'n' ? null : `${prefix}Refractive index n (shift of n(λ))`;
    case 'dk':
      return constant && def?.model.type === 'constant' && def.model.k === 0 ? `${prefix}Extinction k` : `${prefix}Extinction k (shift of k(λ))`;
    case 'periods':
      return 'Periods N';
    case 'lambda0':
      return 'Design wavelength λ₀';
    case 'after':
      return `${prefix}Position (after period)`;
    case 'm':
      return `${prefix}Order m (of mλ₀/2)`;
  }
  return null;
}

const ORDER = ['periods', 'lambda0', 'd', 'layers2D', 'mat', 'param', 'dn', 'dk', 'after', 'm', 'size', 'cl', 'seed'];
const orderOf = (r: ParamRef) => {
  const part = r.kind === 'rough' ? r.part : r.kind;
  const index = 'index' in r ? r.index : 0;
  return ('prop' in r ? ORDER.indexOf(r.prop) : 99) + (r.kind === 'rough' && r.side === 'bottom' ? 3 : 0) + (part === 'period' ? 100 * (index + 1) : part === 'cavity' ? 1000 * (index + 1) : 0);
};

// What a parameter's sweep and optimization are, in a few words.
function sweepText(x: Exposed, info: ParamInfo, lib: Library) {
  if (info.material) return x.mats.map((id) => lib.get(id)?.name ?? id).join(', ') || '—';
  const s = x.sweep;
  const u = info.unit ? ` ${info.unit}` : '';
  if (s.mode === 'list') return `${sweepValues(x, info).length} values`;
  return s.mode === 'step' ? `${fmt(s.from)}–${fmt(s.to)}${u}, step ${fmt(s.step)}` : `${fmt(s.from)}–${fmt(s.to)}${u}, ${s.count} values`;
}
const optText = (x: Exposed, info: ParamInfo) => (info.material ? `among ${x.mats.length}` : `${fmt(x.opt.min)}–${fmt(x.opt.max)}${info.unit ? ` ${info.unit}` : ''}${info.integer || x.opt.integer ? ', integer' : ''}`);

// The values of a parameter: its sweep (by range and step, by number of values, or a list) and its bounds for the
// optimization; for a material, its candidate materials.
export function ValuesBlock({ x, info, set, sweepOn, setSweepOn }: { x: Exposed; info: ParamInfo; set: (patch: Partial<Exposed>) => void; sweepOn: boolean; setSweepOn: (on: boolean) => void }) {
  const { lib } = useProject();
  const [q, setQ] = useState('');
  const s = x.sweep;
  const setS = (patch: Partial<Exposed['sweep']>) => set({ sweep: { ...s, ...patch } });
  if (info.material) {
    const all = [...lib.values()].filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="values-block">
        <div className="values-box">
          <div className="values-head">
            <Switch checked={sweepOn} onChange={setSweepOn} label="Sweep over the candidates" />
            <Switch checked={x.opt.on} onChange={(on) => set({ opt: { ...x.opt, on } })} label="Optimize among them" />
          </div>
          <input type="text" className="search" placeholder="Search materials" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="cand-list">
            {all.map((m) => (
              <label key={m.id} className="cand">
                <input type="checkbox" checked={x.mats.includes(m.id)} onChange={(e) => set({ mats: e.target.checked ? [...x.mats, m.id] : x.mats.filter((v) => v !== m.id) })} />
                <span className="dot" style={{ background: m.color }} />
                {m.name}
              </label>
            ))}
          </div>
          <div className="muted small">{x.mats.length} candidate{x.mats.length === 1 ? '' : 's'}</div>
        </div>
      </div>
    );
  }
  const values = sweepValues(x, info);
  const u = info.unit;
  return (
    <div className="values-block">
      <div className="values-box">
        <div className="values-head">
          <Switch checked={sweepOn} onChange={setSweepOn} label="Sweep" />
        </div>
        <Segmented<ValueMode>
          value={s.mode}
          onChange={(mode) => setS({ mode })}
          options={[
            { id: 'step', label: 'Range, step' },
            { id: 'count', label: 'Range, count' },
            { id: 'list', label: 'List' },
          ]}
        />
        <div className="grid-fields three">
          {s.mode === 'list' ? (
            <Field label={`Values${u ? ` [${u}]` : ''}`} className="span-all">
              <input type="text" value={s.list} placeholder="40 45 50 55" onChange={(e) => setS({ list: e.target.value })} />
            </Field>
          ) : (
            <>
              <NumberField label="From" unit={u} value={s.from} onChange={(from) => setS({ from })} />
              <NumberField label="To" unit={u} value={s.to} onChange={(to) => setS({ to })} />
              {s.mode === 'step' ? <NumberField label="Step" unit={u} value={s.step} onChange={(step) => step > 0 && setS({ step })} min={0} /> : <NumberField label="Values" value={s.count} onChange={(count) => setS({ count: Math.max(1, Math.round(count)) })} min={1} />}
            </>
          )}
        </div>
        <div className="values-foot">
          <Switch checked={info.integer || s.integer} disabled={info.integer} onChange={(integer) => setS({ integer })} label="Integers only" />
          <span className="muted small" title={values.map(fmt).join(', ')}>
            {values.length} value{values.length === 1 ? '' : 's'}
            {values.length ? `: ${values.slice(0, 3).map(fmt).join(', ')}${values.length > 3 ? ` … ${fmt(values[values.length - 1])}` : ''}` : ''}
          </span>
        </div>
      </div>
      <div className="values-box">
        <div className="values-head">
          <Switch checked={x.opt.on} onChange={(on) => set({ opt: { ...x.opt, on } })} label="Optimize" />
        </div>
        <div className="grid-fields two">
          <NumberField label="Min" unit={u} value={x.opt.min} onChange={(min) => set({ opt: { ...x.opt, min } })} min={info.min} max={info.max} />
          <NumberField label="Max" unit={u} value={x.opt.max} onChange={(max) => set({ opt: { ...x.opt, max } })} min={info.min} max={info.max} />
        </div>
        <div className="values-foot">
          <Switch checked={info.integer || x.opt.integer} disabled={info.integer} onChange={(integer) => set({ opt: { ...x.opt, integer } })} label="Integers only" />
        </div>
      </div>
    </div>
  );
}

// "Add parameter" (or the edit of one): where, what, the values. forOpt: a new one starts optimized, not swept.
export function ParamDialog({ edit, close, forOpt }: { edit?: Exposed; close: () => void; forOpt?: boolean }) {
  const { project, update, lib } = useProject();
  const infos = useParamInfos();
  const s = project.structure;
  const places = placesOf(s, lib, project.colors);
  const taken = new Set(project.params.map((x) => paramKey(x.ref)));
  const [place, setPlace] = useState(() => (edit ? (places.find((p) => p.match(edit.ref))?.key ?? places[0].key) : places[Math.min(1, places.length - 1)].key));
  const whats = [...infos.values()]
    .filter((i) => places.find((p) => p.key === place)?.match(i.ref))
    .map((i) => ({ info: i, label: whatOf(i, s, lib) }))
    .filter((w): w is { info: ParamInfo; label: string } => !!w.label)
    .sort((a, b) => orderOf(a.info.ref) - orderOf(b.info.ref));
  const [key, setKey] = useState<string>(edit ? paramKey(edit.ref) : '');
  const info = infos.get(key) ?? whats.find((w) => !taken.has(paramKey(w.info.ref)))?.info;
  const [draft, setDraft] = useState<Exposed | null>(edit ?? null);
  const [sweepOn, setSweepOn] = useState(edit ? project.sweep.axes.includes(edit.id) : !forOpt);
  const fresh = (i: ParamInfo): Exposed => {
    const d = exposeDefaults(i);
    return forOpt ? { ...d, opt: { ...d.opt, on: true } } : d;
  };
  const x = draft && paramKey(draft.ref) === (info && paramKey(info.ref)) ? draft : info ? fresh(info) : null;
  const pick = (i: ParamInfo) => {
    setKey(paramKey(i.ref));
    setDraft(fresh(i));
  };
  const save = () => {
    if (!x || !info) return;
    const named = { ...x, name: edit ? x.name : `${places.find((p) => p.key === place)?.label.replace(/^\d+\.\s*/, '').replace(/ · .*$/, '') ?? ''} ${whatOf(info, s, lib) ?? ''}`.trim() };
    update((p) => {
      const params = edit ? p.params.map((q) => (q.id === edit.id ? named : q)) : [...p.params, named];
      const has = p.sweep.axes.includes(named.id);
      const axes = sweepOn ? (has ? p.sweep.axes : [...p.sweep.axes, named.id]) : p.sweep.axes.filter((a) => a !== named.id);
      return { ...p, params, sweep: { ...p.sweep, axes } };
    });
    close();
  };
  return (
    <div className="param-dialog">
      <div className="card-head">
        <h3>{edit ? `Edit · ${edit.name}` : 'New parameter'}</h3>
        <span className="spacer" />
        <IconButton icon="x" label="Close" onClick={close} />
      </div>
      {!edit && (
        <div className="pick-cols">
          <div>
            <div className="pick-title">Where</div>
            {places.map((p) => (
              <button key={p.key} type="button" className={`pick${p.key === place ? ' on' : ''}`} onClick={() => setPlace(p.key)}>
                <span className="dot" style={{ background: p.color }} />
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <div className="pick-title">What</div>
            {whats.map((w) => {
              const k = paramKey(w.info.ref);
              const used = taken.has(k);
              return (
                <button key={k} type="button" className={`pick${info && k === paramKey(info.ref) ? ' on' : ''}`} disabled={used} onClick={() => pick(w.info)} title={used ? 'Already a parameter' : undefined}>
                  {w.label}
                  {used && <span className="muted small"> · added</span>}
                </button>
              );
            })}
            {!whats.length && <div className="muted small">Nothing to vary here.</div>}
          </div>
        </div>
      )}
      {x && info && (
        <>
          <div className="pick-title">
            Values · {whatOf(info, s, lib)}, now {typeof info.value === 'string' ? (lib.get(info.value)?.name ?? info.value) : `${fmt(info.value)}${info.unit ? ` ${info.unit}` : ''}`}
          </div>
          <ValuesBlock x={x} info={info} set={(patch) => setDraft({ ...x, ...patch })} sweepOn={sweepOn} setSweepOn={setSweepOn} />
          <div className="dialog-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button type="button" className="primary" onClick={save} disabled={!edit && taken.has(paramKey(info.ref))}>
              {edit ? 'Save' : 'Add'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ParamsPanel() {
  const { project, update, lib } = useProject();
  const infos = useParamInfos();
  const [dialog, setDialog] = useState<{ edit?: Exposed } | null>(null);
  const shown = project.params.filter((x) => x.ref.kind !== 'scan');
  const setX = (id: string, patch: Partial<Exposed>) => update((p) => ({ ...p, params: p.params.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const remove = (id: string) => update((p) => ({ ...p, params: p.params.filter((x) => x.id !== id), sweep: { ...p.sweep, axes: p.sweep.axes.filter((a) => a !== id) } }));
  const setSweep = (id: string, on: boolean) => update((p) => ({ ...p, sweep: { ...p.sweep, axes: on ? (p.sweep.axes.includes(id) ? p.sweep.axes : [...p.sweep.axes, id]) : p.sweep.axes.filter((a) => a !== id) } }));
  const setNow = (x: Exposed, v: number | string) => update((p) => ({ ...p, structure: applyParams(p.structure, p.sim, [[x.ref, v]]).structure }));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Parameters</h2>
        <span className="sub">structural variables: sweep ranges and optimization bounds</span>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => setDialog({})}>+ Add parameter</button>
      </div>
      {dialog && <ParamDialog key={dialog.edit?.id ?? 'new'} edit={dialog.edit} close={() => setDialog(null)} />}
      {!shown.length && !dialog && <p className="muted">No parameters yet: add a thickness, a material, an index, a number of periods… to sweep it or to optimize it.</p>}
      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="data params">
            <thead>
              <tr><th>Parameter</th><th className="num">Now</th><th>Sweep</th><th>Optimize</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const info = infos.get(paramKey(x.ref));
                return (
                  <tr key={x.id} className={info ? '' : 'invalid'}>
                    <td>
                      <input type="text" className="name" aria-label="Parameter name" title={x.name} value={x.name} onChange={(e) => setX(x.id, { name: e.target.value })} />
                      {!info && <div className="err-text small">no longer in the structure</div>}
                    </td>
                    <td className="num">
                      {info &&
                        (info.material ? (
                          <MaterialSelect value={String(info.value)} onChange={(id) => setNow(x, id)} />
                        ) : (
                          <NumberField bare label={`${x.name} now`} unit={info.unit} value={Number(info.value)} onChange={(v) => setNow(x, info.integer ? Math.round(v) : v)} min={info.min} max={info.max} className="short" />
                        ))}
                    </td>
                    <td>{info && <Switch checked={project.sweep.axes.includes(x.id)} onChange={(on) => setSweep(x.id, on)} label={<span className="muted small">{sweepText(x, info, lib)}</span>} />}</td>
                    <td>{info && <Switch checked={x.opt.on} onChange={(on) => setX(x.id, { opt: { ...x.opt, on } })} label={<span className="muted small">{optText(x, info)}</span>} />}</td>
                    <td className="row-actions">
                      {info && <IconButton icon="pencil" label="Edit the values" onClick={() => setDialog({ edit: x })} />}
                      <IconButton icon="x" label="Remove" onClick={() => remove(x.id)} />
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
}

// The tag of a value of the structure that is a parameter: swept, optimized, both (and the candidates of a material).
export function VaryTag({ pref }: { pref: ParamRef }) {
  const { project } = useProject();
  const x = project.params.find((q) => paramKey(q.ref) === paramKey(pref));
  if (!x) return null;
  const swept = project.sweep.axes.includes(x.id);
  const t = [swept && 'swept', x.opt.on && 'optimized'].filter(Boolean).join(' · ') || 'parameter';
  return (
    <span className="tag-var" title={`${x.name}: a parameter (Parameters card)`}>
      {t}
      {pref.kind !== 'scan' && 'prop' in pref && pref.prop === 'mat' && x.mats.length > 1 ? ` · ${x.mats.length}` : ''}
    </span>
  );
}
