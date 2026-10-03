import type { ReactNode } from "react";

/**
 * One labelled control with its explanation underneath.
 *
 * The forms on the settings pages each had their own idea of a field — different
 * label colours, three different input widths, hints that wrapped at whatever
 * width the flex row happened to leave. Sharing one component, laid out on
 * `FIELD_GRID`, is what makes a label, an input and a hint line up with their
 * counterparts in the section above or below.
 *
 * Read-only figures pass `readOnly` so the wrapper is not a `<label>` with no
 * control to point at.
 */
export function Field({
  label,
  hint,
  readOnly,
  children,
}: {
  label: string;
  hint?: string;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const Wrapper = readOnly ? "div" : "label";
  return (
    <Wrapper className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-snug text-slate-400">{hint}</span> : null}
    </Wrapper>
  );
}

/** Equal columns, so fields align across every card on the page. */
export const FIELD_GRID = "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:max-w-4xl";

/**
 * A computed figure standing in a field's place. Bordered transparently so it
 * is exactly as tall as an input and the row does not step.
 */
export function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-transparent px-2 py-1.5 text-sm font-semibold text-slate-900">
      {children}
    </p>
  );
}
