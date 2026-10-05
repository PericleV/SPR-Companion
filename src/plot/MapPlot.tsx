import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { axisTitle, axisValueText } from '../engine/dataset.ts';
import type { Axis } from '../engine/types.ts';
import { COLOR_MAPS, colorLut, type MapView } from './colors.ts';
import type { MapZone, Trace } from './overlays.ts';
import { zoneAt } from '../engine/metrics.ts';
import { bilinear, capValues, fracIndex, gaussianBlur, logTicks } from './mapGrid.ts';
import { applyLim, axisTicks, nearest, niceTicks } from './scale.ts';

type Props = {
  xAxis: Axis;
  yAxis: Axis;
  values: Float64Array; // values[iy * nx + ix]
  zLabel: string;
  zUnit: string;
  zDomain?: [number, number]; // omitted = auto
  xLim?: [number, number]; // manual limits of the view (NaN bound = automatic)
  yLim?: [number, number];
  view?: MapView; // colour range, log scale, smoothing, blur (display only)
  width?: number;
  height?: number;
  traces?: Trace[]; // analysis results drawn across the map (e.g. resonance position)
  zones?: MapZone[]; // analysis zones following the other axis: drawn, their points dragged
  onZone?: (zone: MapZone, pts: MapZone['pts']) => void; // a zone edited on the map (drag, double-click to add / remove a point)
  // closed regions (x, y): with onPoly their corners are dragged, a click on an edge's middle adds a corner, a
  // double-click on a corner removes it
  polys?: { key: string; color: string; pts: [number, number][] }[];
  onPoly?: (key: string, pts: [number, number][]) => void;
  draw?: { color: string; pts: [number, number][]; onAdd: (pt: [number, number]) => void }; // a region being drawn: a click adds a corner
};
type PolyDrag = { key: string; i: number; pts: [number, number][] };

type Drag = { key: string; i: number; edge: 'lo' | 'hi'; pts: MapZone['pts'] };

const M = { l: 54, r: 74, t: 10, b: 38 };

// Extent covering whole cells (half a step beyond the first and last sample).
const cellExtent = (v: number[]): [number, number] =>
  v.length < 2 ? [v[0] - 0.5, v[0] + 0.5] : [v[0] - (v[1] - v[0]) / 2, v[v.length - 1] + (v[v.length - 1] - v[v.length - 2]) / 2];

export function MapPlot({ xAxis, yAxis, values, zLabel, zUnit, zDomain, xLim, yLim, view, width = 520, height = 300, traces = [], zones = [], onZone, polys = [], onPoly, draw }: Props) {
  const [pdrag, setPdrag] = useState<PolyDrag | null>(null);
  const drawPts = draw?.pts ?? [];
  const pw = width - M.l - M.r;
  const ph = height - M.t - M.b;
  const canvas = useRef<HTMLCanvasElement>(null);
  const grad = useId();
  const clip = useId();
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const nx = xAxis.values.length;

  const xData = cellExtent(xAxis.values);
  const yData = cellExtent(yAxis.values);
  const [x0, x1] = applyLim(xData, xLim);
  const [y0, y1] = applyLim(yData, yLim);
  const log = !!view?.zLog;
  const blur = view?.blur ?? 0;
  const smooth = !!view?.smooth;
  // what is coloured: log10 of the values (≤ 0 left empty) and / or blurred; the data themselves are not changed
  const cap = view?.cap;
  const capHide = !!view?.capHide;
  const cmap = COLOR_MAPS[view?.cmap ?? 'viridis'] ?? COLOR_MAPS.viridis;
  const diverging = !!cmap.diverging;
  const lut = colorLut(view?.cmap);
  const grid = useMemo(() => {
    // the cap first (in the units of the data), then log and blur
    const c = capValues(values, cap, capHide);
    const g = log ? c.map((v) => (v > 0 ? Math.log10(v) : NaN)) : c;
    return blur > 0 ? gaussianBlur(g, nx, values.length / nx, blur) : g;
  }, [values, log, blur, nx, cap, capHide]);
  const [z0, z1] = useMemo((): [number, number] => {
    let auto: [number, number] = [0, 1];
    if (zDomain && !log) auto = zDomain;
    else {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of grid) {
        if (!Number.isFinite(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (Number.isFinite(lo)) auto = hi - lo < 1e-12 ? [lo - 0.5, hi + 0.5] : [lo, hi];
    }
    // a diverging map (wave): the automatic range symmetric about 0 when the values have both signs
    if (diverging && !log && auto[0] < 0 && auto[1] > 0) {
      const m = Math.max(-auto[0], auto[1]);
      auto = [-m, m];
    }
    const lim = view?.zLim;
    const t = (v: number) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);
    return applyLim(auto, lim && [t(lim[0]), t(lim[1])]);
  }, [grid, zDomain, log, view?.zLim, diverging]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(pw * dpr);
    const H = Math.round(ph * dpr);
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    // outside the data (limits wider than the data): left empty
    const pick = (v: number[], ext: [number, number], p: number) => (p < Math.min(...ext) || p > Math.max(...ext) ? -1 : nearest(v, p));
    const col = Int32Array.from({ length: W }, (_, c) => pick(xAxis.values, cellExtent(xAxis.values), x0 + ((c + 0.5) / W) * (x1 - x0)));
    const row = Int32Array.from({ length: H }, (_, r) => pick(yAxis.values, cellExtent(yAxis.values), y1 - ((r + 0.5) / H) * (y1 - y0)));
    // smooth: bilinear between the sample points (fractional indices)
    const fcol = smooth ? Float64Array.from({ length: W }, (_, c) => fracIndex(xAxis.values, x0 + ((c + 0.5) / W) * (x1 - x0))) : null;
    const frow = smooth ? Float64Array.from({ length: H }, (_, r) => fracIndex(yAxis.values, y1 - ((r + 0.5) / H) * (y1 - y0))) : null;
    const ny = values.length / nx;
    const span = z1 - z0 || 1;
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (row[r] < 0 || col[c] < 0) continue;
        const v = fcol && frow ? bilinear(grid, nx, ny, frow[r], fcol[c]) : grid[row[r] * nx + col[c]];
        const p = (r * W + c) * 4;
        if (!Number.isFinite(v)) continue;
        const k = Math.round(Math.min(1, Math.max(0, (v - z0) / span)) * 255) * 3;
        img.data[p] = lut[k];
        img.data[p + 1] = lut[k + 1];
        img.data[p + 2] = lut[k + 2];
        img.data[p + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }, [values, grid, smooth, xAxis, yAxis, nx, x0, x1, y0, y1, z0, z1, pw, ph, lut]);

  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0)) * pw;
  const sy = (v: number) => M.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const sz = (v: number) => M.t + ph - ((v - z0) / (z1 - z0 || 1)) * ph;

  const point = (e: MouseEvent<SVGElement>): [number, number] => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return [((e.clientX - r.left) * width) / r.width, ((e.clientY - r.top) * height) / r.height];
  };
  // screen → data
  const dataAt = ([px, py]: [number, number]): [number, number] => [x0 + ((px - M.l) / pw) * (x1 - x0), y0 + ((M.t + ph - py) / ph) * (y1 - y0)];

  // Zones: along = the analysed coordinate (start / end), at = the followed one; on screen (x, y) or swapped.
  const zPos = (z: MapZone, along: number, at: number): [number, number] => (z.swap ? [sx(at), sy(along)] : [sx(along), sy(at)]);
  const zData = (z: MapZone, p: [number, number]): { along: number; at: number } => {
    const [dx, dy] = dataAt(p);
    return z.swap ? { along: dy, at: dx } : { along: dx, at: dy };
  };
  const zoneShape = (z: MapZone, pts: MapZone['pts']) => {
    const s = [...pts].sort((a, b) => a.y - b.y);
    // constant beyond the first and last point: to the edges of the view along the followed axis
    const [a0, a1] = z.swap ? [x0, x1] : [y0, y1];
    const ys = [Math.min(a0, s[0].y), ...s.map((q) => q.y), Math.max(a1, s[s.length - 1].y)];
    const at = (y: number) => zoneAt(s, y);
    const lo = ys.map((y) => zPos(z, at(y)[0], y));
    const hi = ys.map((y) => zPos(z, at(y)[1], y)).reverse();
    return [...lo, ...hi].map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('') + 'Z';
  };
  const shown = zones.map((z) => ({ z, pts: drag?.key === z.key ? drag.pts : z.pts }));
  const shownPolys = polys.map((p) => (pdrag?.key === p.key ? { ...p, pts: pdrag.pts } : p));
  const moveHandle = (e: MouseEvent<SVGElement>) => {
    if (!drag) return;
    const z = zones.find((q) => q.key === drag.key);
    if (!z) return;
    const { along, at } = zData(z, point(e));
    const pts = drag.pts.map((q, i) => (i === drag.i ? { ...q, y: +at.toPrecision(6), [drag.edge]: +along.toPrecision(6) } : q));
    setDrag({ ...drag, pts });
  };
  const endDrag = () => {
    if (!drag) return;
    const z = zones.find((q) => q.key === drag.key);
    if (z && onZone) onZone(z, drag.pts);
    setDrag(null);
  };
  // double-click inside a zone: a new point there (its start / end on the zone's edges)
  const addPoint = (e: MouseEvent<SVGElement>) => {
    if (!onZone) return;
    for (const z of zones) {
      const { along, at } = zData(z, point(e));
      const [lo, hi] = zoneAt(z.pts, at);
      if (along >= Math.min(lo, hi) && along <= Math.max(lo, hi)) {
        onZone(z, [...z.pts, { y: +at.toPrecision(6), lo: +lo.toPrecision(6), hi: +hi.toPrecision(6) }].sort((a, b) => a.y - b.y));
        return;
      }
    }
  };

  let tip: { x: number; y: number; lines: string[] } | null = null;
  if (hover) {
    const i = nearest(xAxis.values, x0 + ((hover[0] - M.l) / pw) * (x1 - x0));
    const j = nearest(yAxis.values, y1 - ((hover[1] - M.t) / ph) * (y1 - y0));
    const v = values[j * nx + i];
    tip = {
      x: hover[0],
      y: hover[1],
      lines: [
        `${xAxis.label} = ${axisValueText(xAxis, i)}`,
        `${yAxis.label} = ${axisValueText(yAxis, j)}`,
        `${zLabel} = ${Number.isFinite(v) ? v.toFixed(4) : '—'}${zUnit}`,
      ],
    };
  }
  const tipW = 150;
  const barX = M.l + pw + 14;

  return (
    <div className="map" style={{ width, height }}>
      <canvas ref={canvas} style={{ left: M.l, top: M.t, width: pw, height: ph }} />
      <svg width={width} height={height} className="plot">
        <defs>
          <linearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
            {cmap.stops.map((c, k) => (
              <stop key={k} offset={k / (cmap.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        {axisTicks(xAxis, x0, x1).map((t) => (
          <g key={`x${t.v}`}>
            <line x1={sx(t.v)} x2={sx(t.v)} y1={M.t + ph} y2={M.t + ph + 4} className="axis-line" />
            <text x={sx(t.v)} y={M.t + ph + 14} className="tick" textAnchor="middle">{t.text}</text>
          </g>
        ))}
        {axisTicks(yAxis, y0, y1, 5).map((t) => (
          <g key={`y${t.v}`}>
            <line x1={M.l - 4} x2={M.l} y1={sy(t.v)} y2={sy(t.v)} className="axis-line" />
            <text x={M.l - 6} y={sy(t.v)} className="tick" textAnchor="end" dominantBaseline="middle">{t.text}</text>
          </g>
        ))}
        <clipPath id={clip}>
          <rect x={M.l} y={M.t} width={pw} height={ph} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          {traces.map((t) => (
            <path
              key={t.key}
              d={t.x.reduce((acc, x, i) => {
                // a gap at missing values
                if (!Number.isFinite(x) || !Number.isFinite(t.y[i])) return { d: acc.d, pen: false };
                return { d: `${acc.d}${acc.pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(t.y[i]).toFixed(1)}`, pen: true };
              }, { d: '', pen: false }).d}
              fill="none"
              stroke={t.color}
              strokeWidth={t.width ?? 2}
              strokeDasharray={t.dash}
            />
          ))}
          {shown.map(({ z, pts }) => (
            <path key={z.key} d={zoneShape(z, pts)} fill={z.color} fillOpacity={0.12} stroke={z.color} strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
          ))}
          {shownPolys.map((p) => (
            <path key={p.key} d={p.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('') + 'Z'} fill={p.color} fillOpacity={0.14} stroke={p.color} strokeWidth={1.8} strokeDasharray="5 3" pointerEvents="none" />
          ))}
          {draw && drawPts.length > 0 && (
            <g data-export="skip" pointerEvents="none">
              <path d={[...drawPts, ...(hover ? [dataAt(hover)] : []), drawPts[0]].map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('')} fill={draw.color} fillOpacity={0.12} stroke={draw.color} strokeWidth={2} strokeDasharray="6 3" />
              {drawPts.map(([x, y], i) => <circle key={i} cx={sx(x)} cy={sy(y)} r={4} fill="var(--panel)" stroke={draw.color} strokeWidth={2} />)}
            </g>
          )}
        </g>
        <rect x={M.l} y={M.t} width={pw} height={ph} className="frame" />
        <text x={M.l + pw / 2} y={height - 4} className="axis-title" textAnchor="middle">{axisTitle(xAxis)}</text>
        <text transform={`translate(12 ${M.t + ph / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">
          {axisTitle(yAxis)}
        </text>

        <rect x={barX} y={M.t} width={12} height={ph} fill={`url(#${grad})`} />
        {(log ? logTicks(z0, z1) : niceTicks(z0, z1, 5)).map((t) => (
          <text key={t.v} x={barX + 16} y={sz(t.v)} className="tick" dominantBaseline="middle">{t.text}</text>
        ))}
        <text x={barX} y={M.t + ph + 14} className="tick">{`${zUnit ? `${zLabel} [${zUnit}]` : zLabel}${log ? ' (log)' : ''}`}</text>
        {cap !== undefined && Number.isFinite(cap) && (
          <text x={barX} y={M.t + ph + 27} className="tick">{capHide ? `hidden > ${+cap.toPrecision(4)}` : `≥ ${+cap.toPrecision(4)}`}</text>
        )}

        {tip && (
          <g data-export="skip" transform={`translate(${tip.x + 12 + tipW > M.l + pw ? tip.x - 12 - tipW : tip.x + 12} ${Math.min(tip.y + 8, M.t + ph - 52)})`}>
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
          onMouseMove={(e) => setHover(point(e))}
          onMouseLeave={() => setHover(null)}
          onClick={draw ? (e) => draw.onAdd(dataAt(point(e))) : undefined}
          onDoubleClick={!draw && zones.length ? addPoint : undefined}
          style={draw ? { cursor: 'crosshair' } : undefined}
        />
        {onPoly &&
          !draw &&
          shownPolys.map((p) => (
            <g key={`h${p.key}`} data-export="skip">
              {/* the middle of each edge: a click adds a corner there */}
              {p.pts.map(([x, y], i) => {
                const [x2, y2] = p.pts[(i + 1) % p.pts.length];
                return (
                  <circle
                    key={`m${i}`}
                    className="nodrag poly-mid"
                    cx={(sx(x) + sx(x2)) / 2}
                    cy={(sy(y) + sy(y2)) / 2}
                    r={3.5}
                    fill={p.color}
                    opacity={0.6}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPoly(p.key, [...p.pts.slice(0, i + 1), [(x + x2) / 2, (y + y2) / 2], ...p.pts.slice(i + 1)]);
                    }}
                  >
                    <title>click: a new corner here</title>
                  </circle>
                );
              })}
              {p.pts.map(([x, y], i) => (
                <circle
                  key={`c${i}`}
                  className="nodrag zone-handle"
                  cx={sx(x)}
                  cy={sy(y)}
                  r={5}
                  fill="var(--panel)"
                  stroke={p.color}
                  strokeWidth={2}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setPdrag({ key: p.key, i, pts: p.pts });
                  }}
                  onPointerMove={(e) => {
                    if (!pdrag || pdrag.key !== p.key) return;
                    const q = dataAt(point(e));
                    setPdrag({ ...pdrag, pts: pdrag.pts.map((v, j) => (j === pdrag.i ? [+q[0].toPrecision(6), +q[1].toPrecision(6)] : v)) });
                  }}
                  onPointerUp={() => {
                    if (pdrag) onPoly(pdrag.key, pdrag.pts);
                    setPdrag(null);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (p.pts.length > 3) onPoly(p.key, p.pts.filter((_, j) => j !== i));
                  }}
                >
                  <title>{`drag: move this corner · double-click: remove it${p.pts.length > 3 ? '' : ' (at least three)'} · the dots on the edges add corners`}</title>
                </circle>
              ))}
            </g>
          ))}
        {onZone &&
          shown.map(({ z, pts }) =>
            pts.flatMap((q, i) =>
              (['lo', 'hi'] as const).map((edge) => {
                const [cx, cy] = zPos(z, q[edge], q.y);
                return (
                  <circle
                    key={`${z.key}:${i}:${edge}`}
                    data-export="skip"
                    className="nodrag zone-handle"
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill="var(--panel)"
                    stroke={z.color}
                    strokeWidth={2}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ key: z.key, i, edge, pts });
                    }}
                    onPointerMove={moveHandle}
                    onPointerUp={endDrag}
                    onDoubleClick={(e) => {
                      // double-click on a point: removed (a zone keeps at least two)
                      e.stopPropagation();
                      if (pts.length > 2) onZone(z, pts.filter((_, j) => j !== i));
                    }}
                  >
                    <title>{`drag: move this point · double-click: remove it${pts.length > 2 ? '' : ' (at least two points)'} · double-click inside the zone: add one`}</title>
                  </circle>
                );
              }),
            ),
          )}
      </svg>
    </div>
  );
}
