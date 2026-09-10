/**
 * BL-TENANT-AUDIT 2026-09 — the boot-time schema check must point at the
 * newest migration, otherwise a database missing recent tables boots
 * with a reassuring "schema in sync" log. Reads the constant out of the
 * source text so this stays a pure test (the module imports the DB).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

describe("migration-check", () => {
  it("EXPECTED_LATEST_MIGRATION names the newest drizzle/*.sql file", () => {
    const newest = readdirSync(join(ROOT, "drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .at(-1);
    const src = readFileSync(join(ROOT, "src/lib/migration-check.ts"), "utf-8");
    const m = src.match(/EXPECTED_LATEST_MIGRATION\s*=\s*"([^"]+)"/);
    expect(m, "constant not found").not.toBeNull();
    expect(m![1]).toBe(newest);
  });
});
