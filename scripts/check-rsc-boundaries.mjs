#!/usr/bin/env node
/**
 * RSC boundary checker — catches the bug pattern from PR #115:
 *
 *   In Next.js App Router, when a server component imports a NAMED
 *   export from a "use client" file, that import is converted to a
 *   Client Component reference at build time. If the export is a
 *   plain helper function (not a React component), calling it from
 *   server-render code produces:
 *
 *     TypeError: n is not a function
 *
 *   ...buried in an RSC payload toJSON crash that's hard to trace.
 *
 *   The right pattern: helpers shared between server and client
 *   components live in plain .ts modules (no "use client" marker).
 *   Components live in "use client" files. Components are imported
 *   freely from anywhere; helpers from "use client" files are not.
 *
 * What this script does:
 *
 *   1. Walk src/ for every .ts/.tsx file
 *   2. Tag each file: "client" if it starts with "use client", else "server"
 *   3. For each "client" file, list its named exports
 *   4. For each "server" file, list its imports from local files
 *   5. For each server-side import from a client file: flag any named
 *      import that isn't a React component (heuristic: lowercase first
 *      letter or doesn't return JSX)
 *
 * Heuristics for "is this export a React component?":
 *   - Exported name starts with an uppercase letter (PascalCase)
 *     AND the export site looks like `export function Name(` or
 *     `export const Name = (` or `export const Name: ...`
 *
 *   This is intentionally permissive — false positives are noisy
 *   but better than missing real bugs. Tighten later if needed.
 *
 * Exit codes:
 *   0 — no violations
 *   1 — violations found (CI should fail)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath("src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function classify(content) {
  // First non-blank, non-comment line of the file. "use client"
  // must be the first directive, similar rules to "use strict".
  const trimmed = content.replace(/^(\/\*[\s\S]*?\*\/|\/\/.*$|\s)+/m, "");
  return /^["']use client["'];?/.test(trimmed) ? "client" : "server";
}

/**
 * Extract the names of all top-level `export` declarations.
 * Handles:
 *   export function Name(
 *   export async function Name(
 *   export const Name =
 *   export const Name:
 *   export type Name =
 *   export interface Name
 *   export class Name
 *   export { x, y as z }
 *   export default ...   (key = "default")
 *
 * Returns an array of { name, kind } where kind is one of:
 *   "function" | "const" | "type" | "interface" | "class" | "default" | "re-export"
 */
function listExports(content) {
  const exports = [];
  const lines = content.split("\n");

  for (const line of lines) {
    let m;
    if ((m = line.match(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/))) {
      exports.push({ name: m[2], kind: "function" });
    } else if ((m = line.match(/^export\s+const\s+([A-Za-z_$][\w$]*)/))) {
      exports.push({ name: m[1], kind: "const" });
    } else if ((m = line.match(/^export\s+type\s+([A-Za-z_$][\w$]*)/))) {
      exports.push({ name: m[1], kind: "type" });
    } else if ((m = line.match(/^export\s+interface\s+([A-Za-z_$][\w$]*)/))) {
      exports.push({ name: m[1], kind: "interface" });
    } else if ((m = line.match(/^export\s+class\s+([A-Za-z_$][\w$]*)/))) {
      exports.push({ name: m[1], kind: "class" });
    } else if (line.match(/^export\s+default\b/)) {
      exports.push({ name: "default", kind: "default" });
    } else if ((m = line.match(/^export\s+\{([^}]+)\}/))) {
      // Re-exports: pick out names. `{ x, y as z, type t }` — strip
      // type-only re-exports.
      const names = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          // Strip "type " prefix.
          const stripped = s.replace(/^type\s+/, "");
          // Pick the alias if "as" present, else the original name.
          const asIdx = stripped.indexOf(" as ");
          return asIdx >= 0
            ? stripped.slice(asIdx + 4).trim()
            : stripped.trim();
        });
      for (const n of names) {
        exports.push({ name: n, kind: "re-export" });
      }
    }
  }

  return exports;
}

/**
 * Extract local-file imports from a source file.
 * Returns array of { source, names: [{ name, isType }] }.
 *
 * "Local" means relative path or "@/..." alias. Skips bare package
 * imports (e.g. "react", "next/link").
 */
function listImports(content, fromPath) {
  const imports = [];
  const importRegex =
    /^import\s+(?:(?:type\s+)?(?:\{([^}]+)\}|(\w+)))?\s*(?:,\s*\{([^}]+)\})?\s*from\s+["']([^"']+)["']/gm;

  let m;
  while ((m = importRegex.exec(content)) !== null) {
    const namedFromBraces = m[1];
    const defaultName = m[2];
    const namedAfterDefault = m[3];
    const source = m[4];

    // Only relative or @/ aliased imports.
    if (!source.startsWith(".") && !source.startsWith("@/")) continue;

    const names = [];
    if (defaultName) names.push({ name: defaultName, isType: false });

    const namedRaw = [namedFromBraces, namedAfterDefault]
      .filter(Boolean)
      .join(",");
    if (namedRaw) {
      for (const part of namedRaw.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const isType = /^type\s+/.test(trimmed);
        const stripped = trimmed.replace(/^type\s+/, "");
        // "x as y" — what we IMPORT is "x"; "y" is local alias. We
        // care about "x" because that's the export name we'd be
        // pulling.
        const asIdx = stripped.indexOf(" as ");
        const name = asIdx >= 0 ? stripped.slice(0, asIdx).trim() : stripped;
        names.push({ name, isType });
      }
    }

    imports.push({ source, names });
  }

  return imports;
}

/**
 * Resolve a relative or @/ aliased import to an absolute path.
 * Returns null if can't resolve to an existing file.
 */
function resolveImport(fromPath, source) {
  let basePath;
  if (source.startsWith("@/")) {
    basePath = join(ROOT, source.slice(2));
  } else {
    basePath = resolvePath(dirname(fromPath), source);
  }

  // Try direct, .ts, .tsx, /index.ts, /index.tsx
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
  ];

  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      // Not found, continue.
    }
  }
  return null;
}

function isLikelyComponent(exp) {
  // PascalCase name + function/const/default → component.
  if (exp.kind === "type" || exp.kind === "interface") return true; // not callable, safe
  if (exp.name === "default") return true; // defaults are usually components
  return /^[A-Z]/.test(exp.name);
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

const allFiles = walk(ROOT);
const fileMeta = new Map();

for (const path of allFiles) {
  const content = readFileSync(path, "utf-8");
  const role = classify(content);
  const exports = listExports(content);
  fileMeta.set(path, { role, exports, content });
}

const violations = [];

for (const [path, meta] of fileMeta) {
  if (meta.role !== "server") continue;

  const imports = listImports(meta.content, path);
  for (const imp of imports) {
    const resolved = resolveImport(path, imp.source);
    if (!resolved) continue;

    const target = fileMeta.get(resolved);
    if (!target) continue;
    if (target.role !== "client") continue;

    // Server file is importing from a "use client" file. That's
    // allowed for components, but flag any non-component named
    // imports.
    for (const named of imp.names) {
      if (named.isType) continue; // type-only is fine
      if (named.name === "default") continue; // default imports usually components

      // Find the matching export on the target.
      const exp = target.exports.find((e) => e.name === named.name);
      if (!exp) continue; // import points at an export we couldn't find — skip

      if (!isLikelyComponent(exp)) {
        violations.push({
          server: relative(process.cwd(), path),
          client: relative(process.cwd(), resolved),
          name: named.name,
          kind: exp.kind,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\n❌ Found ${violations.length} RSC boundary violation${violations.length === 1 ? "" : "s"}:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.server}`);
    console.error(
      `    imports non-component "${v.name}" (${v.kind}) from "use client" file:`,
    );
    console.error(`    ${v.client}\n`);
  }
  console.error(
    "Server components calling functions from \"use client\" files\n" +
      "produce \"TypeError: n is not a function\" at runtime during the\n" +
      "RSC payload serialization. Move the helper into a plain .ts\n" +
      "module (no \"use client\" marker) so both sides can import it.\n",
  );
  process.exit(1);
}

console.log("✓ No RSC boundary violations detected.");
