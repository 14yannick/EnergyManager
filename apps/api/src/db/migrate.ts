import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../config/env.js";
import { sites } from "./schema/index.js";

async function main() {
  const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });

  const existing = await db.select({ id: sites.id }).from(sites).limit(1);
  if (existing.length === 0) {
    console.log("Seeding default site...");
    await db.insert(sites).values({ name: "Home" });
  }

  await migrationClient.end();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
