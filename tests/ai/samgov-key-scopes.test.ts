/**
 * BL-STAB-7c — who may use which SAM.gov key, pinned by a scan of the
 * source: platform data (the 8(a) registry, cert refresh, gold set, the
 * public health probe) never resolves a company's key; only the key
 * module reads SAMGOV_API_KEY; only the SAM.gov client builds key URLs;
 * the cert refresh is not a server action; the unused entity route is gone.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const read = (p: string) => readFileSync(p, "utf8");

describe("BL-STAB-7c — SAM.gov key scopes", () => {
  it("platform data never resolves a company's key", () => {
    const platformOnly = [
      "src/lib/sba-8a.ts",
      "src/lib/cert-refresh.ts",
      "src/lib/gold-set.ts",
      "src/app/api/samgov/health/route.ts",
      "src/lib/samgov-health.ts",
      ...walk("src/app/(app)/admin/sba-8a"),
    ];
    for (const file of platformOnly) {
      const src = read(file);
      expect(src, file).not.toMatch(/resolveSamCredential|organizationSamgovKeys|organization_samgov_key/);
    }
  });

  it("only the key module reads SAMGOV_API_KEY, and only the SAM.gov client builds key URLs", () => {
    for (const file of walk("src")) {
      const src = read(file);
      if (file !== join("src", "lib", "samgov-key.ts")) expect(src, file).not.toMatch(/process\.env\.SAMGOV_API_KEY|env\.SAMGOV_API_KEY/);
      if (!["samgov.ts", "samgov-errors.ts"].some((f) => file === join("src", "lib", f))) expect(src, file).not.toMatch(/["'`?&]api_key=/);
    }
  });

  it("the cert refresh is not a server action, and every 8(a) action checks for a platform admin", () => {
    const actions = read("src/app/(app)/admin/sba-8a/actions.ts");
    expect(actions).not.toMatch(/export async function runCertRefreshFromCron/);
    const bodies = actions.split(/\nexport async function /).slice(1);
    expect(bodies.length).toBeGreaterThan(0);
    // The first thing each action awaits is the platform-admin gate.
    for (const body of bodies) expect(/await (\w+)/.exec(body)?.[1], body.slice(0, 40)).toBe("requireSuperadmin");
    expect(read("src/app/api/cron/refresh-certifications/route.ts")).toMatch(/from "@\/lib\/cert-refresh"/);
    expect(existsSync("src/app/api/samgov/entity/route.ts")).toBe(false);
  });
});
