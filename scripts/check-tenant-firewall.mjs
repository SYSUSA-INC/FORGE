#!/usr/bin/env node
/**
 * Tenant firewall check — static DB-constraint assertions.
 *
 * BL-TENANT-AUDIT follow-up #3 (docs/audits/06-multi-tenant-firewall-2026-06.md
 * §7). The June audit verified these properties by hand for 32 tables;
 * this script re-derives them from the migrations on every PR so the
 * guarantee cannot drift as tables are added.
 *
 * For every tenant-scoped table (one with an `organization_id` column),
 * as applied by drizzle/*.sql in order, asserts:
 *
 *   not_null   — organization_id is NOT NULL, so a row can never be
 *                orphaned outside every tenant.
 *   fk_cascade — organization_id REFERENCES organization(id) ON DELETE
 *                CASCADE, so deleting a tenant removes its data.
 *   org_index  — an index, primary key or unique constraint leads with
 *                organization_id, so tenant-scoped reads never fall
 *                back to a sequential scan across every tenant.
 *   schema     — the table has a pgTable const in src/db/schema.ts and
 *                vice versa (drift between the ORM and the SQL).
 *
 * Exceptions:
 *   .tenant-firewall-allow.json maps "table:check" → reason, e.g.
 *   { "production_error:not_null": "pre-auth errors have no tenant (audit 06 §3.3)" }.
 *   Every entry MUST carry a documented reason.
 *
 * Static so it runs without a database. Not a full SQL parser — it
 * understands the forms Drizzle and this repo's hand-written migrations
 * use (CREATE TABLE, ALTER TABLE ADD COLUMN / ALTER COLUMN / ADD
 * CONSTRAINT / RENAME TO, CREATE INDEX, DROP TABLE, DROP INDEX).
 *
 * Exit codes: 0 clean, 1 violations.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle");
const SCHEMA_FILE = join(REPO_ROOT, "src/db/schema.ts");
const ALLOW_LIST_FILE = join(REPO_ROOT, ".tenant-firewall-allow.json");

// Auth/system tables are scoped by user or global by design.
const EXEMPT_TABLES = new Set([
  "user",
  "account",
  "session",
  "verificationToken",
  "_forge_migration",
  "rate_limit_counter",
  "platform_setting",
]);

const ORG = "organization_id";

// ── SQL model ───────────────────────────────────────────────────────

/** @typedef {{ notNull: boolean, fk: string | null, constraintIndex: boolean, hasOrg: boolean }} TableState */

/** @type {Map<string, TableState>} */
const tables = new Map();
/** @type {Map<string, { table: string, leading: string }>} */
const indexes = new Map();

function tableState(name) {
  let t = tables.get(name);
  if (!t) {
    t = { notNull: false, fk: null, constraintIndex: false, hasOrg: false };
    tables.set(name, t);
  }
  return t;
}

function ident(s) {
  return s.replace(/"/g, "").replace(/^public\./, "").trim();
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/** Split a CREATE TABLE body into top-level, comma-separated items. */
function splitItems(body) {
  const items = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

const REF_ORG =
  /REFERENCES\s+(?:"public"\.)?"?organization"?\s*\(\s*"?id"?\s*\)(?:\s*ON DELETE\s+([a-z ]+?))?(?=\s*(?:ON UPDATE|,|\)|;|$))/i;

function fkAction(text) {
  const m = text.match(REF_ORG);
  if (!m) return null;
  return (m[1] ?? "no action").trim().toLowerCase();
}

function firstColumn(colList) {
  const first = colList.split(",")[0] ?? "";
  return ident(first.replace(/\b(ASC|DESC|NULLS\s+(FIRST|LAST))\b/gi, "").trim());
}

function applyColumnDef(table, item) {
  const m = item.match(/^"?(\w+)"?\s+([\s\S]*)$/);
  if (!m) return;
  const [, col, rest] = m;
  if (col !== ORG) return;
  const t = tableState(table);
  t.hasOrg = true;
  if (/\bNOT NULL\b/i.test(rest) || /\bPRIMARY KEY\b/i.test(rest)) t.notNull = true;
  if (/\bPRIMARY KEY\b/i.test(rest)) t.constraintIndex = true;
  const fk = fkAction(rest);
  if (fk) t.fk = fk;
}

function applyTableConstraint(table, item) {
  const t = tableState(table);
  if (new RegExp(`\\b(PRIMARY KEY|UNIQUE)\\s*\\(\\s*"?${ORG}"?`, "i").test(item)) {
    t.constraintIndex = true;
    t.hasOrg = true;
  }
  const fkm = item.match(new RegExp(`FOREIGN KEY\\s*\\(\\s*"?${ORG}"?\\s*\\)\\s*([\\s\\S]*)`, "i"));
  if (fkm) {
    const fk = fkAction(fkm[1]);
    if (fk) t.fk = fk;
  }
}

function applyMigration(sqlRaw) {
  const sql = stripComments(sqlRaw);

  // CREATE TABLE
  const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?("?[\w.]+"?)\s*\(([\s\S]+?)\n\)\s*;/gi;
  let m;
  while ((m = createRe.exec(sql)) !== null) {
    const table = ident(m[1]);
    tableState(table);
    for (const item of splitItems(m[2])) {
      if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(item)) {
        applyTableConstraint(table, item);
      } else {
        applyColumnDef(table, item);
      }
    }
  }

  // ALTER TABLE … ADD COLUMN "organization_id" …
  const addColRe = new RegExp(
    `ALTER TABLE\\s+(?:IF EXISTS\\s+)?("?[\\w.]+"?)\\s+ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?("?${ORG}"?\\s+[^;]*?)(?=;|$)`,
    "gi",
  );
  while ((m = addColRe.exec(sql)) !== null) {
    applyColumnDef(ident(m[1]), m[2]);
  }

  // ALTER TABLE … ALTER COLUMN "organization_id" SET/DROP NOT NULL
  const notNullRe = new RegExp(
    `ALTER TABLE\\s+(?:IF EXISTS\\s+)?("?[\\w.]+"?)\\s+ALTER COLUMN\\s+"?${ORG}"?\\s+(SET|DROP)\\s+NOT NULL`,
    "gi",
  );
  while ((m = notNullRe.exec(sql)) !== null) {
    tableState(ident(m[1])).notNull = m[2].toUpperCase() === "SET";
  }

  // ALTER TABLE … ADD CONSTRAINT … (FOREIGN KEY / UNIQUE / PRIMARY KEY on organization_id)
  const addConRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?("?[\w.]+"?)\s+ADD CONSTRAINT\s+"?\w+"?\s+([\s\S]*?)(?=;|$)/gi;
  while ((m = addConRe.exec(sql)) !== null) {
    applyTableConstraint(ident(m[1]), m[2]);
  }

  // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table [USING x] (cols)
  const idxRe =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?("?[\w.]+"?)\s+ON\s+(?:ONLY\s+)?("?[\w.]+"?)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi;
  while ((m = idxRe.exec(sql)) !== null) {
    indexes.set(ident(m[1]), { table: ident(m[2]), leading: firstColumn(m[3]) });
  }

  // DROP INDEX
  const dropIdxRe = /DROP INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = dropIdxRe.exec(sql)) !== null) {
    indexes.delete(ident(m[1]));
  }

  // ALTER TABLE old RENAME TO new
  const renameRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?("?[\w.]+"?)\s+RENAME TO\s+("?[\w.]+"?)/gi;
  while ((m = renameRe.exec(sql)) !== null) {
    const from = ident(m[1]);
    const to = ident(m[2]);
    if (tables.has(from)) {
      tables.set(to, tables.get(from));
      tables.delete(from);
    }
    for (const idx of indexes.values()) if (idx.table === from) idx.table = to;
  }

  // ALTER INDEX old RENAME TO new
  const renameIdxRe = /ALTER INDEX\s+(?:IF EXISTS\s+)?("?[\w.]+"?)\s+RENAME TO\s+("?[\w.]+"?)/gi;
  while ((m = renameIdxRe.exec(sql)) !== null) {
    const from = ident(m[1]);
    if (indexes.has(from)) {
      indexes.set(ident(m[2]), indexes.get(from));
      indexes.delete(from);
    }
  }

  // DROP TABLE
  const dropRe = /DROP TABLE\s+(?:IF EXISTS\s+)?("?[\w.]+"?)/gi;
  while ((m = dropRe.exec(sql)) !== null) {
    const name = ident(m[1]);
    tables.delete(name);
    for (const [k, idx] of indexes) if (idx.table === name) indexes.delete(k);
  }
}

// ── schema.ts ───────────────────────────────────────────────────────

function schemaTables() {
  const src = readFileSync(SCHEMA_FILE, "utf-8");
  const names = new Set();
  const re = /export const (\w+)\s*=\s*pgTable\s*\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[2]);
  return names;
}

// ── run ─────────────────────────────────────────────────────────────

function loadAllowList() {
  try {
    const parsed = JSON.parse(readFileSync(ALLOW_LIST_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const f of files) applyMigration(readFileSync(join(MIGRATIONS_DIR, f), "utf-8"));

const allow = loadAllowList();
const inSchema = schemaTables();
const violations = [];
const scoped = [...tables.entries()]
  .filter(([name, t]) => t.hasOrg && !EXEMPT_TABLES.has(name))
  .sort(([a], [b]) => a.localeCompare(b));

let allowed = 0;
function report(table, check, detail, fix) {
  const key = `${table}:${check}`;
  if (allow[key]) {
    allowed++;
    return;
  }
  violations.push({ table, check, detail, fix });
}

for (const [name, t] of scoped) {
  if (!t.notNull) {
    report(
      name,
      "not_null",
      "organization_id is nullable",
      `ALTER TABLE "${name}" ALTER COLUMN "organization_id" SET NOT NULL;`,
    );
  }
  if (t.fk !== "cascade") {
    report(
      name,
      "fk_cascade",
      t.fk ? `FK to organization uses ON DELETE ${t.fk.toUpperCase()}` : "no FK to organization(id)",
      `ALTER TABLE "${name}" ADD CONSTRAINT "${name}_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;`,
    );
  }
  const hasIdx =
    t.constraintIndex ||
    [...indexes.values()].some((i) => i.table === name && i.leading === ORG);
  if (!hasIdx) {
    report(
      name,
      "org_index",
      "no index leading with organization_id",
      `CREATE INDEX IF NOT EXISTS "${name}_organization_id_idx" ON "${name}" ("organization_id");`,
    );
  }
  if (!inSchema.has(name)) {
    report(name, "schema", "table exists in migrations but has no pgTable in src/db/schema.ts", "add the pgTable or drop the table in a migration");
  }
}
for (const name of inSchema) {
  if (!tables.has(name) && !EXEMPT_TABLES.has(name)) {
    report(name, "schema", "pgTable in src/db/schema.ts has no CREATE TABLE in drizzle/*.sql", "add a migration");
  }
}
// Allow-list entries that no longer match anything are stale.
for (const key of Object.keys(allow)) {
  const [table] = key.split(":");
  if (!tables.has(table)) {
    violations.push({
      table,
      check: "allow_list",
      detail: `allow-list entry "${key}" refers to a table that does not exist`,
      fix: "remove the entry from .tenant-firewall-allow.json",
    });
  }
}

console.log(
  `[firewall] ${files.length} migrations → ${tables.size} tables, ${scoped.length} tenant-scoped; ${indexes.size} indexes tracked; ${allowed} documented exception${allowed === 1 ? "" : "s"}.`,
);

if (violations.length === 0) {
  console.log("✓ Every tenant-scoped table has NOT NULL organization_id, a CASCADE FK to organization, a leading org index, and a matching pgTable.");
  process.exit(0);
}

console.error(`✗ ${violations.length} tenant firewall violation${violations.length === 1 ? "" : "s"}:\n`);
for (const v of violations) {
  console.error(`  ${v.table}  [${v.check}]  ${v.detail}`);
  console.error(`    fix: ${v.fix}\n`);
}
console.error(
  "Fix with a new forward-only migration (drizzle/NNNN_*.sql, idempotent) mirrored in src/db/schema.ts,\n" +
    'or document an intentional exception in .tenant-firewall-allow.json: { "<table>:<check>": "reason" }',
);
process.exit(1);
