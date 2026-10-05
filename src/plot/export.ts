// Figure export: SVG (with resolved theme colours), PNG, and CSV.

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-size',
  'font-family',
  'font-weight',
  'dominant-baseline',
  'text-anchor',
];

export function download(content: Blob | string, filename: string, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Standalone SVG of a figure container (an <svg>, optionally over a <canvas> as in the 2D map).
export function figureSvg(container: HTMLElement): { svg: string; width: number; height: number } | null {
  const src = container.querySelector('svg');
  if (!src) return null;
  const width = Number(src.getAttribute('width'));
  const height = Number(src.getAttribute('height'));
  const clone = src.cloneNode(true) as SVGSVGElement;
  const a = src.querySelectorAll('*');
  const b = clone.querySelectorAll('*');
  a.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    (b[i] as SVGElement).setAttribute('style', style);
    (b[i] as SVGElement).removeAttribute('class');
  });
  // Interaction overlays are not part of the figure.
  clone.querySelectorAll('[data-export="skip"]').forEach((el) => el.remove());
  const ns = 'http://www.w3.org/2000/svg';
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', getComputedStyle(container).getPropertyValue('--panel') || '#fff');
  const canvas = container.querySelector('canvas');
  if (canvas) {
    const img = document.createElementNS(ns, 'image');
    img.setAttribute('href', canvas.toDataURL('image/png'));
    img.setAttribute('x', canvas.style.left);
    img.setAttribute('y', canvas.style.top);
    img.setAttribute('width', canvas.style.width);
    img.setAttribute('height', canvas.style.height);
    img.setAttribute('preserveAspectRatio', 'none');
    clone.insertBefore(img, clone.firstChild);
  }
  clone.insertBefore(bg, clone.firstChild);
  clone.setAttribute('xmlns', ns);
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return { svg: new XMLSerializer().serializeToString(clone), width, height };
}

export function exportSvg(container: HTMLElement, name: string) {
  const f = figureSvg(container);
  if (f) download(f.svg, `${name}.svg`, 'image/svg+xml');
}

export function exportPng(container: HTMLElement, name: string, scale = 3) {
  const f = figureSvg(container);
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = f.width * scale;
    cv.height = f.height * scale;
    const ctx = cv.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    cv.toBlob((b) => b && download(b, `${name}.png`));
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.svg)}`;
}

const cell = (v: string | number) => (typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function exportCsv(header: string[], rows: (string | number)[][], name: string) {
  download([header, ...rows].map((r) => r.map(cell).join(',')).join('\n'), `${name}.csv`, 'text/csv');
}
