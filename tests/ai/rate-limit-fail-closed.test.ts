import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "down" as "down" | { count: number } }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  db: {
    execute: async () => {
      if (state.mode === "down") throw new Error("db down");
      return { rows: [state.mode] };
    },
  },
}));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { enforceRateLimit } from "@/lib/rate-limit";

const opts = { key: "signin:email:a@b.co", limit: 3, windowSeconds: 900 };

describe("enforceRateLimit when the counter store fails", () => {
  it("fails open by default", async () => {
    state.mode = "down";
    const r = await enforceRateLimit(opts);
    expect(r.ok).toBe(true);
  });

  it("fails closed when asked, with a retry time", async () => {
    state.mode = "down";
    const r = await enforceRateLimit({ ...opts, failClosed: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("still counts normally when the store works", async () => {
    state.mode = { count: 4 };
    expect((await enforceRateLimit({ ...opts, failClosed: true })).ok).toBe(false);
    state.mode = { count: 3 };
    expect((await enforceRateLimit({ ...opts, failClosed: true })).ok).toBe(true);
  });
});
