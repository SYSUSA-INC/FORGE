/**
 * BL-QC-boot-hook — the boot hook has to be wired up, not just written.
 *
 * On Next 14 `src/instrumentation.ts` only loads when
 * `experimental.instrumentationHook` is true. Production ran for months
 * without the flag: no auto-apply, no schema check, no env marker, and
 * the migration ledger sat at 0 applied until an operator clicked
 * /admin/migrations. This pins the flag (and its removal on Next 15,
 * where the hook is stable and the option is gone).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM config without types
import nextConfig from "../../next.config.mjs";

const nextMajor = Number(
  (
    JSON.parse(
      readFileSync(join(process.cwd(), "node_modules/next/package.json"), "utf-8"),
    ) as { version: string }
  ).version.split(".")[0],
);

const flag = (
  nextConfig as { experimental?: { instrumentationHook?: boolean } }
).experimental?.instrumentationHook;

describe("instrumentation hook", () => {
  it("is enabled in next.config.mjs on Next 14 (otherwise src/instrumentation.ts never runs)", () => {
    if (nextMajor >= 15) {
      // Stable in 15; the option was removed and setting it fails the
      // config schema. Drop this branch when the upgrade lands.
      expect(flag).toBeUndefined();
      return;
    }
    expect(nextMajor).toBe(14);
    expect(flag).toBe(true);
  });

  it("src/instrumentation.ts skips the build phase and awaits the boot work with a budget", () => {
    const src = readFileSync(join(process.cwd(), "src/instrumentation.ts"), "utf-8");
    expect(src).toContain('process.env.NEXT_PHASE === "phase-production-build"');
    expect(src).toMatch(/await Promise\.race\(/);
    expect(src).toContain("BOOT_BUDGET_MS");
    // The pruning contract: Node-only imports live inside the runtime check.
    expect(src).toContain('if (process.env.NEXT_RUNTIME === "nodejs") {');
  });
});
