/**
 * The readings CSV, as a file somebody can open: the header the import
 * expects and one made-up row under it.
 *
 * Kept here, beside the metric kinds, so the page that offers it for
 * download and the parser that reads such files share the one text — the
 * parser's tests import it, and fail if the two ever part.
 *
 * The row is a plant reading: what left the meter in one quarter-hour,
 * stamped with its local offset. `party` is empty on purpose — it is only
 * filled for a participant's own consumption.
 */
export const READINGS_CSV_COLUMNS = ["timestamp", "metric_kind", "party", "value_kwh"] as const;

export const READINGS_CSV_TEMPLATE = `${READINGS_CSV_COLUMNS.join(",")}\n2026-01-01T12:00:00+01:00,export,,1.2345\n`;

export const READINGS_CSV_TEMPLATE_FILENAME = "readings_template.csv";
