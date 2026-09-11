import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// What <input type="datetime-local"> submits: "YYYY-MM-DDTHH:mm", no timezone
// (interpreted as the site's local time — Europe/Zurich — at the DB layer).
// Seconds are optional since browsers omit them by default.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Expected YYYY-MM-DDTHH:mm");

// HTML inputs left blank submit "" rather than omitting the field, which a plain
// `.optional()` doesn't accept (zod's optional means "undefined", not "empty
// string") — that silently fails validation with no value for the user to fix.
// Treat "" as absent before applying the real (optional) schema.
const optionalWhenBlank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

export const tariffKindSchema = z.enum(["purchase", "feed_in", "neighbor_sell"]);

export const tariffPeriodInputSchema = z
  .object({
    kind: tariffKindSchema,
    startTs: localDateTime,
    endTs: localDateTime,
    rateChfPerKwh: z.number().nonnegative(),
    label: optionalWhenBlank(z.string().trim().min(1).max(200)),
  })
  .refine((v) => v.endTs > v.startTs, {
    message: "endTs must be after startTs",
    path: ["endTs"],
  });
export type TariffPeriodInput = z.infer<typeof tariffPeriodInputSchema>;

export const tariffSurchargeInputSchema = z
  .object({
    kind: tariffKindSchema,
    startTs: localDateTime,
    endTs: localDateTime,
    rateChfPerKwh: z.number().nonnegative(),
    label: z.string().trim().min(1).max(200),
  })
  .refine((v) => v.endTs > v.startTs, {
    message: "endTs must be after startTs",
    path: ["endTs"],
  });
export type TariffSurchargeInput = z.infer<typeof tariffSurchargeInputSchema>;

export const costCategorySchema = z.enum(["battery", "solar"]);

export const costItemInputSchema = z.object({
  category: costCategorySchema,
  label: z.string().trim().min(1).max(200),
  amountChf: z.number(),
  incurredOn: optionalWhenBlank(isoDate),
  notes: optionalWhenBlank(z.string().trim().max(2000)),
});
export type CostItemInput = z.infer<typeof costItemInputSchema>;

export const readingImportModeSchema = z.enum(["delta", "cumulative"]);

export const intervalMetricKindSchema = z.enum([
  "production",
  "export_local",
  "export_grid",
  "import_grid",
  "battery_charge",
  "battery_discharge",
  "consumption",
  "consumption_own",
  "consumption_grid",
]);

export const haGranularitySchema = z.enum(["quarter_hour", "hour"]);

export const haEntityMappingInputSchema = z.object({
  metricKind: intervalMetricKindSchema,
  statisticId: z.string().trim().min(1).max(255),
  enabled: z.boolean().optional().default(true),
});
export type HaEntityMappingInput = z.input<typeof haEntityMappingInputSchema>;

export const billingCategorySchema = z.enum(["energie", "netznutzung", "messung", "abgaben"]);
export const billingAllocationSchema = z.enum(["per_kwh", "per_kwh_total", "pool_shared", "per_participant"]);

export const gridTariffPositionInputSchema = z
  .object({
    category: billingCategorySchema,
    label: z.string().trim().min(1).max(200),
    allocation: billingAllocationSchema,
    rateChf: z.number().nonnegative(),
    validFrom: localDateTime,
    validTo: localDateTime,
    countsInDirectBilling: z.boolean().optional().default(true),
    sortOrder: z.number().int().optional().default(0),
  })
  .refine((v) => v.validTo > v.validFrom, {
    message: "validTo must be after validFrom",
    path: ["validTo"],
  });
export type GridTariffPositionInput = z.input<typeof gridTariffPositionInputSchema>;

export const partyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  reference: optionalWhenBlank(z.string().trim().min(1).max(50)),
  // Each address is validated individually so one typo names itself rather
  // than rejecting the whole list.
  emails: z.array(z.string().trim().email("Not a valid email address")).max(10).optional().default([]),
});
export type PartyInput = z.infer<typeof partyInputSchema>;

export const dateRangeQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

// `kinds` arrives as a comma-separated querystring value ("production,export_grid");
// omitting it exports every metric kind.
export const readingsExportQuerySchema = dateRangeQuerySchema.extend({
  kinds: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.split(",").map((s) => s.trim()) : undefined),
    z.array(intervalMetricKindSchema).min(1).optional(),
  ),
});
export type ReadingsExportQuery = z.infer<typeof readingsExportQuerySchema>;

/**
 * Home Assistant keeps 5-minute statistics for ~10 days and hourly ones
 * indefinitely, so `granularity` decides which is reachable: "quarter_hour"
 * only works inside that recent window, "hour" works for the whole retained
 * history. Omitting the range syncs a recent trailing window.
 */
export const haSyncRequestSchema = z.object({
  from: optionalWhenBlank(isoDate),
  to: optionalWhenBlank(isoDate),
  granularity: haGranularitySchema.optional(),
});
export type HaSyncRequest = z.infer<typeof haSyncRequestSchema>;

export const savingsGranularitySchema = z.enum(["daily", "monthly", "quarterly", "yearly", "overall"]);

export const savingsQuerySchema = dateRangeQuerySchema.extend({
  granularity: savingsGranularitySchema.optional(),
});
export type SavingsQuery = z.infer<typeof savingsQuerySchema>;

export const dynamicTariffQuerySchema = dateRangeQuerySchema.extend({
  kind: tariffKindSchema.optional(),
});
export type DynamicTariffQuery = z.infer<typeof dynamicTariffQuerySchema>;
