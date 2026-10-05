import { useId, useMemo, useState, type MouseEvent } from 'react';
import { axisTitle, axisValueText } from '../engine/dataset.ts';
import type { Axis } from '../engine/types.ts';
import type { Overlay } from './overlays.ts';
import { applyLim, axisTicks, nearest, niceTicks } from './scale.ts';

export type Series = {
  key: string;
  label: string;
  color: string;
  y: ArrayLike<number>;
  x?: ArrayLike<number>; // defaults to the x axis values
  dash?: string;
  width?: number;
  dots?: boolean; // mark the samples (sparse data)
  noLine?: boolean; // the samples only (e.g. x taken from a quantity: points in any order)
};

type Props = {
  xAxis: Axis; // label, unit, ticks (and the default x values)
  series: Series[];
  yLabel: string;
  yUnit: string;
  yDomain?: [number, number]; // omitted = auto
  xLim?: [number, number]; // manual limits (NaN bound = automatic)
  yLim?: [number, number];
  width?: number;
  height?: number;
  overlays?: Overlay[]; // analysis marks (extrema, widths, perturbed curves, intervals)
  // a second Y axis on the right (e.g. the phases next to R): its series, label, unit, domain and limits
  series2?: Series[];
  y2Label?: string;
  y2Unit?: string;
  y2Domain?: [number, number];
  y2Lim?: [number, number];
  onSelect?: (lo: number, hi: number) => void; // a drag selects an interval of X (instead of zooming)
  onPick?: (key: string, i: number) => void; // a click on a sample (within 14 px): its series and index
};

const M0 = { l: 54, r: 12, t: 10, b: 38 };

// Index of the finite value nearest to v, for values in any order.
function nearestAny(xs: ArrayLike<number>, v: number): number {
  let k = 0;
  let best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - v);
    if (d < best) [best, k] = [d, i];
  }
  return k;
}

function extentOf(series: Series[], xs: ArrayLike<number>, x0: number, x1: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const sx = s.x ?? xs;
    for (let i = 0; i < s.y.length; i++) {
      const y = s.y[i];
      if (sx[i] < x0 || sx[i] > x1 || !Number.isFinite(y)) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-12) return [lo - 0.5, hi + 0.5];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

// SVG line chart. Drag horizontally to zoom, double-click to reset; hover shows the nearest curve.
export function LinePlot({ xAxis, series, yLabel, yUnit, yDomain, xLim, yLim, width = 520, height = 290, overlays = [], series2 = [], y2Label = '', y2Unit = '', y2Domain, y2Lim, onSelect, onPick }: Props) {
  const right = series2.length > 0;
  const M = { ...M0, r: right ? 60 : M0.r };
  const xs = xAxis.values;
  const pw = width - M.l - M.r;
  const ph = height - M.t - M.b;
  const clip = useId();
  const [zoomed, setZoomed] = useState<{ axis: string; range: [number, number] } | null>(null);
  const zoom = zoomed?.axis === xAxis.id ? zoomed.range : null; // a zoom applies to the axis it was made on
  const setZoom = (range: [number, number] | null) => setZoomed(range && { axis: xAxis.id, range });
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);

  const auto = useMemo((): [number, number] => {
    if (xAxis.labels) return [-0.25, xs.length - 0.75];
    let lo = Infinity;
    let hi = -Infinity;
    for (const sx of series.length + series2.length ? [...series, ...series2].map((s) => s.x ?? xs) : [xs]) {
      for (let i = 0; i < sx.length; i++) {
        if (!Number.isFinite(sx[i])) continue;
        lo = Math.min(lo, sx[i]);
        hi = Math.max(hi, sx[i]);
      }
    }
    return Number.isFinite(lo) && hi > lo ? [lo, hi] : [lo - 1, lo + 1];
  }, [xAxis.labels, xs, series, series2]);
  const full = xAxis.labels ? auto : applyLim(auto, xLim);
  const [x0, x1] = zoom ?? full;
  const extra = useMemo(
    () =>
      overlays.flatMap((o): Series[] =>
        o.kind === 'curve'
          ? [{ key: o.key, label: o.top ? 'top' : '', color: o.color, x: o.x, y: o.y, dash: o.dash ?? (o.solid ? undefined : '6 4'), width: o.width }]
          : o.kind === 'area'
            ? [{ key: `${o.key}:lo`, label: '', color: 'none', x: o.x, y: o.lo }, { key: `${o.key}:hi`, label: '', color: 'none', x: o.x, y: o.hi }]
            : [],
      ),
    [overlays],
  );
  const yAuto = useMemo(() => yDomain ?? extentOf([...series, ...extra], xs, x0, x1), [yDomain, series, extra, xs, x0, x1]);
  const [y0, y1] = applyLim(yAuto, yLim);
  const y2Auto = useMemo(() => (right ? (y2Domain ?? extentOf(series2, xs, x0, x1)) : ([0, 1] as [number, number])), [right, y2Domain, series2, xs, x0, x1]);
  const [v0, v1] = applyLim(y2Auto, y2Lim);
  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * pw;
  const sy = (v: number) => M.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const sy2 = (v: number) => M.t + ph - ((v - v0) / (v1 - v0 || 1)) * ph;
  const invX = (px: number) => x0 + ((px - M.l) / pw) * (x1 - x0);

  const pathOf = (s: Series, syf = sy) => {
    const px = s.x ?? xs;
    let d = '';
    let pen = false;
    for (let i = 0; i < s.y.length; i++) {
      const y = s.y[i];
      if (!Number.isFinite(y) || !Number.isFinite(px[i])) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(px[i]).toFixed(1)},${syf(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };


  // Pointer position in SVG units (the flow canvas may be zoomed).
  const point = (e: MouseEvent<SVGRectElement>): [number, number] => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return [((e.clientX - r.left) * width) / r.width, ((e.clientY - r.top) * height) / r.height];
  };

  let tip: { x: number; y: number; lines: string[]; color: string } | null = null;
  if (hover && !drag && series.length + series2.length) {
    const xv = invX(hover[0]);
    let best: { s: Series; i: number; dist: number; second: boolean } | null = null;
    for (const [list, second] of [[series, false], [series2, true]] as const)
      for (const s of list) {
        const px = s.x ?? xs;
        // x of a series may be in any order (a quantity as x): the nearest point by a scan
        const i = s.x ? nearestAny(px, xv) : nearest(px, xv);
        const y = s.y[i];
        if (!Number.isFinite(y)) continue;
        const dist = Math.abs((second ? sy2 : sy)(y) - hover[1]) + Math.abs(sx(px[i]) - hover[0]);
        if (!best || dist < best.dist) best = { s, i, dist, second };
      }
    if (best) {
      const px = best.s.x ?? xs;
      const y = best.s.y[best.i];
      const xText = best.s.x ? `${+px[best.i].toPrecision(6)}${xAxis.unit === '°' ? '°' : ` ${xAxis.unit}`}` : axisValueText(xAxis, best.i);
      const [lab, unit] = best.second ? [y2Label, y2Unit] : [yLabel, yUnit];
      tip = {
        x: sx(px[best.i]),
        y: (best.second ? sy2 : sy)(y),
        color: best.s.color,
        lines: [`${xAxis.label} = ${xText}`, `${best.s.label || lab} = ${+y.toPrecision(6)}${unit ? ` ${unit}` : ''}`],
      };
    }
  }

  // Values of the analysis marks, listed in a box instead of next to marks that may overlap.
  const notes = overlays.filter((o): o is Extract<Overlay, { text?: string }> & { text: string } => 'text' in o && !!o.text);
  const notesW = Math.max(0, ...notes.map((o) => o.text.length * 6.7 + 22));

  const xt = axisTicks(xAxis, x0, x1);
  const yt = niceTicks(y0, y1, 5);
  const tipW = Math.max(150, ...(tip?.lines.map((l) => l.length * 6.4 + 12) ?? [0]));

  return (
    <svg width={width} height={height} className="plot" onDoubleClick={() => setZoom(null)}>
      <defs>
        <clipPath id={clip}>
          <rect x={M.l} y={M.t} width={pw} height={ph} />
        </clipPath>
      </defs>
      {yt.map((t) => (
        <g key={`y${t.v}`}>
          <line x1={M.l} x2={M.l + pw} y1={sy(t.v)} y2={sy(t.v)} className="grid" />
          <text x={M.l - 6} y={sy(t.v)} className="tick" textAnchor="end" dominantBaseline="middle">{t.text}</text>
        </g>
      ))}
      {xt.map((t) => (
        <g key={`x${t.v}`}>
          <line x1={sx(t.v)} x2={sx(t.v)} y1={M.t} y2={M.t + ph} className="grid" />
          <text x={sx(t.v)} y={M.t + ph + 14} className="tick" textAnchor="middle">{t.text}</text>
        </g>
      ))}
      <rect x={M.l} y={M.t} width={pw} height={ph} className="frame" />
      <text x={M.l + pw / 2} y={height - 4} className="axis-title" textAnchor="middle">{axisTitle(xAxis)}</text>
      <text transform={`translate(12 ${M.t + ph / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">
        {yUnit ? `${yLabel} [${yUnit}]` : yLabel}
      </text>
      {right &&
        niceTicks(v0, v1, 5).map((t) => (
          <g key={`y2${t.v}`}>
            <line x1={M.l + pw} x2={M.l + pw + 4} y1={sy2(t.v)} y2={sy2(t.v)} className="axis-line" />
            <text x={M.l + pw + 6} y={sy2(t.v)} className="tick" dominantBaseline="middle">{t.text}</text>
          </g>
        ))}
      {right && (
        <text transform={`translate(${width - 8} ${M.t + ph / 2}) rotate(90)`} className="axis-title" textAnchor="middle">
          {y2Unit ? `${y2Label} [${y2Unit}]` : y2Label}
        </text>
      )}

      <g clipPath={`url(#${clip})`}>
        {overlays.map((o) => {
          if (o.kind !== 'band') return null;
          const a = sx(Math.max(o.lo, x0));
          const b = sx(Math.min(o.hi, x1));
          if (!(b > a)) return null;
          const fits = o.label && (b - a) > o.label.length * 6.6 + 6;
          return (
            <g key={o.key}>
              <rect x={a} y={M.t} width={b - a} height={ph} fill={o.color} opacity={0.28} />
              {fits && (
                <text x={(a + b) / 2} y={M.t + 12} textAnchor="middle" className="band-label">
                  {o.label}
                </text>
              )}
            </g>
          );
        })}
        {overlays.map((o) => {
          if (o.kind !== 'area') return null;
          const up: string[] = [];
          const down: string[] = [];
          for (let i = 0; i < o.x.length; i++) {
            if (!Number.isFinite(o.lo[i]) || !Number.isFinite(o.hi[i])) continue;
            up.push(`${sx(o.x[i])},${sy(o.hi[i])}`);
            down.push(`${sx(o.x[i])},${sy(o.lo[i])}`);
          }
          return up.length > 1 ? <polygon key={o.key} points={[...up, ...down.reverse()].join(' ')} fill={o.color} opacity={0.22} stroke="none" /> : null;
        })}
        {overlays.map((o) =>
          o.kind === 'vline' ? <line key={o.key} x1={sx(o.x)} x2={sx(o.x)} y1={M.t} y2={M.t + ph} stroke={o.color} strokeWidth={1} strokeDasharray="3 2" /> : null,
        )}
        {overlays.map((o) => {
          if (o.kind !== 'span') return null;
          const a = sx(Number.isFinite(o.lo) ? Math.max(o.lo, x0) : x0);
          const b = sx(Number.isFinite(o.hi) ? Math.min(o.hi, x1) : x1);
          if (!o.strong) return <rect key={o.key} x={a} y={M.t} width={Math.max(0, b - a)} height={ph} fill={o.color} opacity={0.08} />;
          return (
            <g key={o.key}>
              <rect x={a} y={M.t} width={Math.max(0, b - a)} height={ph} fill={o.color} opacity={0.14} />
              <line x1={a} x2={a} y1={M.t} y2={M.t + ph} stroke={o.color} strokeWidth={1.2} strokeDasharray="4 3" />
              <line x1={b} x2={b} y1={M.t} y2={M.t + ph} stroke={o.color} strokeWidth={1.2} strokeDasharray="4 3" />
            </g>
          );
        })}
        {extra.map((s) => (s.label === 'top' ? null : <path key={s.key} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? (s.dash ? 1.6 : 2.2)} strokeDasharray={s.dash} />))}
        {series.map((s) => (s.noLine ? null : <path key={s.key} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.8} strokeDasharray={s.dash} />))}
        {series2.map((s) => (s.noLine ? null : <path key={`2${s.key}`} d={pathOf(s, sy2)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash ?? '7 3'} />))}
        {extra.map((s) => (s.label === 'top' ? <path key={s.key} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? (s.dash ? 1.6 : 2.2)} strokeDasharray={s.dash} /> : null))}
        {series.map(
          (s) =>
            (s.dots || s.noLine) && (
              <g key={`${s.key}:dots`} fill={s.color}>
                {Array.from(s.y, (y, i) => (Number.isFinite(y) && Number.isFinite((s.x ?? xs)[i]) ? <circle key={i} cx={sx((s.x ?? xs)[i])} cy={sy(y)} r={s.noLine ? 3 : 2.6} /> : null))}
              </g>
            ),
        )}
        {overlays.map((o) => {
          if (o.kind === 'width') {
            const [a, b, y] = [sx(o.x1), sx(o.x2), sy(o.y)];
            return (
              <g key={o.key} stroke={o.color} strokeWidth={1.5}>
                <line x1={a} x2={b} y1={y} y2={y} />
                <line x1={a} x2={a} y1={y - 4} y2={y + 4} />
                <line x1={b} x2={b} y1={y - 4} y2={y + 4} />
              </g>
            );
          }
          if (o.kind === 'arrow') {
            const [a, b, y] = [sx(o.x1), sx(o.x2), sy(o.y)];
            const d = b >= a ? 1 : -1;
            return (
              <g key={o.key} stroke={o.color} fill={o.color} strokeWidth={1.6}>
                <line x1={a} x2={b - d * 6} y1={y - 10} y2={y - 10} />
                <path d={`M${b},${y - 10}L${b - d * 7},${y - 14}L${b - d * 7},${y - 6}Z`} stroke="none" />
              </g>
            );
          }
          if (o.kind === 'marker') {
            const [x, y] = [sx(o.x), sy(o.y)];
            return (
              <g key={o.key}>
                <circle cx={x} cy={y} r={4.5} fill="none" stroke={o.color} strokeWidth={2} />
                <circle cx={x} cy={y} r={1.5} fill={o.color} />
              </g>
            );
          }
          return null;
        })}
        {notes.length > 0 && (
          <g transform={`translate(${M.l + 6} ${M.t + 6})`}>
            <rect width={notesW} height={notes.length * 13 + 6} rx={3} className="notes" />
            {notes.map((o, i) => (
              <g key={o.key} transform={`translate(6 ${12 + i * 13})`}>
                <circle cx={3} cy={-3.5} r={3} fill={o.color} />
                <text x={10} y={0} className="ann-text">{o.text}</text>
              </g>
            ))}
          </g>
        )}
        {tip && (
          <g data-export="skip">
            <line x1={tip.x} x2={tip.x} y1={M.t} y2={M.t + ph} className="crosshair" />
            <circle cx={tip.x} cy={tip.y} r={4} fill={tip.color} stroke="var(--panel)" strokeWidth={1.5} />
          </g>
        )}
        {drag && (
          <rect data-export="skip" x={Math.min(...drag)} y={M.t} width={Math.abs(drag[1] - drag[0])} height={ph} className={onSelect ? 'roi-sel' : 'zoom-sel'} />
        )}
      </g>
      {tip && (
        <g data-export="skip" transform={`translate(${tip.x + 10 + tipW > M.l + pw ? tip.x - 10 - tipW : tip.x + 10} ${M.t + 6})`}>
          <rect width={tipW} height={tip.lines.length * 14 + 8} rx={4} className="tip" />
          {tip.lines.map((l, k) => (
            <text key={k} x={6} y={16 + k * 14} className="tip-text">{l}</text>
          ))}
        </g>
      )}

      <rect
        data-export="skip"
        x={M.l}
        y={M.t}
        width={pw}
        height={ph}
        fill="transparent"
        className="nodrag"
        onMouseDown={(e) => {
          const [px] = point(e);
          setDrag([px, px]);
        }}
        onMouseMove={(e) => {
          const p = point(e);
          setHover(p);
          if (drag) setDrag([drag[0], p[0]]);
        }}
        onMouseUp={(e) => {
          if (drag && Math.abs(drag[1] - drag[0]) > 6) {
            const range: [number, number] = [invX(Math.min(...drag)), invX(Math.max(...drag))];
            if (onSelect) onSelect(...range);
            else setZoom(range);
          } else if (onPick) {
            // a click: the nearest sample of any series (in pixels)
            const [cx, cy] = point(e);
            let best: { key: string; i: number; d: number } | null = null;
            for (const [list, second] of [[series, false], [series2, true]] as const)
              for (const s of list) {
                const px = s.x ?? xs;
                for (let i = 0; i < s.y.length; i++) {
                  const y = s.y[i];
                  if (!Number.isFinite(y) || !Number.isFinite(px[i])) continue;
                  const d = Math.hypot(sx(px[i]) - cx, (second ? sy2 : sy)(y) - cy);
                  if (!best || d < best.d) best = { key: s.key, i, d };
                }
              }
            if (best && best.d <= 14) onPick(best.key, best.i);
          }
          setDrag(null);
        }}
        onMouseLeave={() => {
          setHover(null);
          setDrag(null);
        }}
      />
    </svg>
  );
}
