// Minimal complex arithmetic for the TMM solver.
export type C = { re: number; im: number };

export const c = (re: number, im = 0): C => ({ re, im });
export const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
export const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
export const mul = (a: C, b: C): C =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const conj = (a: C): C => c(a.re, -a.im);
export const abs2 = (a: C): number => a.re * a.re + a.im * a.im;
export const arg = (a: C): number => Math.atan2(a.im, a.re);
export const exp = (a: C): C => {
  const m = Math.exp(a.re);
  return c(m * Math.cos(a.im), m * Math.sin(a.im));
};
// Principal root. The smaller part from the larger (x / 2·larger): √((r − re)/2) alone cancels when |im| ≪ |re| (a trace of
// absorption, k ~ 1e-8, came out 0 or doubled).
export const sqrt = (a: C): C => {
  const r = Math.hypot(a.re, a.im);
  if (r === 0) return c(0, 0);
  if (a.re >= 0) {
    const re = Math.sqrt((r + a.re) / 2);
    return c(re, a.im / (2 * re));
  }
  const im = Math.sqrt((r - a.re) / 2);
  return c(Math.abs(a.im) / (2 * im), a.im < 0 ? -im : im);
};

// 2x2 complex matrix stored row-major: [m00, m01, m10, m11]
export type M2 = [C, C, C, C];

export const matmul = (a: M2, b: M2): M2 => [
  add(mul(a[0], b[0]), mul(a[1], b[2])),
  add(mul(a[0], b[1]), mul(a[1], b[3])),
  add(mul(a[2], b[0]), mul(a[3], b[2])),
  add(mul(a[2], b[1]), mul(a[3], b[3])),
];
