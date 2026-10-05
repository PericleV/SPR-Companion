// Project actions of the top bar: name, new, examples, open and save as a JSON file.
import { useRef } from 'react';
import { useProject } from '../state.tsx';
import { EXAMPLES } from '../model/examples.ts';
import { defaultProject, parseProject, stringifyProject } from '../model/project.ts';
import { download } from '../plot/export.ts';

export function ProjectMenu() {
  const { project, update, replace } = useProject();
  const file = useRef<HTMLInputElement>(null);
  const confirmLoss = () => confirm('Replace the current project? (Save it first if you want to keep it.)');
  const open = async (f: File | undefined) => {
    if (!f) return;
    const p = parseProject(await f.text());
    if (!p) alert(`“${f.name}” is not an SPR Companion project.`);
    else if (confirmLoss()) replace(p);
  };
  return (
    <span className="project-menu">
      <input type="text" className="project-name" value={project.name} title={`Project name: ${project.name}`} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} />
      <select
        value=""
        title="Open an example project"
        onChange={(e) => {
          const ex = EXAMPLES[Number(e.target.value)];
          if (ex && confirmLoss()) replace(ex.make());
        }}
      >
        <option value="">Examples…</option>
        {EXAMPLES.map((x, i) => (
          <option key={x.name} value={i} title={x.note}>{x.name}</option>
        ))}
      </select>
      <button onClick={() => confirmLoss() && replace({ ...defaultProject(), name: 'New project', structure: { incident: { id: 'BK7' }, blocks: [], exit: { id: 'Air' } } })}>New</button>
      <button onClick={() => file.current?.click()}>Open…</button>
      <button onClick={() => download(stringifyProject(project, 1), `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.json`, 'application/json')}>Save</button>
      <input ref={file} type="file" accept=".json" hidden onChange={(e) => { open(e.target.files?.[0]); e.target.value = ''; }} />
    </span>
  );
}
