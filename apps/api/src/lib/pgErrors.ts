function code(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code
    : undefined;
}

function cause(err: unknown): unknown {
  return typeof err === "object" && err !== null && "cause" in err
    ? (err as { cause?: unknown }).cause
    : undefined;
}

/**
 * SQLSTATE 23P01 = exclusion_violation (our tariff-period no-overlap constraint).
 * drizzle-orm wraps driver errors in a DrizzleQueryError, which has no `code` of
 * its own — the original PostgresError (which does) is moved to `.cause`.
 */
export function isExclusionViolation(err: unknown): boolean {
  return code(err) === "23P01" || code(cause(err)) === "23P01";
}

/** SQLSTATE 23505 = unique_violation (e.g. a duplicate party name per site). */
export function isUniqueViolation(err: unknown): boolean {
  return code(err) === "23505" || code(cause(err)) === "23505";
}

function constraintOf(err: unknown): string | undefined {
  const pick = (e: unknown) =>
    typeof e === "object" && e !== null && "constraint_name" in e
      ? (e as { constraint_name?: string }).constraint_name
      : undefined;
  return pick(err) ?? pick(cause(err));
}

/**
 * Whether a named constraint is the one that rejected the write.
 *
 * Matched on the constraint name alone rather than on SQLSTATE: a route needs
 * to tell "that name is taken" from "there is already an operator", which
 * share a code, and it should answer for a check constraint the same way it
 * answers for a unique index. A name identifies the rule; the code only says
 * what kind of rule it was.
 */
export function violatedConstraint(err: unknown, name: string): boolean {
  return constraintOf(err) === name;
}
