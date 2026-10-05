// Small arithmetic expression compiler for custom metrics (no eval; from spr-forge, names may hold dots): numbers,
// variables, + − * / ^, parentheses, unary minus and the functions below.
export type Compiled = { fn: (vars: Record<string, number>) => number; names: string[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  // for the computed quantities: phases and moduli of the complex amplitudes, angles
  atan2: Math.atan2,
  hypot: Math.hypot,
  cos: Math.cos,
  sin: Math.sin,
  tan: Math.tan,
  deg: (r: number) => (r * 180) / Math.PI,
  rad: (d: number) => (d * Math.PI) / 180,
  arg: (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI, // degrees
  mag: Math.hypot,
};
export const FUNCTION_NAMES = Object.keys(FUNCS);

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      if (!m) throw new Error(`Bad number at ${i + 1}`);
      out.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w.]*/.exec(src.slice(i))!; // names may hold dots: res.width
      out.push({ k: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/^(),·×−'.includes(c)) {
      out.push({ k: 'op', v: c === '·' || c === '×' ? '*' : c === '−' ? '-' : c });
      i++;
    } else throw new Error(`Unexpected “${c}” at ${i + 1}`);
  }
  return out;
}

type F = (v: Record<string, number>) => number;

export function compile(src: string): Compiled | string {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch (e) {
    return (e as Error).message;
  }
  if (!toks.length) return 'Enter an expression, e.g. sens.S / res.width';
  let p = 0;
  const names = new Set<string>();
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected “${v}”`);
    p++;
  };
  // sum := term (('+'|'-') term)*; term := unary (('*'|'/') unary)*; unary := '-' unary | power; power := atom ('^' unary)?
  const sum = (): F => {
    let f = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const a = f;
      const b = term();
      f = op === '+' ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
    return f;
  };
  const term = (): F => {
    let f = unary();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      const a = f;
      const b = unary();
      f = op === '*' ? (v) => a(v) * b(v) : (v) => a(v) / b(v);
    }
    return f;
  };
  const unary = (): F => {
    if (isOp('-')) {
      p++;
      const a = unary();
      return (v) => -a(v);
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): F => {
    const a = atom();
    if (isOp('^')) {
      p++;
      const b = unary();
      return (v) => a(v) ** b(v);
    }
    return a;
  };
  const atom = (): F => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end of the expression');
    if (t.k === 'num') return () => t.v;
    if (t.k === 'op' && t.v === '(') {
      const f = sum();
      expect(')');
      return f;
    }
    if (t.k === 'id') {
      if (isOp('(')) {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`Unknown function “${t.v}”`);
        p++;
        const args: F[] = [];
        if (!isOp(')')) {
          args.push(sum());
          while (isOp(',')) {
            p++;
            args.push(sum());
          }
        }
        expect(')');
        return (v) => fn(...args.map((a) => a(v)));
      }
      if (t.v === 'pi') return () => Math.PI;
      names.add(t.v);
      return (v) => (t.v in v ? v[t.v] : NaN);
    }
    throw new Error(`Unexpected “${t.v}”`);
  };
  try {
    const fn = sum();
    if (p < toks.length) throw new Error(`Unexpected “${toks[p].v}”`);
    return { fn, names: [...names] };
  } catch (e) {
    return (e as Error).message;
  }
}
