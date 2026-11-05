/**
 * Tooltips that close when a finger lands elsewhere, as they do when a mouse
 * moves away.
 *
 * Every chart and flow picture in the app closes its tooltip on "mouse
 * leave". A mouse sends that the moment it moves off; a finger does not. A
 * phone only fires mouse events for a tap on something clickable, so a tap
 * on a chart opened its tooltip and a tap on the page around it left it
 * there, covering the figures, until the chart itself was touched again.
 *
 * So the leave is sent here: the element last touched is told the pointer
 * went to the one touched now, with a native `mouseout` naming the new
 * element as where it went. React turns that into `onMouseLeave` for every
 * element between the two — the chart's wrapper included when the new touch
 * is outside it — exactly the events a mouse moving across would raise.
 * Touching another point of the same chart leaves its wrapper out, so its
 * tooltip just moves.
 *
 * Installed once for the document; listens passively, so scrolling is
 * untouched.
 */
let lastTouched: Element | null = null;
let installed = false;

export function installTouchLeave(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "touchstart",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const previous = lastTouched;
      lastTouched = target;
      if (!previous || !target || previous === target || !previous.isConnected) return;
      previous.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, relatedTarget: target }));
    },
    { capture: true, passive: true },
  );
}
