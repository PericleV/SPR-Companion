// What a measuring instrument does to computed reflectance curves (after SPR Forge's engine/instrument.ts): the finite
// angular spread of the beam and the spectral width of the source blur them (a convolution along the scan: θ for an
// angular scan, λ for a spectral one), and the detector adds noise. The noise model follows Piliarik & Homola, Opt.
// Express 17, 16505 (2009): shot noise of the detected light, additive (thermal / read-out / dark) noise, fluctuations
// of the source intensity, averaging of K scans and the ADC quantization.
import { rng } from './optimize.ts';

export type InstrumentSettings = {
  spreadOn: boolean;
  spread: number; // ° (σ or ± half-angle) or NA, by spreadShape
  spreadShape: 'gauss' | 'uniform' | 'na';
  bandOn: boolean;
  band: number; // nm FWHM
  noise: boolean;
  noiseAdd: number; // σ, units of R
  noiseShot: number; // photoelectrons at R = 1 (0 = off)
  noiseSource: number; // % per scan
  noiseAvg: number; // scans averaged
  noiseBits: number; // ADC bits (0 = off)
};
export const defaultInstrument = (): InstrumentSettings => ({ spreadOn: false, spread: 0.05, spreadShape: 'gauss', bandOn: false, band: 1, noise: false, noiseAdd: 0.001, noiseShot: 0, noiseSource: 0, noiseAvg: 1, noiseBits: 0 });

export type Instrument = {
  spread: number; // angular spread of the beam, ° (0 = none); its meaning set by `shape`
  shape: 'gauss' | 'uniform' | 'na'; // Gaussian σ; uniform ± half-angle; NA: uniform ± asin(NA)
  band: number; // spectral width of the source, nm FWHM (Gaussian; 0 = none)
  add: number; // additive noise σ (thermal / read-out / dark), in units of R (full scale = 1)
  shot: number; // detected photoelectrons at R = 1 per point and scan (0 = no shot noise)
  source: number; // relative σ of the source intensity per scan (0.001 = 0.1 %)
  avg: number; // scans averaged
  bits: number; // ADC resolution over the full scale R = 1 (0 = not quantized)
};

// The half-angle (σ for a Gaussian) of the angular spread, in degrees.
export const spreadDeg = (i: Instrument) => (i.shape === 'na' ? (Math.asin(Math.min(1, Math.max(0, i.spread))) * 180) / Math.PI : i.spread);
export const blurs = (i: Instrument) => spreadDeg(i) > 0 || i.band > 0;
export const noisy = (i: Instrument) => i.add > 0 || i.shot > 0 || i.source > 0 || i.bits > 0;

// The instrument of the settings for a scan along θ or λ (null when it does nothing): the angular spread blurs an
// angular scan, the source bandwidth a spectral one (the other one would need a computed range of its own).
export function instrumentOf(s: InstrumentSettings, along: 'theta' | 'lambda'): Instrument | null {
  const i: Instrument = {
    spread: s.spreadOn && along === 'theta' ? s.spread : 0,
    shape: s.spreadShape,
    band: s.bandOn && along === 'lambda' ? s.band : 0,
    add: s.noise ? s.noiseAdd : 0,
    shot: s.noise ? s.noiseShot : 0,
    source: s.noise ? s.noiseSource / 100 : 0,
    avg: s.noise ? Math.max(1, Math.round(s.noiseAvg)) : 1,
    bits: s.noise ? s.noiseBits : 0,
  };
  return blurs(i) || noisy(i) ? i : null;
}

// What the settings ask for but the scan cannot do, and a grid too coarse for the blur.
export function instrumentWarnings(s: InstrumentSettings, along: 'theta' | 'lambda', xs: number[]): string[] {
  const w: string[] = [];
  if (s.spreadOn && along !== 'theta') w.push('The angular spread of the beam blurs an angular scan only: it is not applied to this spectral scan.');
  if (s.bandOn && along !== 'lambda') w.push('The source bandwidth blurs a spectral scan only: it is not applied to this angular scan.');
  const i = instrumentOf(s, along);
  if (i && xs.length > 1) {
    const step = Math.abs(xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    const sp = spreadDeg(i);
    const width = along === 'theta' ? (i.shape === 'gauss' ? sp : sp / 2) : i.band / 2.3548;
    if (width > 0 && step > width) w.push(`The ${along === 'theta' ? 'angular spread' : 'source bandwidth'} (${+width.toPrecision(3)} ${along === 'theta' ? '°' : 'nm'}) is finer than the scan step (${+step.toPrecision(3)}): compute more points for an accurate convolution.`);
  }
  return w;
}

// Kernel nodes (offset, weight) of the convolution.
function kernel(kind: 'gauss' | 'uniform', w: number): [number, number][] {
  const K = 41;
  if (kind === 'uniform') return Array.from({ length: K }, (_, k) => [w * (-1 + (2 * k + 1) / K), 1]);
  return Array.from({ length: K }, (_, k) => {
    const u = -4 + (8 * k) / (K - 1);
    return [u * w, Math.exp(-0.5 * u * u)];
  });
}

// One curve (ys over ascending or descending xs) convolved with the kernel: y linear between the samples, the part of
// the kernel outside the computed range left out (weights renormalized).
function convolve(xs: ArrayLike<number>, ys: ArrayLike<number>, ker: [number, number][]): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  const asc = xs[n - 1] >= xs[0];
  const v = (i: number) => (asc ? xs[i] : xs[n - 1 - i]);
  const at = (x: number) => {
    if (x < v(0) || x > v(n - 1)) return NaN;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (v(m) <= x) lo = m;
      else hi = m;
    }
    const [i0, i1] = asc ? [lo, hi] : [n - 1 - lo, n - 1 - hi];
    const t = xs[i1] === xs[i0] ? 0 : (x - xs[i0]) / (xs[i1] - xs[i0]);
    return ys[i0] * (1 - t) + ys[i1] * t;
  };
  for (let i = 0; i < n; i++) {
    let sw = 0;
    let sy = 0;
    for (const [u, w] of ker) {
      const y = at(xs[i] + u);
      if (Number.isFinite(y)) {
        sw += w;
        sy += w * y;
      }
    }
    out[i] = sw > 0 ? sy / sw : ys[i];
  }
  return out;
}

// The curves as measured: `curves` holds consecutive curves of xs.length points each; every one is blurred, then gets
// the detector noise of realization `seed` (the same seed, the same noise; one source fluctuation per scan).
export function measure(curves: Float64Array, xs: ArrayLike<number>, inst: Instrument, seed: number): Float64Array {
  const n = xs.length;
  const out = Float64Array.from(curves);
  const count = n ? curves.length / n : 0;
  const s = spreadDeg(inst);
  const kers = [...(s > 0 ? [kernel(inst.shape === 'gauss' ? 'gauss' : 'uniform', s)] : []), ...(inst.band > 0 ? [kernel('gauss', inst.band / 2.3548)] : [])];
  if (kers.length)
    for (let c = 0; c < count; c++) {
      let f: ArrayLike<number> = out.subarray(c * n, (c + 1) * n);
      for (const k of kers) f = convolve(xs, f, k);
      out.set(f as Float64Array, c * n);
    }
  if (!noisy(inst)) return out;
  const rand = rng((seed * 7919 + 104729 + 13) >>> 0);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const K = Math.max(1, Math.round(inst.avg));
  const lsb = inst.bits > 0 ? 2 ** -Math.round(inst.bits) : 0;
  // one scan of a point: source fluctuation (the scan's ε), shot and additive noise, quantization
  const scan = (y: number, eps: number) => {
    const yl = y * (1 + eps);
    let v = yl + (inst.shot > 0 ? Math.sqrt(Math.max(0, yl) / inst.shot) * gauss() : 0) + inst.add * gauss();
    if (lsb) v = Math.round(v / lsb) * lsb;
    return v;
  };
  for (let c = 0; c < count; c++) {
    const eps = Array.from({ length: lsb ? K : 1 }, () => inst.source * gauss());
    for (let i = c * n; i < (c + 1) * n; i++) {
      const y = out[i];
      if (!Number.isFinite(y)) continue;
      if (lsb) {
        // quantized scans averaged one by one (the noise dithers the quantization)
        let sum = 0;
        for (let j = 0; j < K; j++) sum += scan(y, eps[j]);
        out[i] = sum / K;
      } else {
        // the average of K scans: every random part divided by √K
        const yl = y * (1 + eps[0] / Math.sqrt(K));
        out[i] = yl + ((inst.shot > 0 ? Math.sqrt(Math.max(0, yl) / inst.shot) : 0) * gauss() + inst.add * gauss()) / Math.sqrt(K);
      }
    }
  }
  return out;
}
