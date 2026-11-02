/**
 * BL-NAV-WORKSPACES — three role-scoped navigation workspaces.
 */

import { describe, expect, it } from "vitest";
import { flattenNavItems, visibleNavChildren, visibleNavGroups } from "@/lib/nav-visibility";
import {
  availableWorkspaces,
  defaultWorkspace,
  isWorkspace,
  NAV_BY_WORKSPACE,
  pathInWorkspace,
  resolveWorkspace,
  WORKSPACES,
  WORK_SHORTCUTS,
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
    expect(workspaceForPath("/settings/api")).toBe("company");
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

describe("BL-NAV-RESTORE — the chosen workspace is remembered", () => {
  it("keeps an admin in the everyday tree on an admin page they opened from it", () => {
    expect(resolveWorkspace("/users", orgAdmin, "work")).toBe("work");
    expect(resolveWorkspace("/settings/templates/abc", orgAdmin, "work")).toBe("work");
    expect(resolveWorkspace("/audit-log", superWithTenant, "work")).toBe("work");
    // Without a choice the URL still decides.
    expect(resolveWorkspace("/users", orgAdmin, null)).toBe("company");
    expect(resolveWorkspace("/users", orgAdmin)).toBe("company");
  });

  it("leaves the chosen workspace only for a page it does not list", () => {
    expect(resolveWorkspace("/opportunities/abc", orgAdmin, "company")).toBe("work");
    expect(resolveWorkspace("/admin/tiers", superWithTenant, "work")).toBe("platform");
    expect(resolveWorkspace("/help/admin", superWithTenant, "platform")).toBe("platform");
    // An unlisted page (onboarding) never bounces the person.
    expect(resolveWorkspace("/onboarding", superNoTenant, "platform")).toBe("platform");
    expect(resolveWorkspace("/onboarding", orgAdmin, "company")).toBe("company");
  });

  it("ignores a choice the person may not use", () => {
    expect(resolveWorkspace("/users", member, "company")).toBe("work");
    expect(resolveWorkspace("/", orgAdmin, "platform")).toBe("work");
    expect(isWorkspace("company")).toBe(true);
    expect(isWorkspace("admin")).toBe(false);
    expect(isWorkspace(undefined)).toBe(false);
  });

  it("knows which pages each tree lists", () => {
    expect(pathInWorkspace("/", "work")).toBe(true);
    expect(pathInWorkspace("/", "company")).toBe(false);
    expect(pathInWorkspace("/opportunities/abc/activity", "work")).toBe(true);
    expect(pathInWorkspace("/users", "work")).toBe(true);
    expect(pathInWorkspace("/users", "company")).toBe(true);
    expect(pathInWorkspace("/admin/orgs/x/users", "platform")).toBe(true);
    expect(pathInWorkspace("/admin", "work")).toBe(false);
    expect(pathInWorkspace("/onboarding", "work")).toBe(false);
  });
});

describe("BL-NAV-LIFECYCLE — Opportunity Management is the document's tree; every other group as it was", () => {
  it("nests the seven stages under Pipeline and Scout and Create under Identify", () => {
    const groups = visibleNavGroups(NAV_BY_WORKSPACE.work, member);
    expect(groups.map((g) => g.id)).toEqual(["command", "opps", "customers", "intel", "ops", "help"]);
    const opps = groups.find((g) => g.id === "opps")!;
    expect(opps.label).toBe("Opportunity Management");
    const top = visibleNavChildren(opps.children, member);
    expect(top.map((c) => c.label)).toEqual(["Dashboard", "Pipeline"]);
    const pipeline = top[1]!;
    expect(pipeline.href).toBe("/pipeline");
    expect((pipeline.children ?? []).map((c) => c.label)).toEqual(["Identify", "Evaluate", "Capture", "Plan", "Develop", "Deliver", "Measure"]);
    expect((pipeline.children ?? []).map((c) => c.href)).toEqual(["/pipeline/identify", "/pipeline/evaluate", "/pipeline/capture", "/pipeline/plan", "/pipeline/develop", "/pipeline/deliver", "/pipeline/measure"]);
    const identify = pipeline.children![0]!;
    expect((identify.children ?? []).map((c) => c.label)).toEqual(["Scout", "Create"]);
  });

  it("leaves the other groups exactly as they were, and keeps admin items admin-only", () => {
    const groups = visibleNavGroups(NAV_BY_WORKSPACE.work, member);
    const hrefs = groups.flatMap((g) => flattenNavItems(visibleNavChildren(g.children, member)).map((c) => c.href));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/contacts?owed=1", "/contacts?import=1", "/companies/new", "/intelligence/lessons", "/reports", "/knowledge-base/new", "/settings/company-model", "/notifications", "/help/user"]),
    );
    for (const h of ["/users", "/settings/billing", "/settings/templates", "/settings/api", "/notifications/rules", "/audit-log", "/help/admin"]) {
      expect(hrefs).not.toContain(h);
    }
    // The old Opportunities creates and imports are shortcuts now.
    for (const h of ["/opportunities/new", "/opportunities/import", "/solicitations/new", "/proposals/new"]) expect(hrefs).not.toContain(h);
    const adminGroups = visibleNavGroups(NAV_BY_WORKSPACE.work, orgAdmin);
    expect(adminGroups.map((g) => g.id)).toEqual(["command", "opps", "customers", "intel", "ops", "administration", "help"]);
    const admin = adminGroups.find((g) => g.id === "administration")!;
    expect(visibleNavChildren(admin.children, orgAdmin).map((c) => c.href)).toEqual(["/users", "/settings/billing", "/settings/templates", "/settings/api", "/notifications/rules", "/audit-log"]);
  });

  it("keeps the folded-away Opportunities pages reachable as shortcuts, none of them admin-only", () => {
    const hrefs = WORK_SHORTCUTS.map((s) => s.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/opportunities/import/ebuy", "/solicitations/new", "/proposals/new"]));
    expect(WORK_SHORTCUTS.every((s) => !s.admin)).toBe(true);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("workspace navigation trees", () => {
  it("keeps platform pages out of the work and company trees, and tenant work out of platform", () => {
    const hrefs = (w: keyof typeof NAV_BY_WORKSPACE) =>
      NAV_BY_WORKSPACE[w].flatMap((g) => [g.href, ...flattenNavItems(g.children).map((c) => c.href)]).filter(
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
