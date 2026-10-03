import { sql, type SQL } from "drizzle-orm";
import { intervalMetrics } from "../db/schema/index.js";

/**
 * `isSensorSource` from the shared package, as a condition on a stored
 * reading — the same three cases, so the database and the code cannot
 * disagree about which rows a sensor may write over.
 *
 * A sensor's figure is the one that counts only until the grid provider's
 * arrives for the same interval; from then on the provider's takes
 * precedence. The sensor's is not thrown away — it stays beside it, in
 * `sensor_value_kwh` — but the sync replaces `value_kwh`, and clears a
 * row, only where this is true.
 */
export const isSensorReading: SQL = sql`(${intervalMetrics.source} = 'home_assistant' or ${intervalMetrics.source} like 'ha:%' or ${intervalMetrics.source} like 'derived:%')`;
