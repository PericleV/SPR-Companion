// A menu of the results of the metrics (by metric, each with its current value): the quantity a goal, a criterion or a
// column is made of.
import { useState } from 'react';
import { Icon, Popover } from './kit.tsx';

export type PickGroup = { id: string; title: string; items: { key: string; label: string; value: string }[] };
export function QuantityPicker({ label, groups, onPick, disabled }: { label: string; groups: PickGroup[]; onPick: (metric: string, key: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="popover-anchor">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={14} />
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        {groups.map((g) => (
          <div key={g.id} className="menu-group">
            <div className="menu-title">{g.title}</div>
            {g.items.map((i) => (
              <button
                key={i.key}
                type="button"
                className="menu-item"
                onClick={() => {
                  onPick(g.id, i.key);
                  setOpen(false);
                }}
              >
                <span className="menu-label">{i.label}</span>
                <span className="menu-value">{i.value}</span>
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <div className="muted small menu-empty">No metric switched on: add metrics on the Simulation page.</div>}
      </Popover>
    </span>
  );
}
