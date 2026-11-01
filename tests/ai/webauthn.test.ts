import { describe, expect, it } from "vitest";
import { expectedOrigins, WEBAUTHN_CHALLENGE_MS, webauthnConfig } from "@/lib/webauthn";

/** BL-STAB-8a-3 — the relying party from the environment. */
describe("webauthnConfig", () => {
  it("takes the app's origin and its host as the relying party", () => {
    const cfg = webauthnConfig({ NEXT_PUBLIC_APP_URL: "https://www.sysgov.com/" });
    expect(cfg).toEqual({ rpID: "www.sysgov.com", rpName: "FORGE", origin: "https://www.sysgov.com" });
  });

  it("prefers an explicit origin and relying-party id (previews on a parent domain)", () => {
    const cfg = webauthnConfig({ VERCEL_URL: "forge-abc.vercel.app", WEBAUTHN_ORIGIN: "https://forge-abc.vercel.app", WEBAUTHN_RP_ID: " vercel.app " });
    expect(cfg.rpID).toBe("vercel.app");
    expect(cfg.origin).toBe("https://forge-abc.vercel.app");
  });

  it("falls back to localhost on a bad origin", () => {
    expect(webauthnConfig({ NEXT_PUBLIC_APP_URL: "not a url" }).rpID).toBe("localhost");
  });

  it("accepts the local dev origin only for a localhost relying party", () => {
    expect(expectedOrigins(webauthnConfig({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }))).toEqual(["http://localhost:3000"]);
    expect(expectedOrigins(webauthnConfig({ NEXT_PUBLIC_APP_URL: "http://localhost:3100" }))).toEqual(["http://localhost:3100", "http://localhost:3000"]);
    expect(expectedOrigins(webauthnConfig({ NEXT_PUBLIC_APP_URL: "https://www.sysgov.com" }))).toEqual(["https://www.sysgov.com"]);
  });

  it("keeps a challenge for five minutes", () => {
    expect(WEBAUTHN_CHALLENGE_MS).toBe(300_000);
  });
});
