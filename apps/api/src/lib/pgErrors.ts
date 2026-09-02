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
