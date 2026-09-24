import { useLayoutEffect, useState } from "react";

/**
 * The rendered width of an element, kept current as it resizes.
 *
 * For drawings laid out in pixels (see EnergyFlowChart, LiveFlow). Recharts'
 * responsive container does the same job, but hands the size to one of its
 * own charts, not to plain SVG. Zero until the first measurement, so a
 * caller can skip its layout on the very first paint rather than lay out
 * against nothing.
 *
 * Attach `ref` to the element. It is a callback ref rather than a ref
 * object on purpose: an element that mounts later — after a query resolves,
 * say — must be measured when it appears, and an effect keyed on a ref
 * object never learns that it did.
 */
export function useElementWidth(): {
  ref: (element: HTMLElement | null) => void;
  element: HTMLElement | null;
  width: number;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) {
      setWidth(0);
      return;
    }
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next != null) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref: setElement, element, width };
}
