// Transfer-matrix method for a planar multilayer (formulation of S. Byrnes, arXiv:1603.02720).
// Convention: ñ = n + i·k, fields ∝ exp(i(kz − ωt)).
import * as X from './complex.ts';
import type { C } from './complex.ts';

export type Polarization = 'p' | 's';

// d in nm; first & last layers are semi-infinite (d ignored). eps: a finite layer with a diagonal permittivity tensor
// (x in the plane of incidence, y normal to it, z the normal of the layers) — the slices of a lamellar rough interface
// (Wiener: the harmonic mean across the lamellae, the arithmetic mean along them); n is then only nominal.
export type Eps3 = { x: C; y: C; z: C };
export type Layer = { n: C; d: number; eps?: Eps3 };

// n_j cosθ_j = sqrt(n_j² − (n₀ sinθ₀)²), branch chosen for a forward-going / decaying wave.
export const nCos = (n: C, kx: C): C => {
  const v = X.sqrt(X.sub(X.mul(n, n), X.mul(kx, kx)));
  // A negligible imaginary part (numerical, or from a trace of absorption) must not flip a propagating
  // wave to the backward branch: decide on Re then.
  const forward = Math.abs(v.im) > 1e-9 * Math.abs(v.re) + 1e-14 ? v.im > 0 : v.re > 0;
  return forward ? v : X.c(-v.re, -v.im);
};

// The wave of a layer for a polarization: q = kz/k0, the admittance Y (s: q; p: q/εx, the ratio Ex/Hy of a forward
// wave) and the scale s of the amplitudes (p: Hy = s·E, s = n for an isotropic layer; s: 1). An isotropic layer:
// q = n cos θ, Y = q (s) or q/n² (p).
export function waveOf(L: Layer, kx: C, pol: Polarization, incident = false): { q: C; Y: C; s: C; ex: C; ez: C } {
  const n = incident ? X.c(L.n.re) : L.n;
  if (!L.eps || incident) {
    const q = nCos(n, kx);
    const e = X.mul(n, n);
    return pol === 's' ? { q, Y: q, s: X.c(1), ex: e, ez: e } : { q, Y: X.div(q, e), s: n, ex: e, ez: e };
  }
  const { x, y, z } = L.eps;
  if (pol === 's') {
    const q = nCos(X.sqrt(y), kx);
    return { q, Y: q, s: X.c(1), ex: x, ez: z };
  }
  // TM in a diagonal tensor: kz² = εx (k0² − kx²/εz); the forward / decaying branch as nCos
  const v = X.sqrt(X.mul(x, X.sub(X.c(1), X.div(X.mul(kx, kx), z))));
  const forward = Math.abs(v.im) > 1e-9 * Math.abs(v.re) + 1e-14 ? v.im > 0 : v.re > 0;
  const q = forward ? v : X.c(-v.re, -v.im);
  return { q, Y: X.div(q, x), s: X.sqrt(x), ex: x, ez: z };
}

// r and t of an interface from the waves on both sides (r = (Yi − Yk)/(Yi + Yk); t of the amplitudes E = H/s).
export const interfaceOfWaves = (a: { Y: C; s: C }, b: { Y: C; s: C }): { r: C; t: C } => {
  const den = X.add(a.Y, b.Y);
  return { r: X.div(X.sub(a.Y, b.Y), den), t: X.div(X.mul(X.mul(X.c(2), a.Y), a.s), X.mul(den, b.s)) };
};

export const interfaceCoeffs = (pol: Polarization, ni: C, nk: C, qi: C, qk: C): { r: C; t: C } => {
  if (pol === 's') {
    const den = X.add(qi, qk);
    return { r: X.div(X.sub(qi, qk), den), t: X.div(X.mul(X.c(2), qi), den) };
  }
  const ai = X.mul(X.mul(nk, nk), qi);
  const ak = X.mul(X.mul(ni, ni), qk);
  const den = X.add(ai, ak);
  return { r: X.div(X.sub(ai, ak), den), t: X.div(X.mul(X.c(2), X.mul(X.mul(ni, nk), qi)), den) };
};

// The incident medium is taken as lossless (Re ñ only): R and T are only defined for a
// non-absorbing incident medium, and a trace of k there would corrupt the wave branches.
// Byrnes' transfer matrices M = S₀₁ · Π (P_j · S_j,j+1), S = (1/t)[[1, r], [r, 1]], P = diag(e^{−iδ}, e^{iδ}), written with
// real arithmetic (no complex objects: this is the inner loop of every Compute TMM, tolerance sample and optimizer run).
export function tmmPoint(input: Layer[], lambdaNm: number, thetaDeg: number, pol: Polarization) {
  if (input.some((L) => L.eps)) return tmmGeneral(input, lambdaNm, thetaDeg, pol);
  const N = input.length;
  const n0 = input[0].n.re;
  const kx = n0 * Math.sin((thetaDeg * Math.PI) / 180);
  const kx2 = kx * kx;
  const k0 = (2 * Math.PI) / lambdaNm;
  const nr = new Float64Array(N);
  const ni = new Float64Array(N);
  const qr = new Float64Array(N);
  const qi = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const a = j === 0 ? n0 : input[j].n.re;
    const b = j === 0 ? 0 : input[j].n.im;
    nr[j] = a;
    ni[j] = b;
    // q = n cos θ = √(n² − kx²), principal root, then the forward / decaying branch (as nCos)
    const wr = a * a - b * b - kx2;
    const wi = 2 * a * b;
    const r = Math.hypot(wr, wi);
    // the smaller part from the larger (no cancellation for a trace of absorption), as X.sqrt
    let vr: number, vi: number;
    if (r === 0) vr = vi = 0;
    else if (wr >= 0) {
      vr = Math.sqrt((r + wr) / 2);
      vi = wi / (2 * vr);
    } else {
      vi = Math.sqrt((r - wr) / 2);
      vr = Math.abs(wi) / (2 * vi);
      if (wi < 0) vi = -vi;
    }
    const forward = Math.abs(vi) > 1e-9 * Math.abs(vr) + 1e-14 ? vi > 0 : vr > 0;
    if (!forward) {
      vr = -vr;
      vi = -vi;
    }
    qr[j] = vr;
    qi[j] = vi;
  }
  // interface i → i+1: r, t into (rr, ri, tr, ti)
  let rr = 0, ri = 0, tr = 0, ti = 0;
  const iface = (i: number) => {
    const k = i + 1;
    let ar: number, ai: number, br: number, bi: number, numr: number, numi: number;
    if (pol === 's') {
      ar = qr[i]; ai = qi[i]; br = qr[k]; bi = qi[k];
      numr = 2 * qr[i]; numi = 2 * qi[i];
    } else {
      // a_i = n_k² q_i, a_k = n_i² q_k; t numerator 2 n_i n_k q_i
      const nk2r = nr[k] * nr[k] - ni[k] * ni[k], nk2i = 2 * nr[k] * ni[k];
      const ni2r = nr[i] * nr[i] - ni[i] * ni[i], ni2i = 2 * nr[i] * ni[i];
      ar = nk2r * qr[i] - nk2i * qi[i]; ai = nk2r * qi[i] + nk2i * qr[i];
      br = ni2r * qr[k] - ni2i * qi[k]; bi = ni2r * qi[k] + ni2i * qr[k];
      const pr = nr[i] * nr[k] - ni[i] * ni[k], pi = nr[i] * ni[k] + ni[i] * nr[k];
      numr = 2 * (pr * qr[i] - pi * qi[i]); numi = 2 * (pr * qi[i] + pi * qr[i]);
    }
    const dr = ar + br, di = ai + bi, dd = dr * dr + di * di;
    const sr = ar - br, si = ai - bi;
    rr = (sr * dr + si * di) / dd;
    ri = (si * dr - sr * di) / dd;
    tr = (numr * dr + numi * di) / dd;
    ti = (numi * dr - numr * di) / dd;
  };
  // M = S₀₁ = (1/t)[[1, r], [r, 1]]
  iface(0);
  let tt2 = tr * tr + ti * ti;
  let itr = tr / tt2, iti = -ti / tt2; // 1/t
  let m00r = itr, m00i = iti;
  let m01r = rr * itr - ri * iti, m01i = rr * iti + ri * itr;
  let m10r = m01r, m10i = m01i;
  let m11r = itr, m11i = iti;
  for (let j = 1; j < N - 1; j++) {
    const dlr = k0 * input[j].d * qr[j];
    const dli = k0 * input[j].d * qi[j];
    const c = Math.cos(dlr), s = Math.sin(dlr);
    const ep = Math.exp(dli), em = Math.exp(-dli);
    // e^{−iδ} = e^{δi}(cos − i sin), e^{iδ} = e^{−δi}(cos + i sin)
    const edr = ep * c, edi = -ep * s;
    const eur = em * c, eui = em * s;
    // A = M · P
    const a00r = m00r * edr - m00i * edi, a00i = m00r * edi + m00i * edr;
    const a01r = m01r * eur - m01i * eui, a01i = m01r * eui + m01i * eur;
    const a10r = m10r * edr - m10i * edi, a10i = m10r * edi + m10i * edr;
    const a11r = m11r * eur - m11i * eui, a11i = m11r * eui + m11i * eur;
    iface(j);
    tt2 = tr * tr + ti * ti;
    itr = tr / tt2;
    iti = -ti / tt2;
    // M = A · (1/t)[[1, r], [r, 1]]
    const b00r = a00r + (a01r * rr - a01i * ri), b00i = a00i + (a01r * ri + a01i * rr);
    const b01r = (a00r * rr - a00i * ri) + a01r, b01i = (a00r * ri + a00i * rr) + a01i;
    const b10r = a10r + (a11r * rr - a11i * ri), b10i = a10i + (a11r * ri + a11i * rr);
    const b11r = (a10r * rr - a10i * ri) + a11r, b11i = (a10r * ri + a10i * rr) + a11i;
    m00r = b00r * itr - b00i * iti; m00i = b00r * iti + b00i * itr;
    m01r = b01r * itr - b01i * iti; m01i = b01r * iti + b01i * itr;
    m10r = b10r * itr - b10i * iti; m10i = b10r * iti + b10i * itr;
    m11r = b11r * itr - b11i * iti; m11i = b11r * iti + b11i * itr;
  }
  // r = M10 / M00, t = 1 / M00
  const md = m00r * m00r + m00i * m00i;
  const rOutR = (m10r * m00r + m10i * m00i) / md;
  const rOutI = (m10i * m00r - m10r * m00i) / md;
  const tOutR = m00r / md;
  const tOutI = -m00i / md;
  const t2 = tOutR * tOutR + tOutI * tOutI;
  const f = N - 1;
  let T: number;
  if (pol === 's') T = (t2 * qr[f]) / qr[0];
  else {
    // Re(n · conj(q / n)) for the exit and the incident media
    const reNConjQoverN = (j: number) => {
      const n2 = nr[j] * nr[j] + ni[j] * ni[j];
      const cr = (qr[j] * nr[j] + qi[j] * ni[j]) / n2; // q / n
      const ci = (qi[j] * nr[j] - qr[j] * ni[j]) / n2;
      return nr[j] * cr + ni[j] * ci; // Re(n · conj(q/n))
    };
    T = (t2 * reNConjQoverN(f)) / reNConjQoverN(0);
  }
  const R = rOutR * rOutR + rOutI * rOutI;
  // (r and t: the complex amplitudes, as their real and imaginary parts)
  return { R, T, A: 1 - R - T, phir: Math.atan2(rOutI, rOutR), phit: Math.atan2(tOutI, tOutR), rRe: rOutR, rIm: rOutI, tRe: tOutR, tIm: tOutI };
}

// The same with anisotropic (diagonal) layers: complex arithmetic, the interfaces from the waves of the layers. The media
// stay isotropic, so R, T and the amplitudes keep their meaning.
function tmmGeneral(input: Layer[], lambdaNm: number, thetaDeg: number, pol: Polarization) {
  const N = input.length;
  const n0 = input[0].n.re;
  const kx = X.c(n0 * Math.sin((thetaDeg * Math.PI) / 180));
  const k0 = (2 * Math.PI) / lambdaNm;
  const w = input.map((L, j) => waveOf(L, kx, pol, j === 0));
  const S = (i: number) => {
    const { r, t } = interfaceOfWaves(w[i], w[i + 1]);
    const it = X.div(X.c(1), t);
    return [it, X.mul(r, it), X.mul(r, it), it] as X.M2;
  };
  let M = S(0);
  for (let j = 1; j < N - 1; j++) {
    const delta = X.mul(w[j].q, X.c(k0 * input[j].d));
    const ed = X.exp(X.mul(X.c(0, -1), delta));
    const eu = X.exp(X.mul(X.c(0, 1), delta));
    M = X.matmul(X.matmul(M, [ed, X.c(0), X.c(0), eu]), S(j));
  }
  const r = X.div(M[2], M[0]);
  const t = X.div(X.c(1), M[0]);
  const f = N - 1;
  const R = X.abs2(r);
  const nf = input[f].n;
  const qf = w[f].q;
  const q0 = w[0].q.re;
  // T: s, Re(q_f)/q_0; p, Re(n_f · conj(q_f/n_f))/q_0 (the incident medium lossless)
  const T = pol === 's' ? (X.abs2(t) * qf.re) / q0 : (X.abs2(t) * X.mul(nf, X.conj(X.div(qf, nf))).re) / q0;
  return { R, T, A: 1 - R - T, phir: Math.atan2(r.im, r.re), phit: Math.atan2(t.im, t.re), rRe: r.re, rIm: r.im, tRe: t.re, tIm: t.im };
}
