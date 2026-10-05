// Plain text / CSV tables of optical constants.
import { HC_EV_NM, type Table } from './materials.ts';
import { c, sqrt } from './complex.ts';

export type TableUnit = 'nm' | 'um' | 'eV';
export type TableColumns = 'nk' | 'n' | 'eps';

// Numeric rows of a pasted table or CSV; header and comment lines are skipped.
export function parseTable(text: string, unit: TableUnit, cols: TableColumns): { table: Table; range: [number, number] } | string {
  const need = cols === 'n' ? 2 : 3;
  const data = text
    .split(/\r?\n/)
    .map((l) => l.trim().split(/[\s,;\t]+/).filter(Boolean).map(Number))
    .filter((r) => r.length >= need && r.slice(0, need).every(Number.isFinite));
  if (data.length < 1) return `No rows with ${need} numeric columns found.`;
  const toUm = (x: number) => (unit === 'nm' ? x / 1000 : unit === 'um' ? x : HC_EV_NM / 1000 / x);
  const pts = data.map((r) => {
    const l = toUm(r[0]);
    if (cols === 'eps') {
      const n = sqrt(c(r[1], r[2])); // n + ik = √ε (principal root, no cancellation for a small ε₂ or a metal)
      return [l, n.re, n.im];
    }
    return [l, r[1], cols === 'nk' ? r[2] : 0];
  });
  if (pts.some((p) => !(p[0] > 0))) return 'Wavelengths/energies must be > 0.';
  pts.sort((a, b) => a[0] - b[0]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0]);
  const table = { lambda: uniq.map((p) => p[0]), n: uniq.map((p) => p[1]), k: uniq.map((p) => p[2]) };
  return { table, range: [table.lambda[0] * 1000, table.lambda[table.lambda.length - 1] * 1000] };
}
