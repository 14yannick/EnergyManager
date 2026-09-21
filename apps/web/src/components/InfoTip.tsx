import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/context";

/**
 * A small ⓘ beside a title, holding the paragraph that used to sit under it.
 *
 * The explanations are worth having and not worth reading every time: once
 * understood, a four-line note under every heading is what the eye has to
 * jump over to reach the figures. Behind a button it is one tap away for the
 * reader who wants it and out of the way for the one who does not.
 *
 * Opens on click, and on hover or focus for a pointer or a keyboard; closes
 * on Escape, on a click elsewhere, or by tapping it again. A real button, so
 * it is reachable without a mouse and announced for what it is.
 *
 * Two things made this flaky in practice, both about the button being a
 * 16×16px target: a mouse that drifts a few pixels between the press and the
 * release — completely normal on a trackpad — lands the release outside the
 * button, so the browser never fires `click` at all; and moving the cursor
 * from the icon down toward the popover to read it crosses a gap the icon
 * itself doesn't cover, firing `mouseleave` before the popover is reached.
 * Fixed the same way most tooltip libraries do: an invisible pseudo-element
 * pads the hit area well past the visible circle, hover state is tracked on
 * the whole wrapper (button *and* popover) rather than the button alone, and
 * closing on leave waits a beat rather than firing the instant the cursor
 * crosses an edge.
 */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    clearCloseTimer();
    setOpen(true);
  };
  // A grace period, not an instant close: enough to cross the gap between
  // the icon and the popover below it without the hover state having to be
  // pixel-perfect, but short enough that it still reads as "closes on leave".
  const closeSoon = () => {
    if (pinned) return;
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  useEffect(() => clearCloseTimer, []);

  // Anchored to the button's left edge, the bubble runs off a phone whenever
  // the button sits past mid-screen. Measured on opening — from an unshifted
  // position, since closing resets it — and pulled back by however much it
  // overhangs, keeping the page's own gutter.
  useLayoutEffect(() => {
    if (!open || !bubble.current) {
      setShift(0);
      return;
    }
    const overhang = bubble.current.getBoundingClientRect().right - (window.innerWidth - 16);
    if (overhang > 0) setShift(-overhang);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      clearCloseTimer();
      setOpen(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="relative inline-flex align-middle"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        aria-label={label ?? t("common.moreInfo")}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        onFocus={openNow}
        onBlur={closeSoon}
        // The visible circle stays 16px; `-inset-2` on this pseudo-element
        // pads the actual hit area out to roughly 32px on every side without
        // changing how the button looks, so a hand that isn't perfectly
        // steady still lands the click.
        className="relative ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 after:absolute after:-inset-2 after:content-[''] hover:border-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          ref={bubble}
          role="tooltip"
          style={{ left: shift }}
          className="absolute top-6 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-normal leading-snug text-slate-600 shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}
