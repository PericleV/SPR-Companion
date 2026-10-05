// Overlays of the metrics on a curve: the ROI, the extremum, the width bar, the position with n + Δn and the curve
// recomputed with it, the fit (start dashed, fitted solid, each component dotted — each shown or not), the fitted
// dispersion (branches solid, uncoupled modes dashed), the zones (to maximize: green; to minimize: red).
import type { Overlay } from '../plot/overlays.ts';
import { quantitiesOf, roiOf, type FitSettings, type Metric, type MetricResult } from '../model/metrics.ts';
import { metricColor } from './roiColor.ts';

const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(6)) : '—');
export const ZONE_COLORS = { max: '#2e9d5b', min: '#d9534f' };

// The parts of a metric's overlays, each shown or hidden on its own (a plot keeps the hidden ones).
export type OverlayPart = 'roi' | 'mark' | 'label' | 'width' | 'shift' | 'start' | 'fit' | 'parts' | 'zones' | 'trace';
export const PART_LABEL: Record<OverlayPart, string> = { roi: 'Region', mark: 'Position', label: 'Value', width: 'Width', shift: 'n + Δn curve', start: 'Start', fit: 'Fit', parts: 'Components', zones: 'Zones', trace: 'Positions' };
// the parts a metric draws on curves (map: on a map)
export function partsOf(m: Metric, map = false): OverlayPart[] {
  if (m.kind === 'custom') return [];
  if (m.kind === 'zones') return map ? [] : ['zones'];
  const disp = m.kind === 'fit' && m.fit?.mode === 'dispersion';
  if (map) return disp ? ['fit', 'start'] : ['trace', 'roi'];
  if (disp) return ['fit', 'start'];
  if (m.kind === 'fit') return ['roi', 'start', 'fit', 'parts'];
  const out: OverlayPart[] = ['roi', 'mark', 'label'];
  if (m.kind === 'fwhm' || m.kind === 'fom' || m.kind === 'propagation') out.push('width');
  if (m.kind === 'sens' || m.kind === 'fom') out.push('shift');
  return out;
}
export const overlayKey = (metric: string, part?: OverlayPart) => (part ? `${metric}:${part}` : metric);
// hidden: the plot's hidden keys (a metric, or a metric's part)
export const isHidden = (hidden: string[] | undefined, metric: string, part?: OverlayPart) => !!hidden && (hidden.includes(metric) || (!!part && hidden.includes(overlayKey(metric, part))));

// Whether a component of a fit is drawn (older projects: `parts` for all of them).
export const compShown = (fit: FitSettings | undefined, id: string) => fit?.show?.comps?.[id] ?? fit?.parts ?? true;

type Options = {
  unit: string;
  spectral: boolean;
  shift: boolean; // the shifted position and curve (one curve plotted)
  fit: boolean;
  text: boolean;
  at?: Record<string, number>;
  colorIndex?: (i: number) => number;
  shiftedCurve?: (key: string) => ArrayLike<number> | undefined; // R with n + Δn on the plotted curve
  xs?: ArrayLike<number>;
  hidden?: string[]; // the parts not drawn (overlayKey)
};

export function metricOverlays(metrics: Metric[], results: (MetricResult | undefined)[], o: Options): Overlay[] {
  return metrics.flatMap((m, i): Overlay[] => {
    if (!m.on || m.kind === 'custom') return [];
    const r = results[i];
    const c = metricColor(m, o.colorIndex ? o.colorIndex(i) : i);
    const out: Overlay[] = [];
    if (isHidden(o.hidden, m.id)) return out;
    const on = (p: OverlayPart) => !isHidden(o.hidden, m.id, p);
    if (m.kind === 'zones') {
      if (on('zones')) for (const z of r?.marks.zones ?? []) out.push({ kind: 'span', key: `z${m.id}${z.label}`, lo: z.lo, hi: z.hi, color: ZONE_COLORS[z.goal], strong: true, text: o.text ? `${z.label} ${z.goal === 'max' ? '↑' : '↓'} ${fmt(z.value)}` : z.label });
      return out;
    }
    const [lo, hi] = roiOf(m, o.at);
    if ((Number.isFinite(lo) || Number.isFinite(hi)) && on('roi')) out.push({ kind: 'span', key: `span${m.id}`, lo, hi, color: c });
    if (!r) return out;
    const mk = r.marks;
    // the fit over the data: the start dashed, the fitted model solid and thicker, each component dotted
    if (mk.fit && o.fit) {
      const show = m.fit?.show;
      if (show?.start !== false && on('start')) out.push({ kind: 'curve', key: `fs${m.id}`, x: mk.fit.x, y: mk.fit.start, color: c, top: true, width: 2 });
      if (mk.fit.fitted.length && show?.fitted !== false && on('fit')) out.push({ kind: 'curve', key: `ff${m.id}`, x: mk.fit.x, y: mk.fit.fitted, color: c, solid: true, top: true, width: 2.8 });
      mk.fit.parts?.forEach((p, k) => {
        const id = mk.fit!.ids?.[k];
        if (id !== undefined && compShown(m.fit, id) && on('parts')) out.push({ kind: 'curve', key: `fp${m.id}_${k}`, x: mk.fit!.x, y: p, color: c, top: true, width: 1.4, dash: '2 3' });
      });
    }
    if (mk.disp && o.fit) {
      const show = m.fit?.show;
      if (show?.fitted !== false && on('fit')) {
        out.push({ kind: 'curve', key: `dl${m.id}`, x: mk.disp.x, y: mk.disp.lower, color: c, solid: true, top: true, width: 2.4 });
        out.push({ kind: 'curve', key: `du${m.id}`, x: mk.disp.x, y: mk.disp.upper, color: c, solid: true, top: true, width: 2.4 });
      }
      if (show?.start !== false && on('start')) {
        out.push({ kind: 'curve', key: `d1${m.id}`, x: mk.disp.x, y: mk.disp.mode1, color: 'var(--muted)', top: true });
        out.push({ kind: 'curve', key: `d2${m.id}`, x: mk.disp.x, y: mk.disp.mode2, color: 'var(--muted)', top: true });
      }
    }
    const main = quantitiesOf(m, o.spectral)[0];
    const text = o.text && on('label') ? `${m.label}: ${main.label} ${fmt(r.values[main.key])}${main.unit(o.unit) ? ` ${main.unit(o.unit)}` : ''}` : undefined;
    if (mk.x !== undefined && mk.y !== undefined && Number.isFinite(mk.x) && Number.isFinite(mk.y) && on('mark')) out.push({ kind: 'marker', key: `m${m.id}`, x: mk.x, y: mk.y, color: c, text });
    if ((m.kind === 'fwhm' || m.kind === 'fom' || m.kind === 'propagation') && Number.isFinite(mk.x1) && Number.isFinite(mk.x2) && on('width')) out.push({ kind: 'width', key: `w${m.id}`, x1: mk.x1!, x2: mk.x2!, y: mk.level!, color: c });
    // the sensitivity: R with n + Δn (dashed, same colour), its dip and an arrow from the dip
    if (o.shift && mk.shiftKey && (m.kind === 'sens' || m.kind === 'fom') && on('shift')) {
      const y = o.shiftedCurve?.(mk.shiftKey);
      if (y && o.xs) out.push({ kind: 'curve', key: `sc${m.id}`, x: o.xs, y, color: c, dash: '5 3', width: 1.6 });
      if (mk.shifted !== undefined && Number.isFinite(mk.shifted) && mk.x !== undefined && Number.isFinite(mk.x) && mk.y !== undefined) out.push({ kind: 'arrow', key: `sa${m.id}`, x1: mk.x, x2: mk.shifted, y: mk.y, color: c });
    }
    return out;
  });
}
