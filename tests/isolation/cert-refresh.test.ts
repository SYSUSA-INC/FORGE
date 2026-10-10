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
import { certFirms, certImportRuns } from "@/db/schema";
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.delete(certFirms).where(eq(certFirms.uei, "TESTPARTIAL1"));
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
    expect((await (await healthGet()).json()).message).toMatch(/SAMGOV_API_KEY is not set/);
  });

  it("starts with the cert type pulled least recently, and records one the budget cut short as partial", async () => {
    // 8(a) was refreshed just now, so this run starts with another type.
    await db.insert(certImportRuns).values({ source: "cron.sam.gov", certType: "8a", status: "ok" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        calls.push(new URL(String(input)));
        vi.setSystemTime(Date.now() + 40_000); // the first page "takes" the whole budget
        const entity = { entityRegistration: { ueiSAM: "TESTPARTIAL1", legalBusinessName: "Partial Test LLC" } };
        return new Response(JSON.stringify({ totalRecords: 500, entityData: [entity] }), { status: 200 });
      }),
    );
    const result = await runCertRefresh();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("sbaBusinessTypeCode")).not.toBe("A6");
    const [first, ...rest] = result.pulled;
    expect(first).toMatchObject({ rowsUpserted: 1, error: "Stopped after page 1 of 30: this run's time budget was used up." });
    for (const r of rest) expect(r.error).toBe("Not pulled: this run's time budget was used up; the next run starts with this cert type.");
    expect(rest.at(-1)!.certType).toBe("8a");
    const [run] = await db
      .select({ status: certImportRuns.status })
      .from(certImportRuns)
      .where(and(eq(certImportRuns.source, "cron.sam.gov"), eq(certImportRuns.certType, first!.certType), gte(certImportRuns.startedAt, started)));
    expect(run).toEqual({ status: "partial" });
  });

  it("the public health probe reports reachability only", async () => {
    const res = await healthGet();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ keyConfigured: true, apiReachable: false, status: 401 });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("API_KEY_INVALID");
  });
});
