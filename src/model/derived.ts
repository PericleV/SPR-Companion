// Computed quantities: formulas over the computed fields (R, T, A, phiR, phiT, rRe, rIm, tRe, tIm), the values of the
// axes (lambda, theta, the swept parameters by their ids) and the quantities above them, e.g.
// arg(rRe, rIm), mag(tRe, tIm)^2, 1 - R - T, R / T. They become fields of the data like the others.
import { compile } from '../engine/expr.ts';
import type { Axis } from '../engine/types.ts';

export type Derived = { id: string; name: string; expr: string; unit: string };

export const derivedNameOk = (name: string) => /^[A-Za-z_]\w*$/.test(name);

// The derived fields over a dataset (axes row-major, fields of the same size); errors by name.
export function computeDerived(derived: Derived[], axes: Axis[], fields: Record<string, ArrayLike<number>>, size: number): { fields: Record<string, Float64Array>; errors: Record<string, string> } {
  const out: Record<string, Float64Array> = {};
  const errors: Record<string, string> = {};
  const sizes = axes.map((a) => a.values.length);
  const known = new Set([...Object.keys(fields), ...axes.map((a) => a.id)]);
  for (const d of derived) {
    if (!derivedNameOk(d.name)) {
      errors[d.name] = 'The name must be letters, digits and _ (not starting with a digit).';
      continue;
    }
    if (known.has(d.name)) {
      errors[d.name] = 'This name is taken.';
      continue;
    }
    const c = compile(d.expr);
    if (typeof c === 'string') {
      errors[d.name] = c;
      continue;
    }
    const missing = c.names.filter((n) => !known.has(n));
    if (missing.length) {
      errors[d.name] = `Unknown: ${missing.join(', ')}`;
      continue;
    }
    const arr = new Float64Array(size);
    const vars: Record<string, number> = {};
    const idx = sizes.map(() => 0);
    for (let k = 0; k < size; k++) {
      // the axis values of point k
      let rem = k;
      for (let i = sizes.length - 1; i >= 0; i--) {
        idx[i] = rem % sizes[i];
        rem = Math.floor(rem / sizes[i]);
      }
      axes.forEach((a, i) => (vars[a.id] = a.values[idx[i]]));
      for (const n of c.names) if (n in fields) vars[n] = fields[n][k];
      for (const n of c.names) if (n in out) vars[n] = out[n][k];
      arr[k] = c.fn(vars);
    }
    out[d.name] = arr;
    known.add(d.name);
  }
  return { fields: out, errors };
}
