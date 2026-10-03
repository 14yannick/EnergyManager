import { z } from "zod";
import { PARTY_SENSOR_KINDS } from "./partySensors.js";

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
export const tariffPricingModeSchema = z.enum(["flat", "dynamic"]);

export const tariffPeriodInputSchema = z
  .object({
    kind: tariffKindSchema,
    startTs: localDateTime,
    endTs: localDateTime,
    pricingMode: tariffPricingModeSchema.optional().default("flat"),
    // Blank is meaningful on a dynamic period ("no fallback"), so it has to
    // survive as undefined rather than failing validation — see the
    // optionalWhenBlank note above.
    rateChfPerKwh: optionalWhenBlank(z.coerce.number().nonnegative()),
    label: optionalWhenBlank(z.string().trim().min(1).max(200)),
  })
  .refine((v) => v.endTs > v.startTs, {
    message: "endTs must be after startTs",
    path: ["endTs"],
  })
  // Mirrors the DB check constraint: a flat period with no rate prices nothing.
  .refine((v) => v.pricingMode !== "flat" || v.rateChfPerKwh !== undefined, {
    message: "A flat period needs a rate",
    path: ["rateChfPerKwh"],
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
  })
  // The neighbour-sale rate is the price agreed with the participants, and it
  // is what their invoice charges. A surcharge on it would change the site's
  // revenue figures without changing the bill, so it is refused outright.
  .refine((v) => v.kind !== "neighbor_sell", {
    message: "The neighbour-sale rate is the agreed price; surcharges do not apply to it",
    path: ["kind"],
  });
export type TariffSurchargeInput = z.infer<typeof tariffSurchargeInputSchema>;

/** Only the fields a user can change; name and timezone are fixed for now. */
/**
 * An IBAN as typed, with the spaces people naturally add stripped. Only the
 * shape is checked here; the QR-bill library validates the checksum and
 * decides whether it is a QR-IBAN.
 */
const ibanish = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, "").toUpperCase())
  .refine((v) => /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(v), "Not a valid IBAN");

/**
 * A new site starts as a name and nothing else: its time zone, its sensors
 * and its parties are all set afterwards, under Site administration.
 */
export const siteCreateInputSchema = z.object({
  name: z.string().trim().min(1, "A site needs a name").max(80),
});
export type SiteCreateInput = z.infer<typeof siteCreateInputSchema>;

export const siteUpdateInputSchema = z.object({
  // Omitted entirely: leave the stored value untouched (so saving one
  // section never blanks another). Explicit null: clear it, which leaves
  // the site with no dynamic feed-in rates to sync.
  priceFeedId: z.string().uuid().nullable().optional(),
  // Omitted: untouched, like the rest.
  syncPaused: z.boolean().optional(),
});
export type SiteUpdateInput = z.infer<typeof siteUpdateInputSchema>;

/**
 * A price feed's key: what the series is called everywhere else, so it is
 * kept to what reads the same in a URL, a log line and a database column.
 */
export const priceFeedKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "Lower-case letters, digits and underscores only, e.g. public_bkw_dynamic_feed_in");

export const priceFeedInputSchema = z.object({
  key: priceFeedKeySchema,
  label: optionalWhenBlank(z.string().trim().max(120)).nullable(),
  entityId: z.string().trim().min(1).max(200),
});
export type PriceFeedInput = z.infer<typeof priceFeedInputSchema>;

export const costCategorySchema = z.enum(["battery", "solar"]);

export const costItemInputSchema = z.object({
  /**
   * The participant whose plant the money went into. Required to create an
   * item; an update leaves it where it is, so it is optional here and the
   * route insists on it for a POST.
   */
  partyId: z.string().uuid().optional(),
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
  "inverter_ac",
  "pv_dc",
  "battery_discharge_ac",
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

export const partySensorKindSchema = z.enum(PARTY_SENSOR_KINDS);

/**
 * One sensor of a participant, set by kind: sending a kind again replaces
 * the entity behind it. Whether the participant may have that kind at all
 * is decided against their role and options in the route, where the party
 * is known (see sensorKindAllowed).
 */
export const partySensorInputSchema = z.object({
  kind: partySensorKindSchema,
  entityId: z.string().trim().min(1).max(255),
  inverted: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
});
export type PartySensorInput = z.input<typeof partySensorInputSchema>;

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
  // Postal address for the QR-bill. Lengths follow the QR-bill field limits.
  address: optionalWhenBlank(z.string().trim().max(70)).nullable(),
  buildingNumber: optionalWhenBlank(z.string().trim().max(16)).nullable(),
  zip: optionalWhenBlank(z.string().trim().max(16)).nullable(),
  city: optionalWhenBlank(z.string().trim().max(35)).nullable(),
  country: optionalWhenBlank(z.string().trim().length(2).toUpperCase()),
  /** See PartyRole. The DB permits only one admin party per site. */
  role: z.enum(["rcp_party", "rcp_admin", "rcp_admin_only", "viewer"]).optional(),
  /** Payable-to account for the QR-bill. Only read for an admin party. */
  iban: optionalWhenBlank(ibanish).nullable(),
  /** When this party's membership starts/ends — blank means no bound either way. */
  startDate: optionalWhenBlank(isoDate).nullable(),
  endDate: optionalWhenBlank(isoDate).nullable(),
  /**
   * Feed-in and the two detailed options (see Party). Omitted means
   * untouched on an update and off on a create. What cannot hold — feed-in
   * on a viewer, a detailed option without feed-in — is cleared when the
   * party is saved rather than refused here: changing a role must not fail
   * on an option the form no longer even shows.
   */
  feedIn: z.boolean().optional(),
  detailedRevenue: z.boolean().optional(),
  detailedLiveView: z.boolean().optional(),
  /**
   * The plant's own two figures (see Party). Omitted: untouched — the main
   * form does not carry them, and saving a name must not blank a date.
   * Null: cleared, back to "not stated".
   */
  productionStartDate: isoDate.nullable().optional(),
  // A fraction, not a percentage — the form divides before sending.
  batteryConversionLoss: z.coerce.number().min(0).max(0.9).nullable().optional(),
}).refine((v) => !v.startDate || !v.endDate || v.endDate > v.startDate, {
  message: "End date must be after the start date.",
  path: ["endDate"],
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

export const savingsGranularitySchema = z.enum([
  "hourly",
  "daily",
  "monthly",
  "quarterly",
  "yearly",
  "overall",
]);

export const savingsQuerySchema = dateRangeQuerySchema.extend({
  granularity: savingsGranularitySchema.optional(),
});
export type SavingsQuery = z.infer<typeof savingsQuerySchema>;

/** One calendar day, broken down to the metering interval. */
export const savingsDayQuerySchema = z.object({ date: isoDate });
export type SavingsDayQuery = z.infer<typeof savingsDayQuerySchema>;

export const dynamicTariffQuerySchema = dateRangeQuerySchema.extend({
  kind: tariffKindSchema.optional(),
});
export type DynamicTariffQuery = z.infer<typeof dynamicTariffQuerySchema>;

/** The PDF's fixed labels follow whichever language the admin generated it in. */
export const invoiceLocaleSchema = z.enum(["fr", "de", "en"]);
export type InvoiceLocale = z.infer<typeof invoiceLocaleSchema>;

export const generateInvoicesSchema = dateRangeQuerySchema.extend({
  locale: invoiceLocaleSchema,
  /** Which parties to invoice — the checked rows of the Billing page's preview. */
  partyIds: z.array(z.string()).min(1),
});
export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

export const markInvoicePaidSchema = z.object({ paidAt: isoDate });
export type MarkInvoicePaidInput = z.infer<typeof markInvoicePaidSchema>;
