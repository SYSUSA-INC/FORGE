import { describe, expect, it } from "vitest";
import { SECTION_TABS, sectionTabsFor, visibleSectionTabs } from "@/lib/section-tabs";

/** BL-NAV-LIFECYCLE — which pages share a sidebar item as tabs. */
describe("sectionTabsFor", () => {
  it("finds the set and the active tab by exact path", () => {
    expect(sectionTabsFor("/opportunities/import/ebuy")).toMatchObject({ set: { id: "identify" }, active: "/opportunities/import/ebuy" });
    expect(sectionTabsFor("/knowledge-base/")).toMatchObject({ set: { id: "knowledge" }, active: "/knowledge-base" });
    expect(sectionTabsFor("/reports")).toMatchObject({ set: { id: "measure" }, active: "/reports" });
  });

  it("a record page or an unlisted page shows no strip", () => {
    expect(sectionTabsFor("/knowledge-base/abc")).toBeNull();
    expect(sectionTabsFor("/companies/abc")).toBeNull();
    expect(sectionTabsFor("/")).toBeNull();
    expect(sectionTabsFor(null)).toBeNull();
  });

  it("a tab with a query is active only with that query", () => {
    expect(sectionTabsFor("/opportunities", "stage=won")).toMatchObject({ set: { id: "measure" }, active: "/opportunities?stage=won" });
    expect(sectionTabsFor("/opportunities", "?stage=won")?.active).toBe("/opportunities?stage=won");
    expect(sectionTabsFor("/opportunities", "stage=capture")).toBeNull();
    expect(sectionTabsFor("/opportunities")).toBeNull();
  });

  it("admin-only tabs are for admins; every set has at least two tabs and unique hrefs", () => {
    for (const set of SECTION_TABS) {
      expect(set.tabs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(set.tabs.map((t) => t.href)).size).toBe(set.tabs.length);
      const member = visibleSectionTabs(set, { isOrgAdmin: false, isSuperadmin: false });
      expect(member.every((t) => !t.admin)).toBe(true);
      expect(visibleSectionTabs(set, { isOrgAdmin: true, isSuperadmin: false }).length).toBe(set.tabs.length);
    }
  });
});
