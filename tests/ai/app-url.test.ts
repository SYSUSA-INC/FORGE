/**
 * BL-AUTH-INVITE — the links in invite / reset emails must be the same
 * links an admin copies from the UI, and must resolve the origin the
 * same way on Vercel and locally.
 */

import { describe, expect, it } from "vitest";
import {
  appBaseUrl,
  inviteUrl,
  passwordResetUrl,
  verifyEmailUrl,
} from "@/lib/app-url";

describe("appBaseUrl", () => {
  it("prefers the explicit app URL and strips trailing slashes", () => {
    expect(appBaseUrl({ NEXT_PUBLIC_APP_URL: "https://forge.example.com/" })).toBe(
      "https://forge.example.com",
    );
    expect(appBaseUrl({ AUTH_URL: "https://auth.example.com" })).toBe(
      "https://auth.example.com",
    );
  });

  it("falls back to the production domain, then the Vercel URL", () => {
    expect(appBaseUrl({ VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://www.sysgov.com",
    );
    expect(appBaseUrl({ VERCEL_ENV: "preview", VERCEL_URL: "forge-abc.vercel.app" })).toBe(
      "https://forge-abc.vercel.app",
    );
    expect(appBaseUrl({})).toBe("https://www.sysgov.com");
  });
});

describe("auth links", () => {
  const base = "https://forge.example.com";

  it("builds the invite link the sign-up page and /api/register read", () => {
    expect(inviteUrl("inv-1", "tok/en+x", base)).toBe(
      "https://forge.example.com/sign-up?invite=tok%2Fen%2Bx&id=inv-1",
    );
  });

  it("builds the reset and verify links with the email encoded", () => {
    expect(passwordResetUrl("a+b@x.io", "t", base)).toBe(
      "https://forge.example.com/reset-password?token=t&email=a%2Bb%40x.io",
    );
    expect(verifyEmailUrl("a@x.io", "t", base)).toBe(
      "https://forge.example.com/verify-email?token=t&email=a%40x.io",
    );
  });
});
