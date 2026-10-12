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
      "src/lib/sam-notice-csv.ts",
      "src/lib/sam-notice-load.ts",
      "src/app/api/cron/sam-notices/route.ts",
      "src/lib/sam-notice-admin.ts",
      "src/lib/sam-notice-store.ts",
      ...walk("src/app/(app)/admin/sam-notices"),
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

  it("BL-STAB-10b — only the nightly load writes FORGE's copy of SAM.gov descriptions, and it holds no company data", () => {
    for (const file of walk("src")) {
      if (file === join("src", "lib", "sam-notice-load.ts")) continue;
      expect(read(file), file).not.toMatch(/\.(insert|update|delete)\(samNotices\)|(INSERT INTO|UPDATE|DELETE FROM)\s+"?sam_notice\b/);
    }
    const ddl = read("drizzle/0129_sam_notice.sql").replace(/--.*$/gm, "");
    expect(ddl).not.toMatch(/organization_id|user_id|email|phone/);
  });

  it("the cert refresh is not a server action, and every 8(a) action checks for a platform admin", () => {
    const actions = read("src/app/(app)/admin/sba-8a/actions.ts");
    expect(actions).not.toMatch(/export async function runCertRefreshFromCron/);
    const bodies = actions.split(/\nexport async function /).slice(1);
    expect(bodies.length).toBeGreaterThan(0);
    // The first thing each action awaits is the platform-admin gate.
    for (const body of bodies) expect(/await (\w+)/.exec(body)?.[1], body.slice(0, 40)).toBe("requireSuperadmin");
    expect(read("src/app/api/cron/refresh-certifications/route.ts")).toMatch(/from "@\/lib\/cert-refresh"/);
    // BL-STAB-10b — the SAM.gov notice copy's actions check for a platform admin first too.
    const copy = read("src/app/(app)/admin/sam-notices/actions.ts").split(/\nexport async function /).slice(1);
    expect(copy).toHaveLength(3);
    for (const body of copy) expect(/await (\w+)/.exec(body)?.[1], body.slice(0, 40)).toBe("requireSuperadmin");
    expect(existsSync("src/app/api/samgov/entity/route.ts")).toBe(false);
  });
});
