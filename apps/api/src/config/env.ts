import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // z.coerce.boolean() would treat the string "false" as truthy (non-empty
  // string) — compare explicitly instead.
  BKW_SYNC_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  BKW_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  // Home Assistant. Unset simply disables the integration — the rest of the
  // app runs fine without it.
  HA_URL: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\/$/, "")),
  HA_TOKEN: z.string().optional(),
  HA_SYNC_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  HA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  /** How far back each scheduled sync re-reads, to pick up late-arriving statistics. */
  HA_SYNC_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),
});

export const env = envSchema.parse(process.env);
