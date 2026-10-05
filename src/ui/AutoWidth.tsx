import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Renders its child with the width available in the page (plots are drawn at a given size in px).
export function AutoWidth({ children, max = 1060, min = 280, figure }: { children: (width: number) => ReactNode; max?: number; min?: number; figure?: RefObject<HTMLDivElement | null> }) {
  const own = useRef<HTMLDivElement>(null);
  const ref = figure ?? own;
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // measured at once (a hidden or not yet painted page gets no resize notification until it is drawn)
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return (
    <div ref={ref} className="figure">
      {width > 0 && children(Math.max(min, Math.min(max, width)))}
    </div>
  );
}
