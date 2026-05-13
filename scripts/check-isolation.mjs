#!/usr/bin/env node
/**
 * Multi-tenant isolation check — static analyzer for server actions.
 *
 * BL-19 acceptance criterion: "CI fails if any new server action
 * lacks the isolation assertion." This script enforces it without
 * needing a runtime test framework. It catches the regression class
 * where a developer adds a new server action that queries a
 * tenant-scoped table without scoping by `organizationId`.
 *
 * Pipeline:
 *   1. Parse every drizzle/*.sql migration to derive the set of
 *      tenant-scoped tables (those with an `organization_id` column).
 *   2. Map each scoped SQL table to its Drizzle TypeScript identifier
 *      (read from src/db/schema.ts).
 *   3. Walk every "use server" file under src/ and check each exported
 *      async function:
 *        a. If the function reads/writes a scoped table (`.from(X)`,
 *           `.insert(X)`, `.update(X)`, `.delete(X)` where X is a
 *           scoped identifier), it must:
 *           - Call one of `requireCurrentOrg`, `requireOrgAdmin`,
 *             `requireSuperadmin` (auth gate)
 *           - Reference `organizationId` in the same function (WHERE
 *             clause or insert values)
 *        b. Otherwise it's not a concern of this check.
 *   4. Violations are reported. CI fails non-zero.
 *
 * Allow-list:
 *   .isolation-allow.json maps "file:functionName" → "reason". Used
 *   for legitimately cross-tenant actions (super-admin platform ops,
 *   reference-data lookups, etc.). Every allow-listed entry MUST
 *   have a documented reason.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violations found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle");
const SCHEMA_FILE = join(REPO_ROOT, "src/db/schema.ts");
const SRC_DIR = join(REPO_ROOT, "src");
const ALLOW_LIST_FILE = join(REPO_ROOT, ".isolation-allow.json");

const AUTH_GATES = [
  "requireAuth",
  "requireCurrentOrg",
  "requireOrgAdmin",
  "requireOrgMember",
  "requireSuperadmin",
];

// ── step 1: which SQL tables are tenant-scoped? ─────────────────────

/**
 * Returns the set of SQL table names that contain an organization_id
 * column. Derived from the migrations rather than hard-coded so the
 * check stays accurate as the schema evolves.
 */
function deriveScopedTableNames() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const scoped = new Set();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf-8");
    // Match each CREATE TABLE "name" ( ... ); block. The body is
    // everything until the matching closing paren at column 0.
    // Crude but adequate for canonical Drizzle-generated migrations.
    const createRe = /CREATE TABLE\s+(IF NOT EXISTS\s+)?"([^"]+)"\s*\(([\s\S]+?)\n\)\s*;/gi;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const tableName = m[2];
      const body = m[3];
      if (/"organization_id"/.test(body)) {
        scoped.add(tableName);
      }
    }
    // Also: a later migration could add organization_id via ALTER.
    const alterRe =
      /ALTER TABLE\s+"([^"]+)"[\s\S]+?ADD COLUMN\s+"organization_id"/gi;
    let mm;
    while ((mm = alterRe.exec(sql)) !== null) {
      scoped.add(mm[1]);
    }
  }
  // Auth/system tables are exempt — they're scoped by user, not org.
  for (const t of [
    "user",
    "account",
    "session",
    "verificationToken",
    "_forge_migration",
    "rate_limit_counter",
    "platform_setting",
  ]) {
    scoped.delete(t);
  }
  return scoped;
}

// ── step 2: SQL table → Drizzle const name ──────────────────────────

/**
 * Reads src/db/schema.ts and builds a map from SQL table name (the
 * pgTable() first argument) to the exported TS const name.
 */
function buildTableConstMap() {
  const src = readFileSync(SCHEMA_FILE, "utf-8");
  const map = new Map();
  const re =
    /export const (\w+)\s*=\s*pgTable\s*\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    map.set(m[2], m[1]);
  }
  return map;
}

// ── step 3: walk server actions ─────────────────────────────────────

function listServerFiles(dir) {
  const out = [];
  function walk(d) {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(p);
      } else if (
        (p.endsWith(".ts") || p.endsWith(".tsx")) &&
        !p.endsWith(".d.ts")
      ) {
        // Cheap pre-filter: only files that start with "use server"
        // (or contain it on the first non-empty line) qualify.
        const head = readFileSync(p, "utf-8").slice(0, 200);
        if (/^\s*"use server"|^\s*'use server'/m.test(head.split("\n")[0]) ||
          /^\s*"use server"|^\s*'use server'/m.test(head)) {
          out.push(p);
        }
      }
    }
  }
  walk(dir);
  return out;
}

/**
 * Splits a file's source into top-level exported async functions
 * with their bodies, by walking braces. Returns [{ name, body, line }].
 * Not a real parser — relies on canonical formatting where the
 * `export async function name(...) {` lives on its own line.
 */
function extractExportedFunctions(src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^export\s+async\s+function\s+(\w+)/);
    if (!m) continue;
    const name = m[1];
    // Find the opening brace of the function body.
    let braceLine = i;
    while (braceLine < lines.length && !lines[braceLine].includes("{")) braceLine++;
    if (braceLine >= lines.length) continue;
    let depth = 0;
    let started = false;
    const bodyLines = [];
    for (let j = braceLine; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === "{") {
          depth++;
          started = true;
        } else if (ch === "}") depth--;
      }
      bodyLines.push(l);
      if (started && depth === 0) break;
    }
    out.push({
      name,
      body: bodyLines.join("\n"),
      line: i + 1,
    });
  }
  return out;
}

// ── step 4: violations ──────────────────────────────────────────────

function loadAllowList() {
  try {
    const raw = readFileSync(ALLOW_LIST_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function check() {
  const scopedSqlTables = deriveScopedTableNames();
  const tableConstMap = buildTableConstMap();
  // Build the set of TS identifiers we care about flagging on.
  const scopedConsts = new Set();
  for (const sqlName of scopedSqlTables) {
    const constName = tableConstMap.get(sqlName);
    if (constName) scopedConsts.add(constName);
  }

  const serverFiles = listServerFiles(SRC_DIR);
  const allowList = loadAllowList();
  const violations = [];

  for (const file of serverFiles) {
    const src = readFileSync(file, "utf-8");
    const fns = extractExportedFunctions(src);
    for (const fn of fns) {
      // Skip if explicitly allow-listed.
      const relativeFile = file.slice(REPO_ROOT.length + 1);
      const allowKey = `${relativeFile}:${fn.name}`;
      if (allowList[allowKey]) continue;

      // Find which scoped tables this function touches.
      const touchedConsts = [];
      for (const c of scopedConsts) {
        // Look for any of: .from(c) .insert(c) .update(c) .delete(c)
        // Use word boundary so `companies` doesn't match `companies2`.
        const re = new RegExp(`\\.(from|insert|update|delete)\\(\\s*${c}\\b`);
        if (re.test(fn.body)) touchedConsts.push(c);
      }
      if (touchedConsts.length === 0) continue;

      // Now enforce: must have an auth gate AND reference organizationId.
      const hasAuthGate = AUTH_GATES.some((g) =>
        new RegExp(`\\b${g}\\s*\\(`).test(fn.body),
      );
      const hasOrgRef = /\borganizationId\b/.test(fn.body);

      if (!hasAuthGate) {
        violations.push({
          file: relativeFile,
          line: fn.line,
          name: fn.name,
          tables: touchedConsts,
          missing: "auth gate (requireCurrentOrg / requireOrgAdmin / requireSuperadmin)",
        });
      }
      if (!hasOrgRef) {
        violations.push({
          file: relativeFile,
          line: fn.line,
          name: fn.name,
          tables: touchedConsts,
          missing: "organizationId reference (queries must scope by org)",
        });
      }
    }
  }

  return { scopedSqlTables, scopedConsts, violations };
}

// ── main ────────────────────────────────────────────────────────────

const { scopedSqlTables, scopedConsts, violations } = check();

console.log(
  `[isolation] ${scopedSqlTables.size} tenant-scoped SQL tables; ${scopedConsts.size} Drizzle consts watched.`,
);

if (violations.length === 0) {
  console.log("✓ No isolation violations.");
  process.exit(0);
}

console.error(
  `✗ ${violations.length} isolation violation${violations.length === 1 ? "" : "s"}:\n`,
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.name}()`);
  console.error(`    touches tables: ${v.tables.join(", ")}`);
  console.error(`    missing: ${v.missing}\n`);
}
console.error(
  "To allow-list a legitimate exception, add it to .isolation-allow.json\n" +
    'with a one-line reason. Example: { "src/app/(app)/admin/foo.ts:bar": "super-admin platform op, no tenant context" }',
);
process.exit(1);
