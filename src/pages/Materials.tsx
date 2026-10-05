// Materials page: the library and the user's materials, their n, k (or ε) over a wavelength range, the editor.
import { useMemo, useRef, useState } from 'react';
import { useProject } from '../state.tsx';
import { groupOf, MATERIAL_GROUPS, USER_GROUP } from '../physics/library.ts';
import { refractiveIndex, validRange, type MaterialDef } from '../physics/materials.ts';
import { describeModel, MODEL_LABEL, newMaterialId, structureMaterials, usesOf } from '../model/materials.ts';
import { linspace } from '../model/compute.ts';
import { NumberField } from '../ui/NumberField.tsx';
import { AutoWidth } from '../ui/AutoWidth.tsx';
import { LinePlot, type Series } from '../plot/LinePlot.tsx';
import { FigureTools } from '../plot/FigureTools.tsx';
import { exportCsv } from '../plot/export.ts';
import { seriesColor } from '../plot/colors.ts';
import { MaterialEditor } from './MaterialEditor.tsx';

type Quantity = 'nk' | 'eps';

export function Materials() {
  const { project, update, lib, models } = useProject();
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<string[]>(() => structureMaterials(project.structure).filter((id) => lib.has(id)).slice(0, 4));
  const [focus, setFocus] = useState<string>(() => checked[0] ?? 'Ag');
  const [range, setRange] = useState<[number, number]>([400, 1000]);
  const [q, setQ] = useState<Quantity>('nk');
  const [editing, setEditing] = useState<{ def: MaterialDef | null } | null>(null);
  const figure = useRef<HTMLDivElement>(null);

  const all = [...lib.values()];
  const match = (m: MaterialDef) => !query.trim() || `${m.name} ${m.id} ${m.source ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
  const groups = [...MATERIAL_GROUPS, USER_GROUP].map((g) => ({ g, items: all.filter((m) => groupOf(m) === g && match(m)) })).filter((x) => x.items.length);
  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const curves = useMemo(() => {
    const xs = linspace(range[0], range[1], 400);
    return checked
      .filter((id) => lib.has(id))
      .map((id) => {
        const nk = xs.map((l) => refractiveIndex(id, models, l));
        const a = q === 'nk' ? nk.map((z) => z.re) : nk.map((z) => z.re * z.re - z.im * z.im);
        const b = q === 'nk' ? nk.map((z) => z.im) : nk.map((z) => 2 * z.re * z.im);
        return { id, def: lib.get(id)!, a, b };
      })
      .map((c) => ({ ...c, xs }));
  }, [checked, lib, models, range, q]);
  const xs = curves[0]?.xs ?? linspace(range[0], range[1], 400);
  const [la, lb] = q === 'nk' ? ['n', 'k'] : ['ε₁', 'ε₂'];
  // plot colours from the series palette (the library colours are for drawings, often pale)
  const colorOf = (i: number) => (curves.length === 1 ? 'var(--line)' : seriesColor(i, curves.length));
  const series: Series[] = curves.flatMap((c, i) => [
    { key: `${c.id}:a`, label: `${la} ${c.def.name}`, color: colorOf(i), y: c.a },
    { key: `${c.id}:b`, label: `${lb} ${c.def.name}`, color: colorOf(i), y: c.b, dash: '6 4' },
  ]);

  const f = lib.get(focus);
  const remove = (def: MaterialDef) => {
    const uses = usesOf(project, def.id);
    if (uses.length) {
      alert(`“${def.name}” is used by ${uses.join(', ')}: replace it there first.`);
      return;
    }
    update((p) => ({ ...p, materials: p.materials.filter((m) => m.id !== def.id) }));
    setChecked((c) => c.filter((x) => x !== def.id));
    setFocus('Ag');
  };
  const duplicate = (def: MaterialDef) => {
    const copy: MaterialDef = { id: newMaterialId(def.name), name: `${def.name} (copy)`, color: def.color, model: structuredClone(def.model), ...(def.range ? { range: def.range } : {}), ...(def.monolayer ? { monolayer: def.monolayer } : {}) };
    update((p) => ({ ...p, materials: [...p.materials, copy] }));
    setFocus(copy.id);
    setEditing({ def: copy });
  };
  const csv = () => {
    const head = ['lambda_nm', ...curves.flatMap((c) => [`${la}_${c.def.name}`, `${lb}_${c.def.name}`])];
    exportCsv(head, xs.map((x, i) => [x, ...curves.flatMap((c) => [c.a[i], c.b[i]])]), `materials ${q}`);
  };

  return (
    <div className="materials">
      <section className="card lib">
        <div className="card-head">
          <h2>Library</h2>
          <button className="primary" onClick={() => setEditing({ def: null })}>New material</button>
        </div>
        <input type="text" className="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="lib-list">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <h3>{g}</h3>
              {items.map((m) => (
                <div key={m.id} className={`lib-item${m.id === focus ? ' focus' : ''}`} onClick={() => setFocus(m.id)}>
                  <input type="checkbox" title="Show on the plot" checked={checked.includes(m.id)} onChange={() => toggle(m.id)} onClick={(e) => e.stopPropagation()} />
                  <span>{m.name}</span>
                  {m.monolayer ? <span className="tag">2D</span> : null}
                  {m.model.type === 'ema' ? <span className="tag">porous</span> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="mat-main">
        {editing ? (
          <MaterialEditor
            key={editing.def?.id ?? 'new'}
            def={editing.def}
            onDone={(saved) => {
              setEditing(null);
              if (saved) {
                setFocus(saved.id);
                setChecked((c) => (c.includes(saved.id) ? c : [...c, saved.id]));
              }
            }}
          />
        ) : (
          f && (
            <section className="card">
              <div className="card-head">
                <h2>
                  {f.name}
                </h2>
                <span className="muted">{groupOf(f)}</span>
                <span className="spacer" />
                {f.builtin ? (
                  <button onClick={() => duplicate(f)}>Copy to my materials (to edit)</button>
                ) : (
                  <>
                    <button onClick={() => setEditing({ def: f })}>Edit</button>
                    <button onClick={() => duplicate(f)}>Duplicate</button>
                    <button onClick={() => remove(f)}>Delete</button>
                  </>
                )}
              </div>
              <table className="kv">
                <tbody>
                  <tr><th>Model</th><td>{MODEL_LABEL[f.model.type]}: {describeModel(f.model, lib)}</td></tr>
                  <tr><th>Valid range</th><td>{(() => { const r = validRange(f.id, lib); return Number.isFinite(r[1]) ? `${+r[0].toFixed(1)}–${+r[1].toFixed(1)} nm` : 'any wavelength'; })()}</td></tr>
                  {f.monolayer ? <tr><th>2D material</th><td>monolayer {f.monolayer} nm (layers in the structure are counted in monolayers)</td></tr> : null}
                  <tr><th>Index at 633 nm</th><td>{(() => { const z = refractiveIndex(f.id, models, 633); return `n = ${z.re.toFixed(5)}, k = ${z.im.toFixed(5)}`; })()}</td></tr>
                  {f.source ? <tr><th>Source</th><td className="small">{f.source}</td></tr> : null}
                </tbody>
              </table>
            </section>
          )
        )}

        <section className="card">
          <div className="card-head">
            <h2>Optical constants</h2>
            <FigureTools target={figure} name={`materials ${q}`} csv={curves.length ? csv : undefined} />
          </div>
          <div className="form-row">
            <label>
              Quantity
              <select value={q} onChange={(e) => setQ(e.target.value as Quantity)}>
                <option value="nk">n (solid), k (dashed)</option>
                <option value="eps">ε₁ (solid), ε₂ (dashed)</option>
              </select>
            </label>
            <NumberField label="from [nm]" value={range[0]} onChange={(v) => v < range[1] && setRange([v, range[1]])} min={1} />
            <NumberField label="to [nm]" value={range[1]} onChange={(v) => v > range[0] && setRange([range[0], v])} min={1} />
          </div>
          {curves.length ? (
            <AutoWidth figure={figure}>{(w) => <LinePlot xAxis={{ id: 'lambda', label: 'λ', unit: 'nm', values: xs }} series={series} yLabel={q === 'nk' ? 'n, k' : 'ε'} yUnit="" width={w} height={340} />}</AutoWidth>
          ) : (
            <p className="muted">Tick materials in the library to compare them.</p>
          )}
          <div className="legend">
            {curves.map((c, i) => (
              <span key={c.id}>
                <span className="line-key" style={{ background: colorOf(i) }} /> {c.def.name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
