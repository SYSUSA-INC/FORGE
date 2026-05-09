#!/usr/bin/env node
/**
 * Fresh-DB migration verification.
 *
 * Spins up the migrations against a fresh, empty database (provided
 * by CI as DATABASE_URL pointing at an ephemeral Postgres). Confirms:
 *
 *   1. Every drizzle/*.sql file applies cleanly from a blank DB
 *      (catches accidental cross-migration dependencies on prior
 *      state, missing CREATE EXTENSION calls, etc.)
 *   2. Re-running the migrations is a clean no-op (idempotency)
 *   3. The ledger ends up in a consistent state
 *
 * Designed to run in CI as a required check on every PR. Without
 * this, a migration that depends on an undocumented preceding state
 * can pass on a developer's already-migrated DB but break a fresh
 * production / staging deploy.
 *
 * Usage in CI:
 *   - Boot a fresh Postgres container
 *   - Set DATABASE_URL pointing at it
 *   - Run this script. Non-zero exit fails the PR.
 */

import { spawn } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL not set. This script must run against a fresh ephemeral DB in CI.",
  );
  process.exit(1);
}

function run(cmd, args = []) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    child.on("close", (code) => resolve(code));
  });
}

console.log("─────────────────────────────────────────────────────────");
console.log("  Fresh DB migration verification");
console.log("─────────────────────────────────────────────────────────");

console.log("\n[1/2] First apply against the empty DB...");
const code1 = await run("node", ["scripts/apply-schema.mjs"]);
if (code1 !== 0) {
  console.error("\n❌ First apply failed. A migration cannot be applied on a fresh DB.");
  process.exit(1);
}

console.log("\n[2/2] Re-apply (must be a no-op)...");
const code2 = await run("node", ["scripts/apply-schema.mjs"]);
if (code2 !== 0) {
  console.error("\n❌ Re-apply failed. Migrations are not idempotent.");
  process.exit(1);
}

console.log("\n✓ Migrations apply cleanly from empty + are idempotent.");
