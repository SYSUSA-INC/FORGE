/**
 * BL-STAB-7c — the cert-firm refresh on FORGE's shared key, against
 * Postgres with fetch stubbed: a rejected key stops the run after one
 * call, the stored error is plain operator wording (no HTML), and every
 * later cert type says it wasn't pulled and why. The public health probe
 * reports reachability only, never the upstream body or the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { certImportRuns } from "@/db/schema";
import { runCertRefresh } from "@/lib/cert-refresh";
import { GET as healthGet } from "@/app/api/samgov/health/route";

const KEY = "SharedKey0123456789abcdefghijklmnopqSHRD";
const OWNER_BODY = "<html><body><h1>API_KEY_INVALID</h1></body></html>";

describe("BL-STAB-7c — cert refresh and health on the shared key", () => {
  let started: Date;
  let calls: URL[];

  beforeEach(() => {
    started = new Date(Date.now() - 1000);
    calls = [];
    vi.stubEnv("SAMGOV_API_KEY", KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        calls.push(new URL(String(input)));
        return new Response(OWNER_BODY, { status: 401 });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.delete(certImportRuns).where(and(eq(certImportRuns.source, "cron.sam.gov"), gte(certImportRuns.startedAt, started)));
  });

  it("stops after the first rejected-key answer and says so for every later cert type", async () => {
    const result = await runCertRefresh();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("api_key")).toBe(KEY);
    const [first, ...rest] = result.pulled;
    expect(first!.error).toMatch(/^SAM\.gov rejected FORGE's shared key SAMGOV_API_KEY\. .*\(SAM\.gov API_KEY_INVALID, HTTP 401\)$/);
    expect(first!.error).not.toMatch(/[<>]/);
    expect(rest.length).toBeGreaterThan(0);
    for (const r of rest) expect(r.error).toBe(`Not pulled: SAM.gov stopped this run earlier — ${first!.error}`);

    const runs = await db
      .select({ certType: certImportRuns.certType, status: certImportRuns.status, error: certImportRuns.error })
      .from(certImportRuns)
      .where(and(eq(certImportRuns.source, "cron.sam.gov"), gte(certImportRuns.startedAt, started)));
    expect(runs).toEqual([{ certType: first!.certType, status: "failed", error: first!.error }]);
  });

  it("without a shared key nothing is called and every cert type names the setting", async () => {
    vi.stubEnv("SAMGOV_API_KEY", "");
    const result = await runCertRefresh();
    expect(calls).toHaveLength(0);
    for (const r of result.pulled) expect(r.error).toMatch(/SAMGOV_API_KEY is not set/);
  });

  it("the public health probe reports reachability only", async () => {
    const res = await healthGet();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ keyConfigured: true, apiReachable: false, status: 401 });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("API_KEY_INVALID");
  });
});
