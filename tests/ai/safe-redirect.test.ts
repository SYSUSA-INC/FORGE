/**
 * Sign-in redirect safety, including the BL-NAV-PORTAL same-origin
 * reduction of the absolute callbackUrl the auth middleware sends.
 */

import { describe, expect, it } from "vitest";
import { safeRedirectTarget, sameOriginPath } from "@/lib/safe-redirect";

describe("safeRedirectTarget", () => {
  it("accepts relative paths and falls back on everything else", () => {
    expect(safeRedirectTarget("/admin")).toBe("/admin");
    expect(safeRedirectTarget("/admin?tab=users", "/portal")).toBe("/admin?tab=users");
    expect(safeRedirectTarget(undefined, "/portal")).toBe("/portal");
    expect(safeRedirectTarget("", "/portal")).toBe("/portal");
    expect(safeRedirectTarget("https://evil.example/x", "/portal")).toBe("/portal");
    expect(safeRedirectTarget("//evil.example", "/portal")).toBe("/portal");
    expect(safeRedirectTarget("/api/auth/signout", "/portal")).toBe("/portal");
  });
});

describe("sameOriginPath", () => {
  const origin = "https://www.sysgov.com";

  it("reduces a same-origin absolute URL to its path and query", () => {
    expect(sameOriginPath("https://www.sysgov.com/admin?tab=users", origin)).toBe("/admin?tab=users");
    expect(sameOriginPath("https://www.sysgov.com/portal", origin)).toBe("/portal");
    expect(safeRedirectTarget(sameOriginPath("https://www.sysgov.com/users", origin), "/portal")).toBe(
      "/users",
    );
  });

  it("refuses other origins, including look-alike hosts", () => {
    expect(sameOriginPath("https://evil.example/admin", origin)).toBeNull();
    expect(sameOriginPath("https://www.sysgov.com.evil.example/", origin)).toBeNull();
    expect(sameOriginPath("http://www.sysgov.com/admin", origin)).toBeNull();
    expect(safeRedirectTarget(sameOriginPath("https://evil.example/admin", origin), "/portal")).toBe(
      "/portal",
    );
  });

  it("leaves relative paths and missing values alone", () => {
    expect(sameOriginPath("/admin", origin)).toBe("/admin");
    expect(sameOriginPath("https://www.sysgov.com/admin", null)).toBe("https://www.sysgov.com/admin");
    expect(sameOriginPath(undefined, origin)).toBeUndefined();
    expect(sameOriginPath(null, origin)).toBeNull();
  });
});
