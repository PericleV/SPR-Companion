// Cards ("islands") the user can rearrange: each has a grip on its left edge; dragging it moves the card within its
// column or to another column, the other cards slide out of the way (animated), and the arrangement is remembered
// (per board, in this browser). The grip also moves its card with the arrow keys.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

// fixed: stays where it is put (no grip), e.g. an "add" button between cards
export type BoardItem = { key: string; col: string; node: ReactNode; label: string; fixed?: boolean };
type Layout = Record<string, string[]>;

const storeKey = (id: string) => `spr-companion:board:${id}`;
function loadLayout(id: string): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(id)) ?? '{}');
    return v && typeof v === 'object' ? (v as Layout) : {};
  } catch {
    return {};
  }
}
function saveLayout(id: string, l: Layout) {
  try {
    localStorage.setItem(storeKey(id), JSON.stringify(l));
  } catch {
    /* (not remembered) */
  }
}

// The stored arrangement applied to the items present: unknown keys go to their own column, after the item that
// precedes them in the natural order.
function arrange(items: BoardItem[], cols: string[], stored: Layout): Layout {
  const keys = new Set(items.map((i) => i.key));
  const out: Layout = Object.fromEntries(cols.map((c) => [c, (stored[c] ?? []).filter((k) => keys.has(k))]));
  const placed = new Set(Object.values(out).flat());
  items.forEach((it, n) => {
    if (placed.has(it.key)) return;
    const col = out[it.col] ? it.col : cols[0];
    const list = out[col];
    let at = 0;
    for (let k = n - 1; k >= 0; k--) {
      const j = list.indexOf(items[k].key);
      if (j >= 0) {
        at = j + 1;
        break;
      }
    }
    list.splice(at, 0, it.key);
    placed.add(it.key);
  });
  return out;
}

export function Board({ id, columns, items, className = '' }: { id: string; columns: { id: string; className?: string }[]; items: BoardItem[]; className?: string }) {
  const cols = columns.map((c) => c.id);
  const [stored, setStored] = useState<Layout>(() => loadLayout(id));
  const layout = arrange(items, cols, stored);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const els = useRef(new Map<string, HTMLDivElement>());
  const colEls = useRef(new Map<string, HTMLDivElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const drag = useRef<{ key: string; grabX: number; grabY: number; tx: number; ty: number; pointer: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const pending = useRef<{ col: string; index: number } | null>(null);

  // the other cards slide from where they were (FLIP)
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (!prev) return;
    els.current.forEach((el, key) => {
      if (key === drag.current?.key) return;
      const a = prev.get(key);
      if (!a) return;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) > 0.5 && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
  });

  const move = (next: Layout, persist: boolean) => {
    before.current = new Map([...els.current].map(([k, el]) => [k, el.getBoundingClientRect()]));
    setStored(next);
    if (persist) saveLayout(id, next);
  };
  const place = (key: string, col: string, index: number, persist: boolean) => {
    const next: Layout = Object.fromEntries(cols.map((c) => [c, layout[c].filter((k) => k !== key)]));
    next[col].splice(Math.max(0, Math.min(index, next[col].length)), 0, key);
    if (cols.every((c) => next[c].join() === layout[c].join())) return;
    move(next, persist);
  };
  const where = (key: string) => {
    const col = cols.find((c) => layout[c].includes(key))!;
    return { col, index: layout[col].indexOf(key) };
  };

  // the dragged card follows the pointer; where it would land is recomputed as it moves
  const follow = (el: HTMLDivElement, x: number, y: number) => {
    const d = drag.current!;
    const r = el.getBoundingClientRect();
    const naturalLeft = r.left - d.tx;
    const naturalTop = r.top - d.ty;
    d.tx = x - d.grabX - naturalLeft;
    d.ty = y - d.grabY - naturalTop;
    el.style.transform = `translate(${d.tx}px, ${d.ty}px)`;
  };
  const onDown = (key: string) => (e: PointerEvent<HTMLButtonElement>) => {
    const el = els.current.get(key);
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag.current = { key, grabX: e.clientX - r.left, grabY: e.clientY - r.top, tx: 0, ty: 0, pointer: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (no capture: the moves still reach the grip while the pointer is over it) */
    }
    setDragging(key);
  };
  const onMove = (key: string) => (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const el = els.current.get(key);
    if (!d || d.key !== key || !el) return;
    follow(el, e.clientX, e.clientY);
    // the column under the pointer (or the nearest), the place among its other cards
    let col = cols[0];
    let best = Infinity;
    for (const c of cols) {
      const cr = colEls.current.get(c)?.getBoundingClientRect();
      if (!cr) continue;
      const dist = e.clientX < cr.left ? cr.left - e.clientX : e.clientX > cr.right ? e.clientX - cr.right : 0;
      if (dist < best) {
        best = dist;
        col = c;
      }
    }
    const others = layout[col].filter((k) => k !== key);
    const index = others.filter((k) => {
      const r = els.current.get(k)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 < e.clientY : false;
    }).length;
    const now = where(key);
    // (another column: on drop — moving the card there now would remount it and lose the pointer)
    if (now.col !== col) {
      pending.current = { col, index };
      setTarget(col);
    } else {
      pending.current = null;
      setTarget(null);
      if (now.index !== index) {
        place(key, col, index, false);
        requestAnimationFrame(() => drag.current && follow(el, e.clientX, e.clientY));
      }
    }
  };
  const onUp = (key: string) => () => {
    const el = els.current.get(key);
    if (!drag.current || drag.current.key !== key) return;
    const p = pending.current;
    pending.current = null;
    // every card glides from where it is now (the dragged one from under the pointer) to its place
    before.current = new Map([...els.current].map(([k, x]) => [k, x.getBoundingClientRect()]));
    drag.current = null;
    if (el) el.style.transform = '';
    setDragging(null);
    setTarget(null);
    if (p) {
      const next: Layout = Object.fromEntries(cols.map((c) => [c, layout[c].filter((k) => k !== key)]));
      next[p.col].splice(Math.max(0, Math.min(p.index, next[p.col].length)), 0, key);
      setStored(next);
      saveLayout(id, next);
    } else saveLayout(id, layout);
  };
  const onKey = (key: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const { col, index } = where(key);
    const ci = cols.indexOf(col);
    if (e.key === 'ArrowUp') place(key, col, index - 1, true);
    else if (e.key === 'ArrowDown') place(key, col, index + 1, true);
    else if (e.key === 'ArrowLeft' && ci > 0) place(key, cols[ci - 1], layout[cols[ci - 1]].length, true);
    else if (e.key === 'ArrowRight' && ci < cols.length - 1) place(key, cols[ci + 1], layout[cols[ci + 1]].length, true);
    else return;
    e.preventDefault();
    requestAnimationFrame(() => els.current.get(key)?.querySelector<HTMLButtonElement>('.grip')?.focus());
  };

  return (
    <div className={`board ${className}${dragging ? ' is-dragging' : ''}`}>
      {columns.map((c) => (
        <div
          key={c.id}
          className={`board-col ${c.className ?? ''}${target === c.id ? ' drop-target' : ''}`}
          ref={(el) => {
            if (el) colEls.current.set(c.id, el);
            else colEls.current.delete(c.id);
          }}
        >
          {layout[c.id].map((k) => {
            const it = byKey.get(k)!;
            return (
              <div
                key={k}
                className={`island${dragging === k ? ' dragging' : ''}`}
                ref={(el) => {
                  if (el) els.current.set(k, el);
                  else els.current.delete(k);
                }}
              >
                {!it.fixed && (<button
                  type="button"
                  className="grip"
                  aria-label={`Move “${it.label}” (drag, or the arrow keys)`}
                  title="Drag to move this card"
                  onPointerDown={onDown(k)}
                  onPointerMove={onMove(k)}
                  onPointerUp={onUp(k)}
                  onPointerCancel={onUp(k)}
                  onKeyDown={onKey(k)}
                >
                  <svg width="8" height="16" viewBox="0 0 8 16" aria-hidden="true">
                    {[2, 6].map((x) => [3, 8, 13].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
                  </svg>
                </button>)}
                {it.node}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
