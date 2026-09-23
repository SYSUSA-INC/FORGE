/**
 * BL-QC-links — the nav must not offer pages the user will be redirected
 * off. Mirrors the real NAV shape: four workspace-gated groups, Help,
 * and the superadmin-only Platform Administration.
 */

import { describe, expect, it } from "vitest";
import { visibleNavChildren, visibleNavGroups, type NavGroupLike } from "@/lib/nav-visibility";

const NAV: NavGroupLike[] = [
  { id: "command", needsWorkspace: true },
  {
    id: "ops",
    admin: true,
    needsWorkspace: true,
    children: [
      { href: "/settings" },
      { href: "/settings/billing", admin: true },
      { href: "/users" },
    ],
  },
  { id: "opps", needsWorkspace: true, children: [{ href: "/opportunities" }] },
  { id: "intel", needsWorkspace: true, children: [{ href: "/intelligence" }] },
  { id: "help", children: [{ href: "/help/user" }, { href: "/help/admin", admin: true }] },
  { id: "platform", superadmin: true, children: [{ href: "/admin" }] },
];

const ids = (gs: NavGroupLike[]) => gs.map((g) => g.id);

describe("nav visibility", () => {
  it("a member with a workspace sees everything but platform admin", () => {
    const v = { isOrgAdmin: false, isSuperadmin: false, hasWorkspace: true };
    expect(ids(visibleNavGroups(NAV, v))).toEqual(["command", "opps", "intel", "help"]);
    expect(visibleNavChildren(NAV[4]!.children, v).map((c) => c.href)).toEqual(["/help/user"]);
  });

  it("an org admin with a workspace also sees operations and admin-only children", () => {
    const v = { isOrgAdmin: true, isSuperadmin: false, hasWorkspace: true };
    expect(ids(visibleNavGroups(NAV, v))).toEqual(["command", "ops", "opps", "intel", "help"]);
    expect(visibleNavChildren(NAV[1]!.children, v).map((c) => c.href)).toEqual([
      "/settings",
      "/settings/billing",
      "/users",
    ]);
  });

  it("a superadmin with a workspace sees every group", () => {
    const v = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: true };
    expect(ids(visibleNavGroups(NAV, v))).toEqual(["command", "ops", "opps", "intel", "help", "platform"]);
  });

  it("without a workspace, only Help and (for superadmins) Platform Administration remain", () => {
    expect(ids(visibleNavGroups(NAV, { isOrgAdmin: false, isSuperadmin: false, hasWorkspace: false }))).toEqual([
      "help",
    ]);
    // The exact state the founder account was in: superadmin, no membership.
    expect(ids(visibleNavGroups(NAV, { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: false }))).toEqual([
      "help",
      "platform",
    ]);
  });

  it("returns the same objects, not copies", () => {
    const v = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: true };
    expect(visibleNavGroups(NAV, v)[0]).toBe(NAV[0]);
  });
});
