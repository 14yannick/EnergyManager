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
]);

export const partyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type PartyInput = z.infer<typeof partyInputSchema>;

export const dateRangeQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export const savingsGranularitySchema = z.enum(["daily", "monthly"]);

export const savingsQuerySchema = dateRangeQuerySchema.extend({
  granularity: savingsGranularitySchema.optional(),
});
export type SavingsQuery = z.infer<typeof savingsQuerySchema>;

export const dynamicTariffQuerySchema = dateRangeQuerySchema.extend({
  kind: tariffKindSchema.optional(),
});
export type DynamicTariffQuery = z.infer<typeof dynamicTariffQuerySchema>;
