/**
 * BL-DOMAIN-FORGEAXI phase 2 — the sender and the authenticator name come
 * from the site's own address, not a hard-coded domain; EMAIL_FROM still
 * overrides the sender.
 */
import { describe, expect, it } from "vitest";
import { emailFrom, emailFromAddress, emailFromDomain, mfaIssuer, siteDomain } from "@/lib/site-domain";

const prod = { VERCEL_ENV: "production" };

describe("site domain names", () => {
  it("follows the site's address, without www", () => {
    expect(siteDomain(prod)).toBe("forgeaxi.com");
    expect(siteDomain({ NEXT_PUBLIC_APP_URL: "https://app.example.org/" })).toBe("app.example.org");
    expect(siteDomain({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe("localhost");
  });

  it("names the authenticator entry after the site", () => {
    expect(mfaIssuer(prod)).toBe("FORGE (forgeaxi.com)");
    expect(mfaIssuer({ NEXT_PUBLIC_APP_URL: "https://www.example.org" })).toBe("FORGE (example.org)");
  });

  it("sends from noreply at the site's domain unless EMAIL_FROM says otherwise", () => {
    expect(emailFrom(prod)).toBe("FORGE <noreply@forgeaxi.com>");
    expect(emailFromAddress(prod)).toBe("noreply@forgeaxi.com");
    expect(emailFromDomain(prod)).toBe("forgeaxi.com");
    const env = { ...prod, EMAIL_FROM: "FORGE <alerts@mail.forgeaxi.com>" };
    expect(emailFrom(env)).toBe("FORGE <alerts@mail.forgeaxi.com>");
    expect(emailFromAddress(env)).toBe("alerts@mail.forgeaxi.com");
    expect(emailFromDomain(env)).toBe("mail.forgeaxi.com");
    expect(emailFromAddress({ ...prod, EMAIL_FROM: "bids@forgeaxi.com" })).toBe("bids@forgeaxi.com");
    expect(emailFromAddress({ ...prod, EMAIL_FROM_ADDRESS: "noreply@other.com", EMAIL_FROM: "x <a@b.com>" })).toBe("noreply@other.com");
    expect(emailFrom({ ...prod, EMAIL_FROM: "   " })).toBe("FORGE <noreply@forgeaxi.com>");
  });
});
