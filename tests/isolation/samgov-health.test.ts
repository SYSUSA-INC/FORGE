/**
 * BL-STAB-10b — the public SAM.gov health probe spends at most one
 * shared-key request per 30 minutes (Postgres counter, fetch stubbed):
 * repeat calls get the last answer marked `cached`, and a counter that
 * fails open (database error) never buys a live probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings, rateLimitCounters } from "@/db/schema";
import * as rateLimit from "@/lib/rate-limit";
import { resetSamHealthMemo, samHealth } from "@/lib/samgov-health";

const KEY = "SharedKey0123456789abcdefghijklmnopqSHRD";

describe("BL-STAB-10b — the public health probe is capped", () => {
  let calls: URL[];
  async function clear() {
    resetSamHealthMemo();
    await db.delete(rateLimitCounters).where(eq(rateLimitCounters.key, "samgov:health-probe"));
    await db.delete(platformSettings).where(eq(platformSettings.key, "samgov.health_last"));
  }
  beforeEach(async () => {
    await clear();
    calls = [];
    vi.stubEnv("SAMGOV_API_KEY", KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        calls.push(new URL(String(input)));
        return new Response(JSON.stringify({ totalRecords: 5 }), { status: 200 });
      }),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clear();
  });

  it("one live probe per window; later calls (any server) get the last answer, marked cached", async () => {
    const first = await samHealth();
    expect(first).toMatchObject({ keyConfigured: true, apiReachable: true, status: 200, totalRecords: 5 });
    expect(await samHealth()).toEqual({ ...first, cached: true });
    resetSamHealthMemo(); // another server: no memory, the counter decides
    expect(await samHealth()).toEqual({ ...first, cached: true });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain(KEY);
  });

  it("a counter that failed open is not a turn: no live probe", async () => {
    vi.spyOn(rateLimit, "enforceRateLimit").mockResolvedValue({ ok: true, remaining: 1, resetIn: 1800 });
    expect(await samHealth()).toMatchObject({ keyConfigured: true, apiReachable: null, cached: true });
    expect(calls).toHaveLength(0);
  });
});
