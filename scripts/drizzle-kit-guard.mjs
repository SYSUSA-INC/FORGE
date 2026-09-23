#!/usr/bin/env node
/**
 * Guard for `drizzle-kit push | generate | migrate` (BL-TENANT-DRIFT).
 *
 * FORGE applies schema changes from hand-written, forward-only SQL files
 * in drizzle/ via scripts/apply-schema.mjs (and the boot-time auto-apply).
 * drizzle-kit's own commands do something different:
 *
 *   push      diffs src/db/schema.ts against the LIVE database and applies
 *             the difference. Anything the SQL created that schema.ts does
 *             not declare identically is DROPPED — the 2026-09 audit found
 *             eight such details, now mirrored, and this guard keeps the
 *             next one from becoming a production incident.
 *   generate  writes a migration from the same diff, against a journal
 *             that stopped at 0017; the output would drop the same things.
 *   migrate   applies from that frozen journal and knows nothing about
 *             0018 onward.
 *
 * None of these is the supported path. If you are certain you need one
 * (a throwaway local database, or authoring a new migration by hand and
 * wanting drizzle-kit's diff as a starting point), set
 * FORGE_ALLOW_DRIZZLE_KIT=1 for that single invocation and read the output
 * before applying anything.
 */

import { spawnSync } from "node:child_process";

const [cmd, ...rest] = process.argv.slice(2);
const GUARDED = new Set(["push", "generate", "migrate"]);

if (!cmd || !GUARDED.has(cmd)) {
  console.error(`usage: node scripts/drizzle-kit-guard.mjs <push|generate|migrate> [args]`);
  process.exit(2);
}

if (process.env.FORGE_ALLOW_DRIZZLE_KIT !== "1") {
  console.error(
    [
      `✗ drizzle-kit ${cmd} is guarded in this repo.`,
      ``,
      `  Schema changes ship as drizzle/[NNNN]_*.sql files mirrored in src/db/schema.ts,`,
      `  and are applied with \`npm run db:apply\` (scripts/apply-schema.mjs) or on boot.`,
      `  \`drizzle-kit ${cmd}\` diffs schema.ts against a live database${cmd === "migrate" ? " journal frozen at 0017" : ""}`,
      `  and would drop every index or column detail the SQL created that the schema`,
      `  does not declare identically. \`npm run check:drift\` is the gate for that parity.`,
      ``,
      `  To run it anyway, for one invocation, against a database you are willing to lose:`,
      `    FORGE_ALLOW_DRIZZLE_KIT=1 npm run db:${cmd}`,
    ].join("\n"),
  );
  process.exit(1);
}

console.warn(`⚠ FORGE_ALLOW_DRIZZLE_KIT=1 — running drizzle-kit ${cmd} against DATABASE_URL.`);
const r = spawnSync("npx", ["drizzle-kit", cmd, ...rest], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
