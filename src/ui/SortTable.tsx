// A table whose rows are sorted by any column (click its header: ascending, again: descending, again: the original
// order) — whole rows move together; a horizontal scroll with the first columns kept in view; its data as CSV.
import { useState, type ReactNode } from 'react';
import { exportCsv } from '../plot/export.ts';
import { Icon } from './kit.tsx';

export type SortColumn = { key: string; label: string; title?: string; num?: boolean; sticky?: boolean };
export type SortRow = { key: string; values: (number | string)[]; cells?: ReactNode[]; className?: string; onClick?: () => void };

export function SortTable({ columns, rows, csvName, lead }: { columns: SortColumn[]; rows: SortRow[]; csvName: string; lead?: (row: SortRow) => ReactNode }) {
  // (by the column's key: columns may come and go)
  const [sortBy, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sortCol = sortBy ? columns.findIndex((c) => c.key === sortBy.key) : -1;
  const sort = sortBy && sortCol >= 0 ? { col: sortCol, dir: sortBy.dir } : null;
  const order = rows.map((_, i) => i);
  if (sort) {
    const val = (i: number) => rows[i].values[sort.col];
    order.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      const bad = (v: number | string) => typeof v === 'number' && !Number.isFinite(v);
      if (bad(x) !== bad(y)) return bad(x) ? 1 : -1; // missing values last
      if (typeof x === 'number' && typeof y === 'number') return sort.dir * (x - y);
      return sort.dir * String(x).localeCompare(String(y), undefined, { numeric: true });
    });
  }
  const click = (c: number) => {
    const key = columns[c].key;
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  };
  const csv = () => exportCsv(columns.map((c) => c.label), order.map((i) => rows[i].values), csvName);
  return (
    <div className="sort-table">
      <div className="sort-tools">
        <span className="muted small">Click a column's name to sort by it (↑ smallest first, ↓ largest first, again: the original order).</span>
        <span className="spacer" />
        <button type="button" onClick={csv} title="The table, in the order shown, as CSV">
          <Icon name="download" size={14} />
          CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="list sortable">
          <thead>
            <tr>
              {lead && <th className="sticky lead" />}
              {columns.map((c, k) => (
                <th key={c.key} className={`${c.sticky ? 'sticky' : ''}${sort?.col === k ? ' sorted' : ''}`} title={c.title ?? `sort by ${c.label}`} onClick={() => click(k)}>
                  {c.label}
                  <span className="sort-mark">{sort?.col === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ' ⇅'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((i) => {
              const r = rows[i];
              return (
                <tr key={r.key} className={r.className} onClick={r.onClick}>
                  {lead && <td className="sticky lead">{lead(r)}</td>}
                  {columns.map((c, k) => (
                    <td key={c.key} className={`${c.num ? 'num' : ''}${c.sticky ? ' sticky' : ''}`}>{r.cells?.[k] ?? String(r.values[k])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
