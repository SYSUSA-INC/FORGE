import { describe, expect, it } from "vitest";
import { allowedHosts, expectedOrigins, passkeyUsableAt, WEBAUTHN_CHALLENGE_MS, webauthnConfig, webauthnConfigFor } from "@/lib/webauthn";

/** BL-STAB-8a-3 — the relying party from the environment. */
describe("webauthnConfig", () => {
  it("takes the app's origin and its host as the relying party", () => {
    const cfg = webauthnConfig({ NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com/" });
    expect(cfg).toEqual({ rpID: "www.forgeaxi.com", rpName: "FORGE", origin: "https://www.forgeaxi.com" });
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
    expect(expectedOrigins(webauthnConfig({ NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com" }))).toEqual(["https://www.forgeaxi.com"]);
  });

  it("keeps a challenge for five minutes", () => {
    expect(WEBAUTHN_CHALLENGE_MS).toBe(300_000);
  });
});

/**
 * BL-MFA-RECOVERY — the relying party from the address the person is on.
 * The lockout this replaces: production fell back to www.sysgov.com, so on
 * www.forgeaxi.com every passkey request named the wrong domain.
 */
describe("webauthnConfigFor", () => {
  const prod = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "www.forgeaxi.com" };

  it("uses the address in the browser when it is one of the site's own", () => {
    expect(webauthnConfigFor("www.forgeaxi.com", prod)).toEqual({ rpID: "www.forgeaxi.com", rpName: "FORGE", origin: "https://www.forgeaxi.com" });
    // The bare twin of an allowed host is allowed too.
    expect(webauthnConfigFor("forgeaxi.com", prod).rpID).toBe("forgeaxi.com");
  });

  it("follows a domain move with no setting changed: the old fallback no longer decides", () => {
    // No NEXT_PUBLIC_APP_URL, the production domain from Vercel, the site on forgeaxi.com.
    const cfg = webauthnConfigFor("www.forgeaxi.com:443", prod);
    expect(cfg.rpID).toBe("www.forgeaxi.com");
    expect(cfg.origin).toBe("https://www.forgeaxi.com");
  });

  it("never takes a Host it doesn't know: falls back to the configured site", () => {
    expect(webauthnConfigFor("evil.example.com", { NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com" }).rpID).toBe("www.forgeaxi.com");
    expect(webauthnConfigFor(null, { NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com" }).rpID).toBe("www.forgeaxi.com");
    expect(webauthnConfigFor("not a host", { NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com" }).rpID).toBe("www.forgeaxi.com");
  });

  it("serves a preview at its own Vercel URL and a local run on its port", () => {
    expect(webauthnConfigFor("forge-git-x.vercel.app", { VERCEL_ENV: "preview", VERCEL_URL: "forge-abc.vercel.app", VERCEL_BRANCH_URL: "forge-git-x.vercel.app" }).origin).toBe("https://forge-git-x.vercel.app");
    expect(webauthnConfigFor("localhost:3100", {})).toEqual({ rpID: "localhost", rpName: "FORGE", origin: "http://localhost:3100" });
  });

  it("keeps a shared parent domain as the id for the hosts under it", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://app.forgeaxi.com", WEBAUTHN_RP_ID: "forgeaxi.com", WEBAUTHN_EXTRA_HOSTS: "eu.forgeaxi.com" };
    expect(webauthnConfigFor("eu.forgeaxi.com", env)).toMatchObject({ rpID: "forgeaxi.com", origin: "https://eu.forgeaxi.com" });
  });

  it("lists the site's own addresses", () => {
    const hosts = allowedHosts({ NEXT_PUBLIC_APP_URL: "https://www.forgeaxi.com", VERCEL_URL: "forge-abc.vercel.app" });
    expect(hosts).toEqual(expect.arrayContaining(["localhost", "www.forgeaxi.com", "forgeaxi.com", "forge-abc.vercel.app"]));
    // A Vercel URL is exact: no www twin is invented for it.
    expect(hosts).not.toContain("www.forge-abc.vercel.app");
  });

  it("offers a passkey only where it was made (older ones, with no record, are tried)", () => {
    const here = webauthnConfigFor("www.forgeaxi.com", prod);
    expect(passkeyUsableAt("www.forgeaxi.com", here)).toBe(true);
    expect(passkeyUsableAt("www.sysgov.com", here)).toBe(false);
    expect(passkeyUsableAt(null, here)).toBe(true);
  });
});
