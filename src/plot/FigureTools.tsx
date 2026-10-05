import type { RefObject } from 'react';
import { exportPng, exportSvg } from './export.ts';

// Export buttons for a figure container; `csv` is omitted for figures without tabular data.
export function FigureTools({ target, name, csv }: { target: RefObject<HTMLElement | null>; name: string; csv?: () => void }) {
  const file = name.replace(/[^\w.-]+/g, '_') || 'figure';
  return (
    <span className="fig-tools">
      <button className="nodrag" title="Export as SVG" onClick={() => target.current && exportSvg(target.current, file)}>SVG</button>
      <button className="nodrag" title="Export as PNG (3×)" onClick={() => target.current && exportPng(target.current, file)}>PNG</button>
      {csv && <button className="nodrag" title="Export the plotted data as CSV" onClick={csv}>CSV</button>}
    </span>
  );
}
