#!/usr/bin/env node
/**
 * Schema drift check — static index parity between drizzle/*.sql and
 * src/db/schema.ts (BL-TENANT-DRIFT).
 *
 * The SQL files are what the database actually runs; schema.ts is what
 * Drizzle believes. When an index exists in one and not the other, two
 * things go wrong silently: drizzle-kit (if ever run) drops the SQL-only
 * index, and a schema-only index is never created at all. The 2026-09
 * audit found eight such divergences by hand; this makes the comparison
 * a CI gate.
 *
 * What is compared, by index name:
 *   - present in SQL (net of DROP INDEX and ALTER INDEX … RENAME)
 *   - present in schema.ts as index("name") / uniqueIndex("name")
 *   - UNIQUE flag agrees
 *   - partial-ness agrees (SQL `WHERE` clause ↔ `.where(` on the builder)
 *
 * Not compared: column lists and expressions (drizzle-kit's own
 * `check` covers snapshot consistency; the fresh-DB job proves the SQL
 * applies). Documented exceptions live in .schema-drift-allow.json as
 * { "<index name>": "reason" }.
 *
 * Exit 0 clean, 1 drift. Exports its parsers for tests; runs only when
 * invoked directly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function ident(s) {
  return s.replace(/"/g, "").replace(/^public\./, "").trim();
}

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Parse every migration, in order, into the final set of indexes.
 * @returns {Map<string, {table: string, unique: boolean, partial: boolean, file: string}>}
 */
export function indexesFromSql(files /* [{name, sql}] in apply order */) {
  const out = new Map();
  const idxRe =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?("?[\w.]+"?)\s+ON\s+(?:ONLY\s+)?("?[\w.]+"?)\s*(?:USING\s+\w+\s*)?\(((?:[^()]|\([^()]*(?:\([^()]*\))*[^()]*\))*)\)([^;]*);/gi;
  for (const { name: file, sql: raw } of files) {
    const sql = stripSqlComments(raw);
    let m;
    while ((m = idxRe.exec(sql)) !== null) {
      const tail = m[5] ?? "";
      out.set(ident(m[2]), {
        table: ident(m[3]),
        unique: Boolean(m[1]),
        partial: /\bWHERE\b/i.test(tail),
        file,
      });
    }
    const dropRe = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF EXISTS\s+)?("?[\w.]+"?)/gi;
    while ((m = dropRe.exec(sql)) !== null) out.delete(ident(m[1]));
    const renameRe = /ALTER\s+INDEX\s+(?:IF EXISTS\s+)?("?[\w.]+"?)\s+RENAME\s+TO\s+("?[\w.]+"?)/gi;
    while ((m = renameRe.exec(sql)) !== null) {
      const from = ident(m[1]);
      if (out.has(from)) {
        out.set(ident(m[2]), out.get(from));
        out.delete(from);
      }
    }
    const dropTableRe = /DROP\s+TABLE\s+(?:IF EXISTS\s+)?("?[\w.]+"?)/gi;
    while ((m = dropTableRe.exec(sql)) !== null) {
      const t = ident(m[1]);
      for (const [k, v] of out) if (v.table === t) out.delete(k);
    }
  }
  return out;
}

/** Index just past the matching ")" for the "(" at openIdx. */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/**
 * Parse schema.ts for index("name") / uniqueIndex("name") builders and
 * follow the chained calls (.on / .using / .with / .where …) that follow.
 * @returns {Map<string, {unique: boolean, partial: boolean, line: number}>}
 */
export function indexesFromSchema(src) {
  const out = new Map();
  // Accept both `index("name")` and the prettier-wrapped form
  // `index(\n  "name",\n)` with its trailing comma.
  const re = /\b(uniqueIndex|index)\(\s*"([^"]+)"\s*,?\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Walk the builder chain: repeatedly accept `.name(...)`.
    let i = m.index + m[0].length;
    let chain = "";
    for (;;) {
      const rest = src.slice(i);
      const call = /^\s*\.\s*(\w+)\s*\(/.exec(rest);
      if (!call) break;
      const open = i + call[0].length - 1;
      const close = matchParen(src, open);
      chain += src.slice(i, close);
      i = close;
    }
    out.set(m[2], {
      unique: m[1] === "uniqueIndex",
      partial: /\.\s*where\s*\(/.test(chain),
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

export function diffIndexes(sqlIdx, schemaIdx, allow = {}) {
  const problems = [];
  for (const [name, s] of sqlIdx) {
    if (allow[name]) continue;
    const t = schemaIdx.get(name);
    if (!t) {
      problems.push({ name, kind: "sql_only", detail: `created in ${s.file} on "${s.table}" but not declared in src/db/schema.ts` });
      continue;
    }
    if (t.unique !== s.unique) {
      problems.push({ name, kind: "unique_mismatch", detail: `SQL ${s.unique ? "UNIQUE" : "non-unique"} vs schema.ts ${t.unique ? "uniqueIndex" : "index"} (schema.ts:${t.line})` });
    }
    if (t.partial !== s.partial) {
      problems.push({ name, kind: "partial_mismatch", detail: `SQL ${s.partial ? "has" : "has no"} WHERE clause vs schema.ts ${t.partial ? "has" : "has no"} .where() (schema.ts:${t.line}, ${s.file})` });
    }
  }
  for (const [name, t] of schemaIdx) {
    if (allow[name]) continue;
    if (!sqlIdx.has(name)) {
      problems.push({ name, kind: "schema_only", detail: `declared at src/db/schema.ts:${t.line} but no migration creates it — it will never exist in the database` });
    }
  }
  return problems.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const root = process.cwd();
  const dir = join(root, "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf-8") }));
  const schema = readFileSync(join(root, "src/db/schema.ts"), "utf-8");
  let allow = {};
  try {
    allow = JSON.parse(readFileSync(join(root, ".schema-drift-allow.json"), "utf-8"));
  } catch {
    allow = {};
  }

  const sqlIdx = indexesFromSql(files);
  const schemaIdx = indexesFromSchema(schema);
  const problems = diffIndexes(sqlIdx, schemaIdx, allow);

  console.log(
    `[schema-drift] ${files.length} migrations → ${sqlIdx.size} live indexes; ${schemaIdx.size} declared in schema.ts; ${Object.keys(allow).length} documented exception${Object.keys(allow).length === 1 ? "" : "s"}.`,
  );
  if (problems.length === 0) {
    console.log("✓ Every index in the migrations is declared in src/db/schema.ts with matching UNIQUE and partial-ness, and vice versa.");
    process.exit(0);
  }
  console.error(`✗ ${problems.length} schema drift problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.error(`  ${p.name}  [${p.kind}]  ${p.detail}`);
  console.error(
    "\nFix by mirroring the index into src/db/schema.ts (index()/uniqueIndex(), .where(sql`…`) for partials) or by adding the migration,\n" +
      'or document an intentional exception in .schema-drift-allow.json: { "<index name>": "reason" }',
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
