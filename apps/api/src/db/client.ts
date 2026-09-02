import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

export const queryClient = postgres(env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
