// What a plot draws over its curves: all overlays on or off, each metric on or off, and each of its parts (the region,
// the position, the value, the width, the fit …) on or off.
import { useState } from 'react';
import { isHidden, overlayKey, PART_LABEL, type OverlayPart } from './metricOverlays.ts';
import { Icon, Popover, Switch } from './kit.tsx';

export type OverlayEntry = { id: string; label: string; color: string; parts: OverlayPart[] };

export function OverlayPicker({ entries, on, setOn, hidden = [], setHidden }: { entries: OverlayEntry[]; on: boolean; setOn: (v: boolean) => void; hidden?: string[]; setHidden: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const shown = on ? entries.filter((e) => !isHidden(hidden, e.id)).length : 0;
  const toggle = (key: string, show: boolean) => setHidden(show ? hidden.filter((k) => k !== key) : [...hidden.filter((k) => k !== key), key]);
  return (
    <span className="popover-anchor">
      <button type="button" className="overlay-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!entries.length} title={entries.length ? 'Choose what is drawn over the curves' : 'No metric on this plot'}>
        {!entries.length ? 'None' : !on ? 'Hidden' : `${shown} of ${entries.length}`}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="overlay-pick">
          <Switch checked={on} onChange={setOn} label={<b>Show overlays</b>} />
          {entries.map((e) => {
            const metricOn = !isHidden(hidden, e.id);
            return (
              <div key={e.id} className={`overlay-row${on && metricOn ? '' : ' off'}`}>
                <Switch checked={metricOn} disabled={!on} onChange={(v) => toggle(e.id, v)} label={<><span className="dot" style={{ background: e.color }} /> {e.label}</>} />
                {e.parts.length > 1 && (
                  <div className="overlay-parts">
                    {e.parts.map((p) => {
                      const partOn = !hidden.includes(overlayKey(e.id, p));
                      return (
                        <button key={p} type="button" className={`part${partOn ? ' on' : ''}`} aria-pressed={partOn} disabled={!on || !metricOn} onClick={() => toggle(overlayKey(e.id, p), !partOn)}>
                          {PART_LABEL[p]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}
