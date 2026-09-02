/** Postgres `numeric` columns come back as strings from postgres-js; convert at the edge. */
export function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}
