/**
 * BL-AIX Phase 1a — provider calls get a deadline and retries.
 */
import { describe, expect, it } from "vitest";
import { DeadlineError, fetchWithRetry, isRetryableStatus, retryDelayMs } from "@/lib/http-retry";

const reply = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? "{}" : "busy", { status, headers });

function scripted(steps: (Response | Error | "hang")[]) {
  const calls: number[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(calls.length + 1);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if (step === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  return { fetchImpl, calls, slept, sleep };
}

describe("retry policy", () => {
  it("retries rate limits, overloads and 5xx, not client errors", () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isRetryableStatus(s)).toBe(false);
  });

  it("honours retry-after (seconds or a date), capped, else full-jitter backoff", () => {
    expect(retryDelayMs(1, "3")).toBe(3_000);
    expect(retryDelayMs(1, "600")).toBe(30_000);
    const now = Date.UTC(2026, 9, 5, 12, 0, 0);
    expect(retryDelayMs(1, new Date(now + 5_000).toUTCString(), Math.random, now)).toBe(5_000);
    expect(retryDelayMs(1, null, () => 0.5)).toBe(500);
    expect(retryDelayMs(3, null, () => 0.999)).toBe(3_996);
    expect(retryDelayMs(10, null, () => 0.999)).toBeLessThanOrEqual(20_000);
  });
});

describe("fetchWithRetry", () => {
  const base = { label: "Test", timeoutMs: 50, rand: () => 0.5 };

  it("retries a 529 and returns the success", async () => {
    const s = scripted([reply(529), reply(429, { "retry-after": "2" }), reply(200)]);
    const res = await fetchWithRetry("https://x", {}, { ...base, fetchImpl: s.fetchImpl, sleep: s.sleep });
    expect(res.status).toBe(200);
    expect(s.calls).toHaveLength(3);
    expect(s.slept).toEqual([500, 2_000]);
  });

  it("returns a non-retryable error at once and the last error after the attempts", async () => {
    const bad = scripted([reply(400), reply(200)]);
    expect((await fetchWithRetry("https://x", {}, { ...base, fetchImpl: bad.fetchImpl, sleep: bad.sleep })).status).toBe(400);
    expect(bad.calls).toHaveLength(1);

    const busy = scripted([reply(503)]);
    expect((await fetchWithRetry("https://x", {}, { ...base, maxAttempts: 3, fetchImpl: busy.fetchImpl, sleep: busy.sleep })).status).toBe(503);
    expect(busy.calls).toHaveLength(3);
  });

  it("retries a dropped connection, then gives up with the error", async () => {
    const flaky = scripted([new Error("ECONNRESET"), reply(200)]);
    expect((await fetchWithRetry("https://x", {}, { ...base, fetchImpl: flaky.fetchImpl, sleep: flaky.sleep })).status).toBe(200);
    const dead = scripted([new Error("ECONNRESET")]);
    await expect(fetchWithRetry("https://x", {}, { ...base, fetchImpl: dead.fetchImpl, sleep: dead.sleep })).rejects.toThrow("ECONNRESET");
    expect(dead.calls).toHaveLength(3);
  });

  it("fails a hung call at the deadline without retrying it", async () => {
    const hung = scripted(["hang"]);
    await expect(fetchWithRetry("https://x", {}, { ...base, fetchImpl: hung.fetchImpl, sleep: hung.sleep })).rejects.toBeInstanceOf(DeadlineError);
    expect(hung.calls).toHaveLength(1);
  });

  it("stops retrying when the next wait would overrun the budget", async () => {
    const s = scripted([reply(429, { "retry-after": "20" }), reply(200)]);
    const res = await fetchWithRetry("https://x", {}, { ...base, budgetMs: 5_000, fetchImpl: s.fetchImpl, sleep: s.sleep });
    expect(res.status).toBe(429);
    expect(s.calls).toHaveLength(1);
  });
});
