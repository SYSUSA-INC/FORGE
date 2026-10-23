import { describe, expect, it } from "vitest";
import { isAllowedRedirect, safeRedirectTarget } from "@/lib/safe-redirect";

describe("safeRedirectTarget", () => {
  it("keeps in-app paths, with query and hash", () => {
    expect(safeRedirectTarget("/proposals/abc?tab=reviews#top")).toBe("/proposals/abc?tab=reviews#top");
    expect(safeRedirectTarget("/")).toBe("/");
  });

  it("falls back for empty and non-string input", () => {
    expect(safeRedirectTarget(undefined)).toBe("/");
    expect(safeRedirectTarget(null, "/home")).toBe("/home");
    expect(safeRedirectTarget("   ")).toBe("/");
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "/foo\\bar",
    "/api/auth/signout",
    "/ok\nSet-Cookie: x=1",
    "/ok\u0000",
    "/ok\u007f",
    "/a b",
    "javascript:alert(1)",
  ])("rejects %j", (raw) => {
    expect(isAllowedRedirect(raw)).toBe(false);
    expect(safeRedirectTarget(raw, "/fallback")).toBe("/fallback");
  });
});
