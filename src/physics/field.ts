// Electric and magnetic field inside a multilayer (Byrnes' position-resolved TMM).
// z = 0 at the first interface, z > 0 into the structure. The incident field has |E₀| = 1 and the
// magnetic field is scaled so that a plane wave has |H| = n|E| (i.e. H·Z₀).
import * as X from './complex.ts';
import { c, type C } from './complex.ts';
import { interfaceCoeffs, interfaceOfWaves, nCos, waveOf, type Layer, type Polarization } from './tmm.ts';

export type Complexes = { re: Float64Array; im: Float64Array };
export type Component = 'Ex' | 'Ey' | 'Ez' | 'Hx' | 'Hy' | 'Hz';
export const COMPONENTS: Component[] = ['Ex', 'Ey', 'Ez', 'Hx', 'Hy', 'Hz'];

export type Profile = {
  z: Float64Array;
  layer: Int32Array; // layer index of each sample
  fields: Record<Component, Complexes>;
  E2: Float64Array; // |E|² / |E₀|²
  H2: Float64Array; // |H|² / |H₀|²
  absorption: Float64Array; // absorbed power per nm, as a fraction of the incident power (1/nm)
  boundaries: number[]; // z of every interface
  layerAbs: number[]; // fraction of the incident power absorbed in each layer (exit medium: transmitted)
  R: number;
  T: number;
  decay: number; // 1/e depth of |E|² in the exit medium (nm), Infinity if it propagates
};

// waves: the waves of the layers when some are anisotropic (diagonal tensors), else absent (the isotropic formulas)
type Amplitudes = { q: C[]; kx: C; v: C[]; w: C[]; r: C; t: C; k0: number; n: C[]; n0: number; cos0: number; waves?: ReturnType<typeof waveOf>[] };

// Forward (v) and backward (w) amplitudes at the left edge of every layer (at the interface for the media).
function amplitudes(input: Layer[], lambda: number, theta: number, pol: Polarization): Amplitudes {
  const n = [c(input[0].n.re), ...input.slice(1).map((L) => L.n)];
  const N = n.length;
  const kx = X.mul(n[0], c(Math.sin((theta * Math.PI) / 180)));
  const waves = input.some((L) => L.eps) ? input.map((L, j) => waveOf(L, kx, pol, j === 0)) : undefined;
  const q = waves ? waves.map((x) => x.q) : n.map((nj) => nCos(nj, kx));
  const k0 = (2 * Math.PI) / lambda;
  const coef = n.slice(0, -1).map((_, j) => (waves ? interfaceOfWaves(waves[j], waves[j + 1]) : interfaceCoeffs(pol, n[j], n[j + 1], q[j], q[j + 1])));
  // M_j = (1/t_j,j+1)·diag(e^{−iδ}, e^{iδ})·[[1, r], [r, 1]]
  const Ms = input.map((L, j) => {
    if (j === 0 || j === N - 1) return null;
    const delta = X.mul(q[j], c(k0 * L.d));
    const ed = X.exp(X.mul(c(0, -1), delta));
    const eu = X.exp(X.mul(c(0, 1), delta));
    const it = X.div(c(1), coef[j].t);
    const r = coef[j].r;
    return [X.mul(ed, it), X.mul(X.mul(ed, r), it), X.mul(X.mul(eu, r), it), X.mul(eu, it)] as [C, C, C, C];
  });
  const it0 = X.div(c(1), coef[0].t);
  let M: [C, C, C, C] = [it0, X.mul(coef[0].r, it0), X.mul(coef[0].r, it0), it0];
  for (let j = 1; j < N - 1; j++) M = X.matmul(M, Ms[j]!);
  const r = X.div(M[2], M[0]);
  const t = X.div(c(1), M[0]);
  const v: C[] = new Array(N);
  const w: C[] = new Array(N);
  [v[N - 1], w[N - 1]] = [t, c(0)];
  for (let j = N - 2; j >= 1; j--) {
    const m = Ms[j]!;
    [v[j], w[j]] = [X.add(X.mul(m[0], v[j + 1]), X.mul(m[1], w[j + 1])), X.add(X.mul(m[2], v[j + 1]), X.mul(m[3], w[j + 1]))];
  }
  [v[0], w[0]] = [c(1), r];
  const cos0 = Math.cos((theta * Math.PI) / 180);
  return { q, kx, v, w, r, t, k0, n, n0: n[0].re, cos0, waves };
}

// Field components at distance s from the left edge of layer j.
function fieldAt(a: Amplitudes, j: number, s: number, pol: Polarization) {
  const kz = X.mul(a.q[j], c(a.k0));
  const Ef = X.mul(a.v[j], X.exp(X.mul(c(0, 1), X.mul(kz, c(s)))));
  const Eb = X.mul(a.w[j], X.exp(X.mul(c(0, -1), X.mul(kz, c(s)))));
  const zero = c(0);
  const sum = X.add(Ef, Eb);
  if (pol === 's') return { Ex: zero, Ey: sum, Ez: zero, Hx: X.mul(a.q[j], X.sub(Eb, Ef)), Hy: zero, Hz: X.mul(a.kx, sum) };
  if (a.waves) {
    // Hy = s(Ef + Eb); Ex = Y·s(Ef − Eb) (Y = q/εx); Ez = −(kx/εz)·Hy
    const wv = a.waves[j];
    const Hy = X.mul(wv.s, sum);
    return { Ex: X.mul(X.mul(wv.Y, wv.s), X.sub(Ef, Eb)), Ey: zero, Ez: X.mul(c(-1), X.mul(X.div(a.kx, wv.ez), Hy)), Hx: zero, Hy, Hz: zero };
  }
  const cos = X.div(a.q[j], a.n[j]);
  const sin = X.div(a.kx, a.n[j]);
  return { Ex: X.mul(X.sub(Ef, Eb), cos), Ey: zero, Ez: X.mul(c(-1), X.mul(sum, sin)), Hx: zero, Hy: X.mul(a.n[j], sum), Hz: zero };
}

// Power flux along z as a fraction of the incident flux.
function flux(a: Amplitudes, j: number, s: number, pol: Polarization) {
  const f = fieldAt(a, j, s, pol);
  const Sz = pol === 's' ? -X.mul(f.Ey, X.conj(f.Hx)).re : X.mul(f.Ex, X.conj(f.Hy)).re;
  return Sz / (a.n0 * a.cos0);
}

// Sample positions: the incident medium from −zIn, every finite layer (both edges, so jumps at interfaces
// show), the exit medium up to zOut past the last interface.
export function profileGrid(d: number[], zIn: number, zOut: number, points: number) {
  const segs: { j: number; z0: number; len: number }[] = [];
  let z = 0;
  const N = d.length;
  segs.push({ j: 0, z0: -zIn, len: zIn });
  for (let j = 1; j < N - 1; j++) {
    if (d[j] > 0) segs.push({ j, z0: z, len: d[j] });
    z += d[j];
  }
  segs.push({ j: N - 1, z0: z, len: zOut });
  const total = segs.reduce((s, g) => s + g.len, 0) || 1;
  const zs: number[] = [];
  const js: number[] = [];
  for (const g of segs) {
    const n = Math.max(12, Math.round((points * g.len) / total));
    for (let i = 0; i <= n; i++) {
      zs.push(g.z0 + (g.len * i) / n);
      js.push(g.j);
    }
  }
  return { z: Float64Array.from(zs), layer: Int32Array.from(js), length: z };
}

// Layer of each position on a uniform grid (for maps): right-hand layer at an interface.
export function layerOfZ(d: number[], zs: ArrayLike<number>): Int32Array {
  const starts: number[] = [];
  let z = 0;
  for (let j = 1; j < d.length - 1; j++) {
    starts[j] = z;
    z += d[j];
  }
  return Int32Array.from(zs, (x) => {
    if (x < 0) return 0;
    for (let j = d.length - 2; j >= 1; j--) if (d[j] > 0 && x >= starts[j]) return x >= starts[j] + d[j] ? d.length - 1 : j;
    return d.length - 1;
  });
}

export function fieldProfile(layers: Layer[], lambda: number, theta: number, pol: Polarization, z: ArrayLike<number>, layerOf: ArrayLike<number>): Profile {
  const a = amplitudes(layers, lambda, theta, pol);
  const N = layers.length;
  const start: number[] = new Array(N).fill(0);
  let acc = 0;
  for (let j = 1; j < N - 1; j++) {
    start[j] = acc;
    acc += layers[j].d;
  }
  start[N - 1] = acc;
  const m = z.length;
  const mk = () => ({ re: new Float64Array(m), im: new Float64Array(m) });
  const fields = { Ex: mk(), Ey: mk(), Ez: mk(), Hx: mk(), Hy: mk(), Hz: mk() } as Record<Component, Complexes>;
  const E2 = new Float64Array(m);
  const H2 = new Float64Array(m);
  const absorption = new Float64Array(m);
  const imEps = a.n.map((nj) => X.mul(nj, nj).im);
  // (an anisotropic layer: Im ε of every axis)
  const imEps3 = layers.map((L, j) => (L.eps && j > 0 ? [L.eps.x.im, L.eps.y.im, L.eps.z.im] : null));
  for (let i = 0; i < m; i++) {
    const j = layerOf[i];
    const f = fieldAt(a, j, z[i] - start[j], pol);
    for (const k of COMPONENTS) {
      fields[k].re[i] = f[k].re;
      fields[k].im[i] = f[k].im;
    }
    E2[i] = X.abs2(f.Ex) + X.abs2(f.Ey) + X.abs2(f.Ez);
    H2[i] = (X.abs2(f.Hx) + X.abs2(f.Hy) + X.abs2(f.Hz)) / (a.n0 * a.n0);
    const e3 = imEps3[j];
    absorption[i] = (a.k0 * (e3 ? e3[0] * X.abs2(f.Ex) + e3[1] * X.abs2(f.Ey) + e3[2] * X.abs2(f.Ez) : imEps[j] * E2[i])) / (a.n0 * a.cos0);
  }
  // Absorbed fraction per layer from the flux entering and leaving it.
  const layerAbs = layers.map((L, j) => (j === 0 ? 0 : j === N - 1 ? flux(a, j, 0, pol) : flux(a, j, 0, pol) - flux(a, j, L.d, pol)));
  const kzIm = a.q[N - 1].im * a.k0;
  return {
    z: Float64Array.from(z),
    layer: Int32Array.from(layerOf),
    fields,
    E2,
    H2,
    absorption,
    boundaries: start.slice(1),
    layerAbs,
    R: X.abs2(a.r),
    T: flux(a, N - 1, 0, pol),
    decay: kzIm > 1e-12 ? 1 / (2 * kzIm) : Infinity,
  };
}
