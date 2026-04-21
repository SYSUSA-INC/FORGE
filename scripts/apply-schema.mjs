import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Check .env.local or export it.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

await client.connect();
console.log("Connected to database.");

const dir = "drizzle";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No .sql files found in drizzle/");
  process.exit(1);
}

let totalStatements = 0;
let skippedStatements = 0;

for (const file of files) {
  const path = join(dir, file);
  const sql = readFileSync(path, "utf-8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`\nApplying ${file} (${statements.length} statements)...`);

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      totalStatements++;
    } catch (e) {
      if (
        e.code === "42P07" ||
        e.code === "42710" ||
        e.code === "42701" ||
        e.code === "42P06"
      ) {
        skippedStatements++;
        console.log(`  skip (already exists): ${e.message}`);
        continue;
      }
      console.error(`  failed statement:\n${stmt}\n`);
      throw e;
    }
  }
  console.log(`  done.`);
}

await client.end();

console.log(
  `\nSchema sync complete. Applied ${totalStatements}, skipped ${skippedStatements} (already existed).`,
);
