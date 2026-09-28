/**
 * BL-NAV-WORKSPACES — three role-scoped navigation workspaces.
 */

import { describe, expect, it } from "vitest";
import { visibleNavChildren, visibleNavGroups } from "@/lib/nav-visibility";
import {
  availableWorkspaces,
  defaultWorkspace,
  NAV_BY_WORKSPACE,
  PORTAL_PICKER_PATH,
  portalChoices,
  portalLanding,
  resolveWorkspace,
  WORKSPACES,
  workspaceForPath,
} from "@/lib/nav-workspaces";

const member = { isOrgAdmin: false, isSuperadmin: false, hasWorkspace: true };
const orgAdmin = { isOrgAdmin: true, isSuperadmin: false, hasWorkspace: true };
const superWithTenant = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: true };
const superNoTenant = { isOrgAdmin: true, isSuperadmin: true, hasWorkspace: false };
const nobody = { isOrgAdmin: false, isSuperadmin: false, hasWorkspace: false };

describe("workspaceForPath", () => {
  it("routes platform, company and work URLs", () => {
    expect(workspaceForPath("/admin")).toBe("platform");
    expect(workspaceForPath("/admin/orgs/abc/users")).toBe("platform");
    expect(workspaceForPath("/platform/audit-log")).toBe("platform");
    expect(workspaceForPath("/users")).toBe("company");
    expect(workspaceForPath("/settings/billing")).toBe("company");
    expect(workspaceForPath("/notifications/rules")).toBe("company");
    expect(workspaceForPath("/settings")).toBe("work");
    expect(workspaceForPath("/settings/ai-engine")).toBe("work");
    expect(workspaceForPath("/notifications")).toBe("work");
    expect(workspaceForPath("/proposals/1/sections")).toBe("work");
    expect(workspaceForPath(null)).toBe("work");
    // "/administration-like" prefixes are not the admin workspace.
    expect(workspaceForPath("/adminish")).toBe("work");
  });
});

describe("availableWorkspaces / defaultWorkspace / resolveWorkspace", () => {
  it("offers each hat only to who wears it", () => {
    expect(availableWorkspaces(member)).toEqual(["work"]);
    expect(availableWorkspaces(orgAdmin)).toEqual(["work", "company"]);
    expect(availableWorkspaces(superWithTenant)).toEqual(["work", "company", "platform"]);
    expect(availableWorkspaces(superNoTenant)).toEqual(["platform"]);
    expect(availableWorkspaces(nobody)).toEqual([]);
  });

  it("lands people in their own workspace", () => {
    expect(defaultWorkspace(member)).toBe("work");
    expect(defaultWorkspace(superNoTenant)).toBe("platform");
    expect(defaultWorkspace(nobody)).toBe("work");
    // A member on an admin URL is shown the work workspace (the page itself refuses).
    expect(resolveWorkspace("/users", member)).toBe("work");
    expect(resolveWorkspace("/users", orgAdmin)).toBe("company");
    expect(resolveWorkspace("/admin/tiers", orgAdmin)).toBe("work");
    expect(resolveWorkspace("/admin/tiers", superWithTenant)).toBe("platform");
    expect(resolveWorkspace("/", superNoTenant)).toBe("platform");
  });
});

describe("BL-NAV-PORTAL — portal choice at sign-in", () => {
  it("offers the account's portals, highest hat first", () => {
    expect(portalChoices(member).map((c) => c.title)).toEqual(["Proposal Tool"]);
    expect(portalChoices(orgAdmin).map((c) => c.title)).toEqual([
      "Company Admin Portal",
      "Proposal Tool",
    ]);
    expect(portalChoices(superWithTenant).map((c) => c.title)).toEqual([
      "Super Admin Portal",
      "Company Admin Portal",
      "Proposal Tool",
    ]);
    expect(portalChoices(superNoTenant).map((c) => c.home)).toEqual(["/admin"]);
    expect(portalChoices(nobody)).toEqual([]);
    // Each choice lands on its workspace's home.
    for (const c of portalChoices(superWithTenant)) {
      expect(c.home).toBe(WORKSPACES[c.workspace].home);
    }
  });

  it("lands single-portal accounts directly and multi-portal accounts on the picker", () => {
    expect(portalLanding(member)).toBe("/");
    expect(portalLanding(superNoTenant)).toBe("/admin");
    expect(portalLanding(orgAdmin)).toBe(PORTAL_PICKER_PATH);
    expect(portalLanding(superWithTenant)).toBe(PORTAL_PICKER_PATH);
    // No tenant and no platform role: the work home onboards the account.
    expect(portalLanding(nobody)).toBe("/");
  });
});

describe("workspace navigation trees", () => {
  it("keeps platform pages out of the work and company trees, and tenant work out of platform", () => {
    const hrefs = (w: keyof typeof NAV_BY_WORKSPACE) =>
      NAV_BY_WORKSPACE[w].flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)]).filter(
        (h): h is string => !!h,
      );
    expect(hrefs("work").some((h) => h.startsWith("/admin") || h.startsWith("/platform"))).toBe(false);
    expect(hrefs("company").some((h) => h.startsWith("/admin") || h.startsWith("/platform"))).toBe(false);
    expect(
      hrefs("platform").some((h) => ["/opportunities", "/proposals", "/knowledge-base", "/users"].some((p) => h.startsWith(p))),
    ).toBe(false);
    for (const w of ["work", "company", "platform"] as const) {
      const list = hrefs(w);
      expect(new Set(list).size).toBe(list.length);
      expect(list.every((h) => h.startsWith("/"))).toBe(true);
    }
  });

  it("the company console is empty for a plain member and full for an admin", () => {
    const memberGroups = visibleNavGroups(NAV_BY_WORKSPACE.company, member);
    expect(memberGroups.map((g) => g.id)).toEqual(["help"]);
    const adminGroups = visibleNavGroups(NAV_BY_WORKSPACE.company, orgAdmin);
    expect(adminGroups.map((g) => g.id)).toEqual(["people", "organization", "governance", "help"]);
    expect(visibleNavChildren(adminGroups[1]!.children, orgAdmin).map((c) => c.href)).toContain("/settings/billing");
  });

  it("the platform tree needs no tenant and the work tree needs one", () => {
    expect(visibleNavGroups(NAV_BY_WORKSPACE.platform, superNoTenant).map((g) => g.id)).toEqual([
      "tenants",
      "commercial",
      "operations",
      "help",
    ]);
    expect(visibleNavGroups(NAV_BY_WORKSPACE.work, superNoTenant).map((g) => g.id)).toEqual(["help"]);
    expect(WORKSPACES.platform.home).toBe("/admin");
    expect(WORKSPACES.company.home).toBe("/users");
  });
});
