// Resonance metrics on a sampled curve y(x) with ascending x.

// Index window [i0, i1] covering the interval [lo, hi] (NaN = open end).
// x inside [lo, hi]; a non-finite bound (NaN, or null from an old project file) leaves that side open.
export const inWindow = (x: number, lo: number, hi: number) => (!Number.isFinite(lo) || x >= lo) && (!Number.isFinite(hi) || x <= hi);

// The interval [lo, hi] of a zone at y: straight lines between its points (in any order), constant beyond the ends.
export function zoneAt(pts: { y: number; lo: number; hi: number }[], y: number): [number, number] {
  const p = [...pts].filter((q) => Number.isFinite(q.y)).sort((a, b) => a.y - b.y);
  if (!p.length) return [NaN, NaN];
  if (y <= p[0].y) return [p[0].lo, p[0].hi];
  const last = p[p.length - 1];
  if (y >= last.y) return [last.lo, last.hi];
  let j = 1;
  while (p[j].y < y) j++;
  const [a, b] = [p[j - 1], p[j]];
  const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
  return [a.lo + t * (b.lo - a.lo), a.hi + t * (b.hi - a.hi)];
}

export function windowOf(xs: ArrayLike<number>, lo: number, hi: number): [number, number] {
  let i0 = 0;
  let i1 = xs.length - 1;
  if (Number.isFinite(lo)) while (i0 < xs.length && xs[i0] < lo) i0++;
  if (Number.isFinite(hi)) while (i1 >= 0 && xs[i1] > hi) i1--;
  return [i0, i1];
}

export type Extremum = { x: number; y: number; i: number };

// Global minimum or maximum in the window, refined by a parabola through the three samples around it.
export function extremum(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, mode: 'min' | 'max'): Extremum {
  const sgn = mode === 'min' ? 1 : -1;
  let k = -1;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(ys[i]) && (k < 0 || sgn * ys[i] < sgn * ys[k])) k = i;
  if (k < 0) return { x: NaN, y: NaN, i: -1 };
  if (k === i0 || k === i1) return { x: xs[k], y: ys[k], i: k };
  const [x0, x1, x2] = [xs[k - 1], xs[k], xs[k + 1]];
  const [y0, y1, y2] = [ys[k - 1], ys[k], ys[k + 1]];
  const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den;
  const B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
  const C = (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / den;
  const xv = -B / (2 * A);
  if (!(sgn * A > 0) || !(xv >= x0 && xv <= x2)) return { x: x1, y: y1, i: k };
  return { x: xv, y: C - (B * B) / (4 * A), i: k };
}

// How the position of a dip (peak) is found. 'parabola': through the three samples around the lowest one (exact on a
// smooth curve, but it follows the noise of those three points); 'poly': a least-squares polynomial of degree `deg`
// through the points below `level`; 'centroid': the centre of mass of the dip below `level`, weights (level − y) dx.
// `level` is a fraction of the depth from the bottom (0.5 = half depth). The last two average the noise over the dip
// (Piliarik & Homola, Opt. Express 17, 16505 (2009)). Only the position changes: the value stays the bottom of the dip
// (the refined lowest sample; a fit or the curve at the centroid would sit above it and move the half-depth level of FWHM).
export type LocateMethod = 'parabola' | 'poly' | 'centroid';
export type Locate = { method?: LocateMethod; level?: number; deg?: number };

// Solves the small dense system A x = b (Gaussian elimination with partial pivoting); null when singular.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k];
    x[r] = v / M[r][r];
  }
  return x;
}

// Position and value of the dip (min) or peak (max) in the window, by the chosen method (see Locate).
export function locate(xs: ArrayLike<number>, ys: ArrayLike<number>, i0: number, i1: number, mode: 'min' | 'max', loc?: Locate): Extremum {
  const e = extremum(xs, ys, i0, i1, mode);
  const method = loc?.method ?? 'parabola';
  if (method === 'parabola' || e.i < 0) return e;
  const sgn = mode === 'min' ? 1 : -1;
  // the level: a fraction of the depth, from the lowest sample to the opposite extreme of the window
  const bottom = ys[e.i];
  let top = bottom;
  for (let i = i0; i <= i1; i++) if (Number.isFinite(ys[i]) && sgn * ys[i] > sgn * top) top = ys[i];
  const f = Math.min(1, Math.max(0.02, loc?.level ?? 0.5));
  const T = bottom + f * (top - bottom);
  // the run of samples below the level around the lowest one
  let a = e.i;
  let b = e.i;
  while (a > i0 && sgn * (ys[a - 1] - T) < 0) a--;
  while (b < i1 && sgn * (ys[b + 1] - T) < 0) b++;
  if (method === 'centroid') {
    let sw = 0;
    let sx = 0;
    for (let i = a; i <= b; i++) {
      const dx = a === b ? 1 : (xs[Math.min(i + 1, b)] - xs[Math.max(i - 1, a)]) / 2;
      const w = sgn * (T - ys[i]) * dx;
      sw += w;
      sx += w * xs[i];
    }
    if (!(sw > 0)) return e;
    return { x: sx / sw, y: e.y, i: e.i };
  }
  // polynomial: at least deg + 2 points (the run widened inside the window when too short)
  const deg = Math.min(6, Math.max(2, Math.round(loc?.deg ?? 2)));
  while (b - a + 1 < deg + 2 && (a > i0 || b < i1)) {
    if (a > i0) a--;
    if (b - a + 1 < deg + 2 && b < i1) b++;
  }
  if (b - a + 1 < deg + 2) return e;
  const xc = (xs[a] + xs[b]) / 2;
  const hw = (xs[b] - xs[a]) / 2 || 1;
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const rhs = new Array<number>(m).fill(0);
  for (let i = a; i <= b; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const t = (xs[i] - xc) / hw;
    const pw = [1];
    for (let k = 1; k < 2 * m; k++) pw.push(pw[k - 1] * t);
    for (let r = 0; r < m; r++) {
      rhs[r] += pw[r] * ys[i];
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
    }
  }
  const c = solve(A, rhs);
  if (!c) return e;
  const P = (t: number) => c.reduceRight((acc, ck) => acc * t + ck, 0);
  // the extreme of the polynomial on the fitted range: a fine scan, refined by a parabola
  const K = 400;
  let kb = 0;
  let vb = Infinity;
  for (let k = 0; k <= K; k++) {
    const v = sgn * P(-1 + (2 * k) / K);
    if (v < vb) [vb, kb] = [v, k];
  }
  let t = -1 + (2 * kb) / K;
  if (kb > 0 && kb < K) {
    const h = 2 / K;
    const [p0, p1, p2] = [P(t - h), P(t), P(t + h)];
    const den = p0 - 2 * p1 + p2;
    if (sgn * den > 0) t += (h * (p0 - p2)) / (2 * den);
  }
  return { x: xc + t * hw, y: e.y, i: e.i };
}

export type LevelMethod = 'local' | 'edges' | 'absolute';

export type Width = { center: number; extreme: number; level: number; x1: number; x2: number; width: number };

const NO_WIDTH: Width = { center: NaN, extreme: NaN, level: NaN, x1: NaN, x2: NaN, width: NaN };

// Full width of a dip (or peak) at half depth. The reference is the opposite extreme of the window
// ('local'), the mean of the window edges ('edges') or a given absolute level.
export function halfWidth(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i0: number,
  i1: number,
  kind: 'dip' | 'peak',
  method: LevelMethod,
  absolute = NaN,
): Width {
  if (i1 - i0 < 2) return NO_WIDTH;
  const e = extremum(xs, ys, i0, i1, kind === 'dip' ? 'min' : 'max');
  if (e.i < 0) return NO_WIDTH;
  let level: number;
  if (method === 'absolute') level = absolute;
  else {
    let base: number;
    if (method === 'edges') base = (ys[i0] + ys[i1]) / 2;
    else {
      base = ys[i0];
      for (let i = i0; i <= i1; i++) base = kind === 'dip' ? Math.max(base, ys[i]) : Math.min(base, ys[i]);
    }
    level = (base + e.y) / 2;
  }
  if (!Number.isFinite(level)) return { ...NO_WIDTH, center: e.x, extreme: e.y };
  const beyond = (y: number) => (kind === 'dip' ? y >= level : y <= level);
  const cross = (a: number, b: number) => xs[a] + ((level - ys[a]) / (ys[b] - ys[a])) * (xs[b] - xs[a]);
  let x1 = NaN;
  for (let j = e.i; j > i0; j--)
    if (beyond(ys[j - 1])) {
      x1 = cross(j - 1, j);
      break;
    }
  let x2 = NaN;
  for (let j = e.i; j < i1; j++)
    if (beyond(ys[j + 1])) {
      x2 = cross(j, j + 1);
      break;
    }
  return { center: e.x, extreme: e.y, level, x1, x2, width: x2 - x1 };
}
