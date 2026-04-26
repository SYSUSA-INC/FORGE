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

function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    const databaseName = u.pathname.replace(/^\//, "") || "(default)";
    const host = u.hostname;
    const user = u.username || "(no user)";
    // Neon hosts look like: ep-misty-water-12345.us-east-2.aws.neon.tech
    // The "ep-..." segment identifies the Neon BRANCH; everything before is
    // the project's compute endpoint.
    const neonBranchEndpoint =
      host.startsWith("ep-") ? host.split(".")[0] : null;
    const region = host.includes(".")
      ? host.split(".").slice(1, -2).join(".") || "(unknown)"
      : "(local)";
    return {
      host,
      databaseName,
      user,
      neonBranchEndpoint,
      region,
      isNeon: host.endsWith(".neon.tech"),
    };
  } catch {
    return null;
  }
}

const target = describeTarget(url);
if (target) {
  console.log("─────────────────────────────────────────────────────────");
  console.log("  About to apply migrations to:");
  console.log(`    Host:     ${target.host}`);
  console.log(`    Database: ${target.databaseName}`);
  console.log(`    User:     ${target.user}`);
  if (target.isNeon) {
    console.log(`    Neon endpoint: ${target.neonBranchEndpoint ?? "(?)"}`);
    console.log(`    Region:        ${target.region}`);
  }
  console.log("─────────────────────────────────────────────────────────");
} else {
  console.log("Connecting to:", url.replace(/:[^:@/]+@/, ":***@"));
}

const client = new pg.Client({ connectionString: url });

await client.connect();
console.log("Connected.");

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
