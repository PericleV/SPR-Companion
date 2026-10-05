// The few building blocks every page uses, so that the controls look and line up the same everywhere: a labelled
// field, an on/off switch, a segmented choice, icon buttons, chips with an "add" menu, an expandable panel.
import { useEffect, useRef, useState, type ReactNode } from 'react';

// A control with its label above it (every control of a row lines up: the label row is always there).
export function Field({ label, children, className = '', title }: { label?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <label className={`field ${className}`} title={title}>
      <span className="field-label">{label ?? ' '}</span>
      {children}
    </label>
  );
}

// An on/off setting.
export function Switch({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className={`switch${disabled ? ' disabled' : ''}`} title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      {label !== undefined && <span className="switch-label">{label}</span>}
    </label>
  );
}

// One of a few short options.
export function Segmented<T extends string>({ value, options, onChange, title }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; title?: string }) {
  return (
    <span className="segmented" role="radiogroup" title={title}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

// Line icons (24×24, stroke).
const PATHS: Record<string, string> = {
  x: 'M18 6 6 18M6 6l12 12',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V20h-3v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2-2 .1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H4v-3h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-2 .1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V4h3v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H20v3h-.1a1.7 1.7 0 0 0-1.5 1z',
  check: 'M5 12l5 5L20 7',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  play: 'M7 5v14l11-7z',
  draw: 'M4 20l4-1 10-10-3-3L5 16zM14 7l3 3',
  wave: 'M2 12c2.5-5 4.5-5 7 0s4.5 5 7 0 4.5-5 6-2',
};
export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

// A square button with an icon (its label for the tooltip and screen readers).
export function IconButton({ icon, label, onClick, disabled, active }: { icon: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`icon-btn${active ? ' active' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

// A menu that opens over the page (closed by a click outside or Escape).
export function Popover({ open, onClose, children, align = 'left' }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`popover ${align}`} role="menu">
      {children}
    </div>
  );
}

// Chips of the chosen items, each removable (and with an optional toggle), and an "Add" menu of the others.
export function Chips({ items, all, onAdd, onRemove, toggle, addLabel = 'Add' }: {
  items: { key: string; label: string; flag?: boolean }[];
  all: { key: string; label: string }[];
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  toggle?: { label: (flag: boolean) => string; title: string; set: (key: string, v: boolean) => void };
  addLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rest = all.filter((a) => !items.some((i) => i.key === a.key));
  return (
    <span className="chips">
      {items.map((i) => (
        <span key={i.key} className={`chip${i.flag ? ' flagged' : ''}`}>
          {i.label}
          {toggle && (
            <button type="button" className={`chip-flag${i.flag ? ' on' : ''}`} title={toggle.title} onClick={() => toggle.set(i.key, !i.flag)}>
              {toggle.label(!!i.flag)}
            </button>
          )}
          <button type="button" className="chip-x" aria-label={`Remove ${i.label}`} title="Remove" onClick={() => onRemove(i.key)}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <span className="popover-anchor">
        <button type="button" className="chip add" onClick={() => setOpen(!open)} disabled={!rest.length}>
          <Icon name="plus" size={12} />
          {addLabel}
        </button>
        <Popover open={open} onClose={() => setOpen(false)}>
          {rest.map((a) => (
            <button
              key={a.key}
              type="button"
              className="menu-item"
              onClick={() => {
                onAdd(a.key);
                setOpen(false);
              }}
            >
              {a.label}
            </button>
          ))}
        </Popover>
      </span>
    </span>
  );
}

// A button that opens a menu of choices (instead of a select with a "choose…" placeholder).
export function MenuButton({ label, items, onPick, disabled, title, align = 'left', primary }: {
  label: ReactNode;
  items: { key: string; label: ReactNode; hint?: string }[];
  onPick: (key: string) => void;
  disabled?: boolean;
  title?: string;
  align?: 'left' | 'right';
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="popover-anchor">
      <button type="button" className={primary ? 'primary' : ''} disabled={disabled || !items.length} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={14} />
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align={align}>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            className="menu-item"
            title={i.hint}
            onClick={() => {
              onPick(i.key);
              setOpen(false);
            }}
          >
            {i.label}
          </button>
        ))}
      </Popover>
    </span>
  );
}

// A row that expands (its summary always shown, its body when open).
export function Expander({ open, onToggle, summary, children, className = '' }: { open: boolean; onToggle: () => void; summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`expander${open ? ' open' : ''} ${className}`}>
      <div className="expander-head">
        {summary}
        <IconButton icon={open ? 'chevronUp' : 'chevronDown'} label={open ? 'Collapse' : 'Expand'} onClick={onToggle} />
      </div>
      {open && <div className="expander-body">{children}</div>}
    </div>
  );
}
