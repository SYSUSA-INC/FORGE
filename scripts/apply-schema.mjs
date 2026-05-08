import { config } from "dotenv";
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import pg from "pg";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  // On Vercel builds, DATABASE_URL is set via the project's env vars.
  // Locally it comes from .env.local. If missing, we don't crash the
  // build silently — surface the cause and exit non-zero.
  console.error(
    "DATABASE_URL not set. Migrations cannot run.\n" +
      "  - Local: add to .env.local\n" +
      "  - Vercel: set in Project Settings → Environment Variables\n",
  );
  process.exit(1);
}

function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    const databaseName = u.pathname.replace(/^\//, "") || "(default)";
    const host = u.hostname;
    const user = u.username || "(no user)";
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
  console.log("  Migration target:");
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

// ── Migration ledger ───────────────────────────────────────────────
//
// _forge_migration tracks which .sql files have already been applied,
// keyed by filename + sha256 of contents. This makes the script:
//   1. Fast on warm DBs — already-applied migrations skip without
//      touching pg
//   2. Honest — re-running is a no-op rather than relying on pg
//      error codes (which can hide partial-apply bugs)
//   3. Auditable — a tenant admin can SELECT * from _forge_migration
//      to see what shipped when
//
// Schema mismatch detection: if a file's hash differs from what's
// recorded, we abort with a clear error. Editing already-applied
// migrations in place is a foot-gun we want to prevent.
//
// To force-replay (rare; e.g. after a manual rollback): TRUNCATE the
// table.
await client.query(`
  CREATE TABLE IF NOT EXISTS "_forge_migration" (
    "filename" text PRIMARY KEY,
    "sha256" text NOT NULL,
    "applied_at" timestamptz NOT NULL DEFAULT now()
  );
`);

const dir = "drizzle";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No .sql files found in drizzle/");
  await client.end();
  process.exit(1);
}

const { rows: appliedRows } = await client.query(
  `SELECT filename, sha256 FROM "_forge_migration"`,
);
const applied = new Map(appliedRows.map((r) => [r.filename, r.sha256]));

let appliedCount = 0;
let skippedCount = 0;

for (const file of files) {
  const path = join(dir, file);
  const sql = readFileSync(path, "utf-8");
  const hash = createHash("sha256").update(sql).digest("hex");

  const recorded = applied.get(file);
  if (recorded) {
    if (recorded !== hash) {
      console.error(
        `\n❌ Migration ${file} has been edited after it was applied.\n` +
          `   Recorded hash: ${recorded}\n` +
          `   Current hash:  ${hash}\n` +
          `   Migrations are immutable once applied. Create a new\n` +
          `   migration file instead of editing this one.\n`,
      );
      await client.end();
      process.exit(1);
    }
    skippedCount++;
    continue;
  }

  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Applying ${file} (${statements.length} statements)...`);
  // Each migration runs inside a transaction so partial failures
  // don't leave the DB in a half-applied state. The ledger row
  // commits in the same transaction so visibility is atomic.
  //
  // Bootstrap-friendly: pre-existing DBs that already have these
  // tables / types from before the ledger existed will hit
  // "already exists" PG codes — we treat those as a no-op success
  // since the schema is structurally correct. The ledger entry
  // commits regardless, so subsequent runs are clean.
  let stmtsRun = 0;
  let stmtsSkipped = 0;
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        stmtsRun++;
      } catch (e) {
        // 42P07 = duplicate_table
        // 42710 = duplicate_object (e.g. enum, constraint)
        // 42701 = duplicate_column
        // 42P06 = duplicate_schema
        // 42723 = duplicate_function
        // 42P10 = invalid_column_reference (occurs with re-applied
        //         CREATE INDEX on missing column — surfaces only
        //         from genuinely broken state, not bootstrap)
        if (
          e.code === "42P07" ||
          e.code === "42710" ||
          e.code === "42701" ||
          e.code === "42P06" ||
          e.code === "42723"
        ) {
          stmtsSkipped++;
          continue;
        }
        throw e;
      }
    }
    await client.query(
      `INSERT INTO "_forge_migration" (filename, sha256) VALUES ($1, $2)`,
      [file, hash],
    );
    await client.query("COMMIT");
    appliedCount++;
    if (stmtsSkipped > 0) {
      console.log(
        `  ✓ recorded. (${stmtsRun} new, ${stmtsSkipped} already existed)`,
      );
    } else {
      console.log("  ✓ done.");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\n❌ Failed applying ${file}:\n   ${e.message}\n`);
    await client.end();
    process.exit(1);
  }
}

await client.end();

if (appliedCount === 0 && skippedCount === files.length) {
  console.log(
    `\n✓ Database up to date. ${skippedCount} migration${skippedCount === 1 ? "" : "s"} already applied.`,
  );
} else {
  console.log(
    `\n✓ Migration sync complete. Applied ${appliedCount}, skipped ${skippedCount}.`,
  );
}
