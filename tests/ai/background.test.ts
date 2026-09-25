/**
 * BL-AIP-4 — durable fire-and-forget helper.
 *
 * With a Vercel request context present the promise is handed to its
 * `waitUntil`; without one the task still runs and failures are logged,
 * never thrown.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundIsDurable, runInBackground } from "@/lib/background";

const SYMBOL = Symbol.for("@vercel/request-context");
const g = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  delete g[SYMBOL];
  vi.restoreAllMocks();
});

describe("runInBackground", () => {
  it("hands the task to Vercel's waitUntil when a request context exists", async () => {
    const waited: Promise<unknown>[] = [];
    g[SYMBOL] = { get: () => ({ waitUntil: (p: Promise<unknown>) => waited.push(p) }) };
    expect(backgroundIsDurable()).toBe(true);

    let ran = false;
    runInBackground("[test]", async () => {
      ran = true;
    });
    expect(waited.length).toBe(1);
    await waited[0];
    expect(ran).toBe(true);
  });

  it("runs detached and swallows rejections when no context exists", async () => {
    expect(backgroundIsDurable()).toBe(false);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let ran = false;
    runInBackground("[test]", async () => {
      ran = true;
      throw new Error("boom");
    });
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(ran).toBe(true);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("survives a synchronous throw from the task factory", () => {
    expect(() =>
      runInBackground("[test]", () => {
        throw new Error("sync boom");
      }),
    ).not.toThrow();
  });
});
