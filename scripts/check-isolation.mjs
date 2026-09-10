#!/usr/bin/env node
/**
 * Multi-tenant isolation check — static analyzer.
 *
 * BL-19 acceptance criterion: "CI fails if any new server action
 * lacks the isolation assertion." This script enforces it without
 * needing a runtime test framework. It catches the regression class
 * where a developer adds code that queries a tenant-scoped table
 * without scoping by `organizationId`.
 *
 * Surfaces (BL-TENANT-AUDIT follow-up widened the original
 * server-action-only check, because most DB reads now live in
 * server-only libs and API routes the first version never saw):
 *
 *   A. Server actions — every "use server" file under src/; each
 *      exported async function that touches a tenant-scoped table must
 *      call an auth gate AND reference `organizationId`.
 *   B. API route handlers — src/app/api/** /route.ts; same rule as A.
 *      Handlers gated by the cron bearer secret (`CRON_SECRET`) are
 *      cross-tenant by design and are exempt from the org reference;
 *      they are counted and printed so the exemption stays visible.
 *   C. Server-only libs — every module under src/lib that imports
 *      "@/db"; each exported async function that touches a tenant-scoped
 *      table must reference `organizationId` (or `organization_id` in
 *      raw SQL). No gate requirement: libs are called by gated code,
 *      but they must still take and apply the tenant.
 *   D. pgvector statements — every `<=>` / `<->` must sit inside a
 *      sql`` template that filters `organization_id`. The IVFFlat index
 *      is on the embedding alone, so a missing filter silently scans
 *      every tenant.
 *
 * Pipeline:
 *   1. Parse every drizzle/*.sql migration to derive the set of
 *      tenant-scoped tables (those with an `organization_id` column).
 *   2. Map each scoped SQL table to its Drizzle TypeScript identifier
 *      (read from src/db/schema.ts).
 *   3. Walk each surface and check every exported async function that
 *      reads/writes a scoped table (`.from(X)`, `.insert(X)`,
 *      `.update(X)`, `.delete(X)` where X is a scoped identifier).
 *   4. Violations are reported. CI fails non-zero.
 *
 * Allow-list:
 *   .isolation-allow.json maps "file:functionName" → "reason". Used
 *   for legitimately cross-tenant code (super-admin platform ops,
 *   token-scoped public surfaces, reference-data lookups, etc.). Every
 *   allow-listed entry MUST have a documented reason.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violations found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "drizzle");
const SCHEMA_FILE = join(REPO_ROOT, "src/db/schema.ts");
const SRC_DIR = join(REPO_ROOT, "src");
const API_DIR = join(REPO_ROOT, "src/app/api");
const LIB_DIR = join(REPO_ROOT, "src/lib");
const ALLOW_LIST_FILE = join(REPO_ROOT, ".isolation-allow.json");

const AUTH_GATES = [
  "requireAuth",
  "requireCurrentOrg",
  "requireOrgAdmin",
  "requireOrgMember",
  "requireSuperadmin",
  "requireApiTenant",
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

// ── step 3: walk the surfaces ───────────────────────────────────────

function walkFiles(dir, predicate) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        walk(p);
      } else if (
        (p.endsWith(".ts") || p.endsWith(".tsx")) &&
        !p.endsWith(".d.ts")
      ) {
        if (predicate(p)) out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

/** Surface A: files that start with "use server". */
function listServerActionFiles() {
  return walkFiles(SRC_DIR, (p) => {
    const head = readFileSync(p, "utf-8").slice(0, 200);
    return /^\s*"use server"|^\s*'use server'/m.test(head);
  });
}

/** Surface B: App Router route handlers. */
function listRouteFiles() {
  return walkFiles(API_DIR, (p) => basename(p) === "route.ts");
}

/** Surface C: lib modules that talk to the database. */
function listDbLibFiles() {
  return walkFiles(LIB_DIR, (p) => /from\s+"@\/db"/.test(readFileSync(p, "utf-8")));
}

/**
 * Splits a file's source into top-level async functions with their
 * bodies, by walking braces. Returns [{ name, body, line, exported }].
 * Exported functions get every rule; non-exported helpers only get the
 * write rule (they are reached through a gated export, but a write by
 * bare id is a write by bare id wherever it lives). Not a real parser —
 * relies on canonical formatting where `async function name(...) {`
 * starts its own line.
 */
function extractExportedFunctions(src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(export\s+)?async\s+function\s+(\w+)/);
    if (!m) continue;
    const exported = Boolean(m[1]);
    const name = m[2];
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
      bodyStartLine: braceLine + 1,
      exported,
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

function touchedScopedTables(body, scopedConsts) {
  const touched = [];
  for (const c of scopedConsts) {
    // Look for any of: .from(c) .insert(c) .update(c) .delete(c)
    // Use word boundary so `companies` doesn't match `companies2`.
    const re = new RegExp(`\\.(from|insert|update|delete)\\(\\s*${c}\\b`);
    if (re.test(body)) touched.push(c);
  }
  return touched;
}

function hasAuthGate(body) {
  return AUTH_GATES.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body));
}

function hasOrgRef(body) {
  return /\borganizationId\b|\borganization_id\b/.test(body);
}

/** Index just past the matching close paren for the "(" at `openIdx`. */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/** Index of the ";" that ends the statement containing `from`, at depth 0. */
function statementEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === ";" && depth <= 0) return i;
  }
  return src.length;
}

/**
 * Rule E — every UPDATE / DELETE on a tenant-scoped table must carry
 * the organization filter in its own WHERE clause. The body-level
 * check accepts "organizationId appears somewhere in the function",
 * which lets the classic slip through: verify the parent by org, then
 * write the child by bare id. Writes are where a slip becomes another
 * tenant's data loss, so they get the strict rule.
 */
function checkWriteStatements(fn, scopedConsts) {
  const problems = [];
  const body = fn.body;
  const lineOf = (idx) => fn.bodyStartLine + (body.slice(0, idx).match(/\n/g) ?? []).length;
  for (const c of scopedConsts) {
    const re = new RegExp(`\\.(update|delete)\\(\\s*${c}\\b\\s*\\)`, "g");
    let m;
    while ((m = re.exec(body)) !== null) {
      const stmt = body.slice(m.index, statementEnd(body, m.index));
      const whereIdx = stmt.indexOf(".where(");
      if (whereIdx === -1) {
        problems.push({ line: lineOf(m.index), text: `${m[1]}(${c}) has no .where() clause` });
        continue;
      }
      const open = whereIdx + ".where".length;
      const whereArg = stmt.slice(open, matchParen(stmt, open));
      if (!hasOrgRef(whereArg)) {
        problems.push({ line: lineOf(m.index), text: `${m[1]}(${c}).where(...) lacks organizationId` });
      }
    }
  }
  return problems;
}

/**
 * Checks one surface. `mode` decides the rule:
 *   "action" / "route" — gate + org reference (cron handlers exempt from org ref)
 *   "lib"              — org reference only
 */
function checkSurface(files, scopedConsts, allowList, mode) {
  const violations = [];
  let fnCount = 0;
  let touching = 0;
  let cronExempt = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    for (const fn of extractExportedFunctions(src)) {
      if (fn.exported) fnCount++;
      const allowKey = `${relativeFile}:${fn.name}`;
      if (allowList[allowKey]) continue;

      const tables = touchedScopedTables(fn.body, scopedConsts);
      if (tables.length === 0) continue;

      if (!fn.exported) {
        // Helper: write rule only.
        for (const problem of checkWriteStatements(fn, scopedConsts)) {
          violations.push({
            file: relativeFile,
            line: problem.line,
            name: fn.name,
            tables,
            missing: `organizationId in the WHERE of the write — ${problem.text}`,
          });
        }
        continue;
      }

      touching++;

      const isCron = mode === "route" && /\bCRON_SECRET\b/.test(fn.body);
      if (isCron) {
        cronExempt++;
        continue;
      }

      if (mode !== "lib" && !hasAuthGate(fn.body)) {
        violations.push({
          file: relativeFile,
          line: fn.line,
          name: fn.name,
          tables,
          missing:
            "auth gate (requireCurrentOrg / requireOrgAdmin / requireSuperadmin / requireApiTenant)",
        });
      }
      if (!hasOrgRef(fn.body)) {
        violations.push({
          file: relativeFile,
          line: fn.line,
          name: fn.name,
          tables,
          missing:
            mode === "lib"
              ? "organizationId reference (lib loaders must take and apply the tenant)"
              : "organizationId reference (queries must scope by org)",
        });
      }
      for (const problem of checkWriteStatements(fn, scopedConsts)) {
        violations.push({
          file: relativeFile,
          line: problem.line,
          name: fn.name,
          tables,
          missing: `organizationId in the WHERE of the write — ${problem.text}`,
        });
      }
    }
  }
  return { violations, fnCount, touching, cronExempt };
}

/**
 * Surface D: pgvector distance operators. Finds the enclosing sql``
 * template for each `<=>` / `<->` and requires `organization_id` in
 * the same statement.
 */
function findTemplateEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "$" && src[i + 1] === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth--;
      continue;
    }
    if (ch === "`" && depth === 0) return i;
  }
  return src.length;
}

function checkVectorStatements(allowList) {
  const violations = [];
  let statements = 0;
  const files = walkFiles(SRC_DIR, () => true);
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    if (!/<=>|<->/.test(src)) continue;
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    const re = /<=>|<->/g;
    let m;
    const seenStatements = new Set();
    while ((m = re.exec(src)) !== null) {
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const lineEndIdx = src.indexOf("\n", m.index);
      const lineText = src
        .slice(lineStart, lineEndIdx === -1 ? undefined : lineEndIdx)
        .trim();
      // Skip comments and doc blocks.
      if (/^(\*|\/\/|\/\*)/.test(lineText)) continue;
      const lineNo = src.slice(0, m.index).split("\n").length;
      if (allowList[`${relativeFile}:${lineNo}`]) continue;

      const start = src.lastIndexOf("sql`", m.index);
      if (start === -1) {
        violations.push({
          file: relativeFile,
          line: lineNo,
          name: "<vector operator>",
          tables: ["embedding"],
          missing: "sql`` template (vector operator found outside a tagged SQL statement)",
        });
        continue;
      }
      const end = findTemplateEnd(src, start + 4);
      if (end < m.index) {
        // The nearest sql`` closed before this operator — not inside a template.
        violations.push({
          file: relativeFile,
          line: lineNo,
          name: "<vector operator>",
          tables: ["embedding"],
          missing: "sql`` template (vector operator found outside a tagged SQL statement)",
        });
        continue;
      }
      if (seenStatements.has(start)) continue;
      seenStatements.add(start);
      statements++;
      const stmt = src.slice(start, end);
      if (!/\borganization_id\b/.test(stmt)) {
        violations.push({
          file: relativeFile,
          line: lineNo,
          name: "<vector statement>",
          tables: ["embedding"],
          missing: "organization_id filter in the same sql`` statement (IVFFlat index is org-blind)",
        });
      }
    }
  }
  return { violations, statements };
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

  const allowList = loadAllowList();
  const actions = checkSurface(listServerActionFiles(), scopedConsts, allowList, "action");
  const routes = checkSurface(listRouteFiles(), scopedConsts, allowList, "route");
  const libs = checkSurface(listDbLibFiles(), scopedConsts, allowList, "lib");
  const vectors = checkVectorStatements(allowList);

  return {
    scopedSqlTables,
    scopedConsts,
    actions,
    routes,
    libs,
    vectors,
    violations: [
      ...actions.violations,
      ...routes.violations,
      ...libs.violations,
      ...vectors.violations,
    ],
  };
}

// ── main ────────────────────────────────────────────────────────────

const { scopedSqlTables, scopedConsts, actions, routes, libs, vectors, violations } = check();

console.log(
  `[isolation] ${scopedSqlTables.size} tenant-scoped SQL tables; ${scopedConsts.size} Drizzle consts watched.`,
);
console.log(
  `[isolation] surfaces — actions: ${actions.fnCount} fns (${actions.touching} touch tenant tables); ` +
    `routes: ${routes.fnCount} handlers (${routes.touching} touch, ${routes.cronExempt} cron-exempt); ` +
    `libs: ${libs.fnCount} fns (${libs.touching} touch); vector statements: ${vectors.statements}.`,
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
    'with a one-line reason. Example: { "src/app/(app)/admin/foo.ts:bar": "super-admin platform op, no tenant context" }\n' +
    'Vector statements are keyed by line: { "src/lib/foo.ts:123": "reason" }',
);
process.exit(1);
