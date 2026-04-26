/**
 * Prints the database target (host / database / Neon endpoint / region)
 * without running any SQL. Use this to confirm which Neon branch your
 * DATABASE_URL points at before applying migrations or running scripts.
 *
 * Usage:
 *   node scripts/db-info.mjs
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Check .env.local or export it.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch (err) {
  console.error("DATABASE_URL is not a valid URL:", err.message);
  process.exit(1);
}

const databaseName = parsed.pathname.replace(/^\//, "") || "(default)";
const host = parsed.hostname;
const user = parsed.username || "(no user)";
const neonBranchEndpoint = host.startsWith("ep-") ? host.split(".")[0] : null;
const region = host.includes(".")
  ? host.split(".").slice(1, -2).join(".") || "(unknown)"
  : "(local)";
const isNeon = host.endsWith(".neon.tech");
const isPooled = host.includes("-pooler");

console.log("");
console.log("DATABASE_URL target");
console.log("───────────────────");
console.log(`  Host:          ${host}`);
console.log(`  Database:      ${databaseName}`);
console.log(`  User:          ${user}`);
console.log(`  Port:          ${parsed.port || "5432"}`);
if (isNeon) {
  console.log(`  Neon endpoint: ${neonBranchEndpoint ?? "(?)"}`);
  console.log(`  Region:        ${region}`);
  console.log(`  Pooled:        ${isPooled ? "yes (PgBouncer)" : "no (direct)"}`);
} else {
  console.log("  Provider:      not Neon (unrecognized host)");
}
console.log("");
console.log("Tip: name your Neon branches consistently (e.g. main /");
console.log("preview / dev) and the endpoint above will tell you which");
console.log("branch you're about to hit.");
