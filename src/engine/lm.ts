// Levenberg–Marquardt least squares with a forward-difference Jacobian.

export type LmResult = {
  p: number[];
  ssr: number; // sum of squared residuals
  sigma: number[]; // 1σ parameter uncertainties from the covariance at the solution
  iterations: number;
};

// Solves A x = b by Gaussian elimination with partial pivoting (A is n×n, row-major arrays).
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const ssq = (r: Float64Array) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * r[i];
  return s;
};

export function levenbergMarquardt(
  residual: (p: number[]) => Float64Array,
  p0: number[],
  constrain: (p: number[]) => number[] = (p) => p,
  maxIter = 300,
  ftol = 1e-10, // stop when an accepted step lowers the sum of squares by less than this fraction
): LmResult {
  let p = constrain(p0.slice());
  let r = residual(p);
  let ssr = ssq(r);
  const n = p.length;
  const m = r.length;
  let lambda = 1e-3;
  let J: Float64Array[] = [];
  let iterations = 0;
  const hist: number[] = [];

  const jacobian = () => {
    J = p.map((pj, j) => {
      const h = 1e-7 * Math.max(Math.abs(pj), 1e-3);
      const q = p.slice();
      q[j] = pj + h;
      const rh = residual(q);
      const col = new Float64Array(m);
      for (let i = 0; i < m; i++) col[i] = (rh[i] - r[i]) / h;
      return col;
    });
  };
  const normal = () => {
    const JtJ = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Jtr = new Array<number>(n).fill(0);
    for (let a = 0; a < n; a++) {
      const ja = J[a];
      let sr = 0;
      for (let i = 0; i < m; i++) sr += ja[i] * r[i];
      Jtr[a] = sr;
      for (let b = a; b < n; b++) {
        const jb = J[b];
        let s = 0;
        for (let i = 0; i < m; i++) s += ja[i] * jb[i];
        JtJ[a][b] = JtJ[b][a] = s;
      }
    }
    return { JtJ, Jtr };
  };

  if (n > 0 && m >= n) {
    for (; iterations < maxIter; iterations++) {
      jacobian();
      const { JtJ, Jtr } = normal();
      let improved = false;
      while (lambda < 1e12) {
        const A = JtJ.map((row, i) => row.map((v, k) => (i === k ? v + lambda * (v || 1e-12) : v)));
        const step = solve(A, Jtr.map((v) => -v));
        if (step && step.every(Number.isFinite)) {
          const q = constrain(p.map((v, i) => v + step[i]));
          const rq = residual(q);
          const sq = ssq(rq);
          if (Number.isFinite(sq) && sq < ssr) {
            const gain = (ssr - sq) / Math.max(ssr, 1e-300);
            [p, r, ssr] = [q, rq, sq];
            lambda = Math.max(lambda / 3, 1e-12);
            improved = gain > ftol;
            break;
          }
        }
        lambda *= 4;
      }
      if (!improved) break;
      // crawling (e.g. a width towards zero): less than 1e-6 of the sum of squares gained over 10 iterations
      hist.push(ssr);
      if (hist.length > 10 && (hist[hist.length - 11] - ssr) / Math.max(hist[hist.length - 11], 1e-300) < 1e-6) break;
    }
  }

  // Uncertainties: σ² (JᵀJ)⁻¹ with σ² = SSR / (m − n).
  let sigma = p.map(() => NaN);
  if (n > 0 && m > n) {
    jacobian();
    const { JtJ } = normal();
    const s2 = ssr / (m - n);
    sigma = p.map((_, j) => {
      const e = p.map((__, k) => (k === j ? 1 : 0));
      const col = solve(JtJ, e);
      return col ? Math.sqrt(Math.abs(col[j] * s2)) : NaN;
    });
  }
  return { p, ssr, sigma, iterations };
}
