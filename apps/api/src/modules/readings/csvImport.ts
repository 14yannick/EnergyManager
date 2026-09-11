import { parse } from "csv-parse/sync";
import { intervalMetricKindSchema, type IntervalMetricKind, type ReadingImportMode } from "@energy-manager/shared";

export interface ParsedMetricRow {
  ts: string; // ISO timestamp
  metricKind: IntervalMetricKind;
  party: string | null; // party NAME (resolved to a party id by the service), null unless metricKind is "consumption"
  valueKwh: number;
}

export interface CsvImportError {
  row: number;
  message: string;
}

export interface CsvParseResult {
  rows: ParsedMetricRow[];
  errors: CsvImportError[];
}

interface RawRow {
  row: number;
  ts: string;
  metricKind: IntervalMetricKind;
  party: string | null;
  value: number;
}

/**
 * Long/narrow format: one row per (timestamp, metric) pair, matching
 * interval_metrics' storage shape 1:1. Columns: timestamp, metric_kind,
 * party, value_kwh. `party` is required iff metric_kind is "consumption"
 * (every other kind is site-level) — it's a party NAME, not an id; the
 * service resolves/creates the party row.
 *
 * In "delta" mode values are already per-interval kWh; in "cumulative" mode
 * values are running meter totals and get diffed against the previous row
 * *within the same (metric_kind, party) series*, sorted by timestamp — the
 * first row of each series becomes the baseline and emits no reading. A
 * decreasing cumulative value (meter reset) is reported as an error and
 * skipped rather than inserted as a negative/garbage delta.
 */
/**
 * Metric kinds that belong to a single participant rather than the site as a
 * whole: what a neighbour took from local PV, and what they drew from the
 * grid. Both need a party; everything else is site-level and must not have one.
 */
const PER_PARTY_KINDS = new Set<IntervalMetricKind>(["consumption", "consumption_grid"]);

export function parseMetricsCsv(csvText: string, mode: ReadingImportMode): CsvParseResult {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const errors: CsvImportError[] = [];
  const rawRows: RawRow[] = [];

  records.forEach((rec, idx) => {
    const rowNum = idx + 2; // header is row 1
    const tsRaw = rec.timestamp;
    const ts = tsRaw ? new Date(tsRaw) : null;
    if (!ts || Number.isNaN(ts.getTime())) {
      errors.push({ row: rowNum, message: `Invalid or missing timestamp: "${tsRaw ?? ""}"` });
      return;
    }

    const kindParsed = intervalMetricKindSchema.safeParse(rec.metric_kind);
    if (!kindParsed.success) {
      errors.push({ row: rowNum, message: `Invalid metric_kind: "${rec.metric_kind ?? ""}"` });
      return;
    }
    const metricKind = kindParsed.data;

    const partyRaw = (rec.party ?? "").trim();
    const needsParty = PER_PARTY_KINDS.has(metricKind);
    if (needsParty && partyRaw === "") {
      errors.push({ row: rowNum, message: `party is required when metric_kind is "${metricKind}"` });
      return;
    }
    if (!needsParty && partyRaw !== "") {
      errors.push({
        row: rowNum,
        message: `party must be blank for metric_kind "${metricKind}"`,
      });
      return;
    }

    const valueRaw = rec.value_kwh;
    const value = valueRaw === undefined || valueRaw === "" ? NaN : Number(valueRaw);
    if (Number.isNaN(value)) {
      errors.push({ row: rowNum, message: `Non-numeric value_kwh: "${valueRaw ?? ""}"` });
      return;
    }
    if (value < 0) {
      errors.push({ row: rowNum, message: `value_kwh must not be negative: ${value}` });
      return;
    }

    rawRows.push({
      row: rowNum,
      ts: ts.toISOString(),
      metricKind,
      party: needsParty ? partyRaw : null,
      value,
    });
  });

  const series = new Map<string, RawRow[]>();
  for (const r of rawRows) {
    const key = `${r.metricKind}|${r.party ?? ""}`;
    const group = series.get(key);
    if (group) group.push(r);
    else series.set(key, [r]);
  }

  const rows: ParsedMetricRow[] = [];
  for (const group of series.values()) {
    group.sort((a, b) => a.ts.localeCompare(b.ts));

    if (mode === "delta") {
      for (const r of group) {
        rows.push({ ts: r.ts, metricKind: r.metricKind, party: r.party, valueKwh: r.value });
      }
      continue;
    }

    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]!;
      const curr = group[i]!;
      const delta = curr.value - prev.value;
      if (delta < 0) {
        errors.push({
          row: curr.row,
          message: "Cumulative value decreased vs. the previous row for this series (meter reset?) — skipped",
        });
        continue;
      }
      rows.push({ ts: curr.ts, metricKind: curr.metricKind, party: curr.party, valueKwh: delta });
    }
  }

  return { rows, errors };
}
