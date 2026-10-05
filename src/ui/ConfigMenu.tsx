// The configuration being edited (top bar): switch to another one, rename it, duplicate it, add a new one, reorder,
// remove. Each configuration is a structure with everything computed on it; the pages show the current one.
import { useState } from 'react';
import { useProject } from '../state.tsx';
import { addConfig, addConfigsFrom, configsOf, moveConfig, removeConfig, renameConfig, switchConfig } from '../model/project.ts';
import { EXAMPLES } from '../model/examples.ts';
import { describe, expand } from '../model/structure.ts';
import { Icon, IconButton, Popover } from './kit.tsx';

export function ConfigMenu() {
  const { project, update, lib, models } = useProject();
  const [open, setOpen] = useState(false);
  const [examples, setExamples] = useState(false);
  const all = configsOf(project);
  const cur = all.find((c) => c.id === project.configId) ?? all[0];
  const summary = (s: (typeof all)[number]) => {
    const ex = expand(s.structure, lib, models);
    const mode = s.sim.mode === 'theta' ? `angular at ${s.sim.lambda} nm` : s.sim.mode === 'lambda' ? `spectral at ${s.sim.theta}°` : 'map λ × θ';
    return `${ex.errors.length ? 'error in the structure' : describe(ex, lib)} · ${mode}`;
  };
  return (
    <span className="popover-anchor config-menu">
      <button type="button" className="config-btn" aria-haspopup="dialog" aria-expanded={open} title="The configuration being edited (structure, interrogation, metrics, plots …)" onClick={() => setOpen(!open)}>
        <span className="config-tag">{all.findIndex((c) => c.id === cur.id) + 1}/{all.length}</span>
        <span className="config-name">{cur.name}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        <div className="config-pick">
          <div className="menu-title">Configurations</div>
          {all.map((c, i) => (
            <div key={c.id} className={`config-row${c.id === cur.id ? ' current' : ''}`}>
              <button
                type="button"
                className="menu-item config-item"
                aria-current={c.id === cur.id}
                onClick={() => {
                  update((p) => switchConfig(p, c.id));
                  setOpen(false);
                }}
              >
                <span className="config-check">{c.id === cur.id && <Icon name="check" size={14} />}</span>
                <span className="config-text">
                  <span>{c.name}</span>
                  <span className="muted small">{summary(c)}</span>
                </span>
              </button>
              <IconButton icon="up" label={`Move “${c.name}” up`} disabled={i === 0} onClick={() => update((p) => moveConfig(p, c.id, -1))} />
              <IconButton icon="down" label={`Move “${c.name}” down`} disabled={i === all.length - 1} onClick={() => update((p) => moveConfig(p, c.id, 1))} />
            </div>
          ))}
          <label className="field config-rename">
            <span className="field-label">Name of the current one</span>
            <input type="text" value={cur.name} onChange={(e) => update((p) => renameConfig(p, p.configId, e.target.value))} />
          </label>
          <div className="config-actions">
            <button type="button" title="A copy of the current configuration, to change" onClick={() => update((p) => addConfig(p, 'copy'))}>
              <Icon name="copy" size={14} />
              Duplicate
            </button>
            <button type="button" title="A new configuration (a default structure)" onClick={() => update((p) => addConfig(p, 'new'))}>
              <Icon name="plus" size={14} />
              New
            </button>
            <button type="button" aria-expanded={examples} title="A new configuration from an example (the rest of the project stays)" onClick={() => setExamples(!examples)}>
              <Icon name="plus" size={14} />
              From an example
            </button>
            <span className="spacer" />
            <button
              type="button"
              disabled={all.length < 2}
              title={all.length < 2 ? 'The only configuration' : 'Remove the current configuration'}
              onClick={() => confirm(`Remove the configuration “${cur.name}” (its structure, metrics, plots …)?`) && update((p) => removeConfig(p, p.configId))}
            >
              <Icon name="trash" size={14} />
              Remove
            </button>
          </div>
          {examples && (
            <div className="config-examples" role="menu" aria-label="Examples">
              <div className="menu-title">Add an example as a configuration</div>
              {EXAMPLES.map((x) => (
                <button
                  key={x.name}
                  type="button"
                  className="menu-item"
                  title={x.note}
                  onClick={() => {
                    update((p) => addConfigsFrom(p, x.make(), x.name));
                    setExamples(false);
                  }}
                >
                  {x.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </Popover>
    </span>
  );
}
