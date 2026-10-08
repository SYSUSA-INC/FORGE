/**
 * BL-STAB-2 — the storage readiness probe in memory mode (no R2 here), and
 * the origins it checks. Pure: memory storage, no network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { probeStorage, uploadOrigins } from "@/lib/storage-diagnostics";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("probeStorage (memory fallback)", () => {
  it("passes the basic steps and is usable in development, through the app", async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.VERCEL_ENV;
    delete process.env.FORGE_ENV_OVERRIDE;
    const probe = await probeStorage({ origins: ["https://www.sysgov.com"] });
    expect(probe.provider).toBe("memory");
    expect(probe.transport).toBe("proxy");
    expect(probe.steps.slice(0, 4).map((s) => s.ok)).toEqual([true, true, true, true]);
    expect(probe.cors).toEqual([]);
    expect(probe.ready).toBe(true);
  });

  it("is not ready in production: files would vanish on the next deploy", async () => {
    delete process.env.R2_ACCOUNT_ID;
    process.env.FORGE_ENV_OVERRIDE = "production";
    const probe = await probeStorage({ origins: [] });
    expect(probe.ready).toBe(false);
    expect(probe.steps.at(-1)).toMatchObject({ ok: false });
    expect(probe.steps.at(-1)!.detail).toMatch(/vanish on the next deploy/);
  });
});

describe("uploadOrigins", () => {
  it("uses UPLOAD_ALLOWED_ORIGINS when set, else the app's base URL", () => {
    expect(uploadOrigins({ UPLOAD_ALLOWED_ORIGINS: "https://a.example/, https://b.example" })).toEqual(["https://a.example", "https://b.example"]);
    expect(uploadOrigins({ NEXT_PUBLIC_APP_URL: "https://forge.example/" })).toEqual(["https://forge.example"]);
  });
});
