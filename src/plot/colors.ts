// Viridis (sequential, for maps and long curve families) and Tableau 10 (few categorical curves).
const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
const TABLEAU = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const STOPS = VIRIDIS.map(hex);

export function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  return [0, 1, 2].map((k) => Math.round(a[k] + f * (b[k] - a[k]))) as [number, number, number];
}

export const VIRIDIS_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set(viridis(i / 255), i * 3);
  return lut;
})();

export const VIRIDIS_STOPS = VIRIDIS;

// Colour maps of the 2D maps (matplotlib / Google Turbo samples; 'wave' = RdBu reversed, diverging: blue < 0 < red, for
// the real / imaginary parts of fields — its automatic range is symmetric about 0).
export type ColorMapName = 'viridis' | 'inferno' | 'magma' | 'plasma' | 'turbo' | 'wave' | 'gray' | 'grayr';
export const COLOR_MAPS: Record<ColorMapName, { label: string; stops: string[]; diverging?: boolean }> = {
  viridis: { label: 'viridis', stops: VIRIDIS },
  inferno: { label: 'inferno', stops: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'] },
  magma: { label: 'magma', stops: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'] },
  plasma: { label: 'plasma', stops: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'] },
  turbo: { label: 'turbo (rainbow)', stops: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0403'] },
  wave: { label: 'wave (blue–white–red, ± symmetric)', stops: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'], diverging: true },
  gray: { label: 'black → white', stops: ['#000000', '#ffffff'] },
  grayr: { label: 'white → black', stops: ['#ffffff', '#000000'] },
};
// Display settings of a 2D map: colour range, log scale, smoothing, blur, cap (display only, the data are not changed).
export type MapView = { zLim?: [number, number]; zLog?: boolean; smooth?: boolean; blur?: number; cap?: number; capHide?: boolean; cmap?: ColorMapName };

const luts = new Map<string, Uint8Array>();
export function colorLut(name: ColorMapName = 'viridis'): Uint8Array {
  const hit = luts.get(name);
  if (hit) return hit;
  const stops = (COLOR_MAPS[name] ?? COLOR_MAPS.viridis).stops.map(hex);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(x));
    const f = x - j;
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(stops[j][k] + f * (stops[j + 1][k] - stops[j][k]));
  }
  luts.set(name, lut);
  return lut;
}

export function seriesColor(i: number, n: number): string {
  if (n === 1) return 'var(--line)';
  if (n <= TABLEAU.length) return TABLEAU[i];
  const [r, g, b] = viridis((0.9 * i) / (n - 1));
  return `rgb(${r} ${g} ${b})`;
}
