import { useProject } from '../state.tsx';
import { groupOf, MATERIAL_GROUPS, USER_GROUP } from '../physics/library.ts';

// A material of the library, grouped by section; an unknown id stays selectable (shown as missing).
export function MaterialSelect({ value, onChange, title }: { value: string; onChange: (id: string) => void; title?: string }) {
  const { lib } = useProject();
  const all = [...lib.values()];
  const groups = [...MATERIAL_GROUPS, USER_GROUP].map((g) => ({ g, items: all.filter((m) => groupOf(m) === g) })).filter((x) => x.items.length);
  return (
    <select value={value} title={title} onChange={(e) => onChange(e.target.value)} className={lib.has(value) ? '' : 'bad'}>
      {!lib.has(value) && <option value={value}>{value} (missing)</option>}
      {groups.map(({ g, items }) => (
        <optgroup key={g} label={g}>
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
