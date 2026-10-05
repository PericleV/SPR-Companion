// Drawing of the stack: the incident medium on top, each layer a band (height ∝ √d, so thin metals and thick
// dielectrics both show), runs of DBR periods marked “×N”, the light arriving from the top; a rough interface as a
// wavy line (its slices given back to the layers around it, in proportion to their fractions).
import type { Library } from '../physics/library.ts';
import type { Expanded, RealLayer } from '../model/structure.ts';
import { colorOf } from '../model/materials.ts';

const MEDIUM = 46;

type Run = { from: number; to: number; count: number }; // band indices [from, to) and number of periods

function periodRuns(ls: RealLayer[]): Run[] {
  const out: Run[] = [];
  let i = 0;
  while (i < ls.length) {
    const L = ls[i];
    if (L.role !== 'period') {
      i++;
      continue;
    }
    let j = i;
    while (j < ls.length && ls[j].block === L.block && ls[j].role === 'period') j++;
    const periods = new Set(ls.slice(i, j).map((x) => x.period)).size;
    if (periods > 1) out.push({ from: i, to: j, count: periods });
    i = j;
  }
  return out;
}

// The layers without the slices of the rough zones (each material's share of a zone added to its layer; a film that
// lies wholly inside a zone drawn with its share), and the rough interfaces: k = after band k (−1: after the incident
// medium).
function collapse(ex: Expanded): { ls: RealLayer[]; rough: Set<number> } {
  if (!ex.layers.some((L) => L.role === 'rough')) return { ls: ex.layers, rough: new Set() };
  const out: RealLayer[] = [];
  const rough = new Set<number>();
  const carry = { id: '', d: 0 }; // a share for the next layer (id '': none)
  const all = ex.layers;
  for (let i = 0; i < all.length; i++) {
    const L = all[i];
    if (L.role !== 'rough') {
      out.push({ ...L, d: L.d + (carry.id === L.mat.id ? carry.d : 0) });
      carry.id = '';
      continue;
    }
    // a zone: its slices, the share of every material in depth order
    let j = i;
    const share = new Map<string, number>();
    const order: string[] = [];
    while (j < all.length && all[j].role === 'rough') {
      const S = all[j];
      S.mix?.mats.forEach((m, k) => {
        if (!share.has(m.id)) order.push(m.id);
        share.set(m.id, (share.get(m.id) ?? 0) + S.mix!.f[k] * S.d);
      });
      j++;
    }
    const next = all[j];
    rough.add(out.length - 1);
    order.forEach((id, k) => {
      const d = share.get(id)!;
      const prev = out[out.length - 1];
      if (k === 0 && (prev ? prev.mat.id === id : ex.incident.id === id)) {
        if (prev) prev.d += d;
      } else if (k === order.length - 1 && (next ? next.mat.id === id : ex.exit.id === id)) Object.assign(carry, next ? { id, d } : { id: '', d: 0 });
      else {
        out.push({ mat: { id }, d, label: '', block: L.block, role: 'film' });
        rough.add(out.length - 1);
      }
    });
    i = j - 1;
  }
  return { ls: out, rough };
}

// the light arriving normally, or obliquely from the left or the right (a drawing choice)
export type LightDir = 'normal' | 'left' | 'right';

export function StackDrawing({ ex, lib, width, colors, light = 'left' }: { ex: Expanded; lib: Library; width: number; colors: Record<string, string>; light?: LightDir }) {
  const { ls, rough } = collapse(ex);
  const n = ls.length;
  const budget = Math.max(160, Math.min(560, 26 * n));
  const raw = ls.map((L) => Math.sqrt(Math.max(L.d, 0.05)));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const minH = n > 60 ? 2 : n > 30 ? 4 : 8;
  const h = raw.map((r) => Math.max(minH, (r / sum) * budget));
  const height = MEDIUM * 2 + h.reduce((a, b) => a + b, 0) + 12;
  const left = 44;
  const bandW = Math.max(90, Math.min(260, width - left - 150));
  const y0 = 6 + MEDIUM;
  const ys = h.reduce<number[]>((acc, v, i) => [...acc, acc[i] + v], [y0]);
  const mat = (id: string) => lib.get(id);
  const color = (id: string) => colorOf(colors, lib, id);
  const label = (L: RealLayer) => `${mat(L.mat.id)?.name ?? L.mat.id} ${L.layers2D ? `${L.layers2D} L` : `${+L.d.toFixed(1)} nm`}`;
  const runs = periodRuns(ls);
  const yEnd = ys[n];

  return (
    <svg width={width} height={height} className="plot stack-drawing">
      {/* incident medium and the light */}
      {/* the media in their own colour, open (semi-infinite) at the outer edge */}
      <rect x={left} y={6} width={bandW} height={MEDIUM} fill={color(ex.incident.id)} />
      <line x1={left} x2={left + bandW} y1={6} y2={6} stroke="var(--panel)" strokeWidth={2} strokeDasharray="6 4" />
      <text x={left + bandW + 8} y={6 + MEDIUM / 2} className="axis-title" dominantBaseline="middle">{`${mat(ex.incident.id)?.name ?? ex.incident.id} (incident)`}</text>
      <line
        x1={light === 'normal' ? left + bandW / 2 : light === 'left' ? left + 14 : left + bandW - 14}
        y1={10}
        x2={light === 'normal' ? left + bandW / 2 : light === 'left' ? left + bandW / 2 - 4 : left + bandW / 2 + 4}
        y2={y0 - 4}
        stroke="#e0a000"
        strokeWidth={2.5}
        markerEnd="url(#arrow)"
      />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#e0a000" />
        </marker>
      </defs>
      {ls.map((L, i) => (
        <g key={i}>
          <rect x={left} y={ys[i]} width={bandW} height={h[i]} fill={color(L.mat.id)} stroke="var(--panel)" strokeWidth={h[i] > 3 ? 0.5 : 0} />
          {h[i] >= 12 && !runs.some((r) => i >= r.from && i < r.to && i >= r.from + (r.to - r.from) / r.count) && (
            <text x={left + bandW + 8} y={ys[i] + h[i] / 2} className="tick" dominantBaseline="middle">{label(L)}</text>
          )}
        </g>
      ))}
      {/* DBR periods: a bracket with ×N, labels of the first period only */}
      {runs.map((r) => (
        <g key={r.from}>
          <path d={`M${left - 6},${ys[r.from]} h-6 V${ys[r.to]} h6`} fill="none" stroke="var(--text)" strokeWidth={1.2} />
          <text x={left - 16} y={(ys[r.from] + ys[r.to]) / 2} className="axis-title" textAnchor="end" dominantBaseline="middle">{`×${r.count}`}</text>
        </g>
      ))}
      <rect x={left} y={yEnd} width={bandW} height={MEDIUM} fill={color(ex.exit.id)} />
      <line x1={left} x2={left + bandW} y1={yEnd + MEDIUM} y2={yEnd + MEDIUM} stroke="var(--panel)" strokeWidth={2} strokeDasharray="6 4" />
      <text x={left + bandW + 8} y={yEnd + MEDIUM / 2} className="axis-title" dominantBaseline="middle">{`${mat(ex.exit.id)?.name ?? ex.exit.id} (exit)`}</text>
      {/* rough interfaces: a wavy line */}
      {[...rough].map((k) => {
        const y = ys[k + 1];
        const steps = Math.max(8, Math.round(bandW / 6));
        const d = Array.from({ length: steps + 1 }, (_, q) => `${q ? 'L' : 'M'}${(left + (q * bandW) / steps).toFixed(1)},${(y + 2.5 * Math.sin(q * 1.9) * Math.cos(q * 0.7)).toFixed(1)}`).join(' ');
        return <path key={`r${k}`} d={d} fill="none" stroke="var(--text)" strokeWidth={1.3} opacity={0.75} />;
      })}
      <path d={`M${left},6 V${yEnd + MEDIUM} M${left + bandW},6 V${yEnd + MEDIUM}`} fill="none" stroke="var(--axis)" />
    </svg>
  );
}
