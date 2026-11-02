/**
 * BL-NAV-LIFECYCLE — pages that share one sidebar item sit as tabs
 * under it. A tab set is shown by the shell above any page it lists
 * (`sectionTabsFor`), so the pages themselves are untouched and every
 * old URL keeps working. A tab may carry a query string (a stage
 * filter); it is active only with that query. Pure; unit-tested.
 */
export type SectionTab = {
  href: string;
  label: string;
  /** Visible only to org admins (or superadmins). */
  admin?: boolean;
};

export type SectionTabSet = {
  id: string;
  /** The sidebar item these tabs sit under. */
  label: string;
  tabs: SectionTab[];
};

export const SECTION_TABS: SectionTabSet[] = [
  {
    // Identify — every way an opportunity enters, on one item.
    id: "identify",
    label: "Identify",
    tabs: [
      { href: "/opportunities/scout", label: "Scout" },
      { href: "/opportunities/import", label: "Import from SAM.gov" },
      { href: "/opportunities/import/ebuy", label: "Paste from eBuy" },
      { href: "/opportunities/import/gsa", label: "Paste GSA email" },
      { href: "/solicitations", label: "Solicitations" },
      { href: "/opportunities/new", label: "Create" },
    ],
  },
  {
    // Measure — what the decided bids say.
    id: "measure",
    label: "Measure",
    tabs: [
      { href: "/reports", label: "Reports" },
      { href: "/opportunities?stage=won", label: "Closed-Won" },
      { href: "/intelligence/lessons", label: "Lessons" },
      { href: "/intelligence/losses", label: "Loss intelligence" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge base",
    tabs: [
      { href: "/knowledge-base", label: "Entries" },
      { href: "/knowledge-base/import", label: "Import" },
      { href: "/knowledge-base/usaspending", label: "USAspending" },
      { href: "/knowledge-base/new", label: "New entry" },
    ],
  },
];

/** The path without a trailing slash. */
function cleanPath(pathname: string | null): string {
  const p = (pathname ?? "/").split("?")[0] ?? "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * The tab set a page belongs to, and which tab it is. A tab matches on
 * the exact path, and, when it carries a query, on that query too; so a
 * record page (`/companies/abc`) shows no strip, and `/opportunities`
 * without `?stage=won` is not the Closed-Won tab.
 */
export function sectionTabsFor(pathname: string | null, search = ""): { set: SectionTabSet; active: string } | null {
  const p = cleanPath(pathname);
  const q = search.startsWith("?") ? search : search ? `?${search}` : "";
  for (const set of SECTION_TABS) {
    const tab = set.tabs.find((t) => {
      const [path, query] = t.href.split("?");
      return path === p && (query ? q === `?${query}` : true);
    });
    if (tab) return { set, active: tab.href };
  }
  return null;
}

/** The tabs this person may see: admin-only tabs for org admins and superadmins. */
export function visibleSectionTabs(set: SectionTabSet, v: { isOrgAdmin: boolean; isSuperadmin: boolean }): SectionTab[] {
  return set.tabs.filter((t) => !t.admin || v.isOrgAdmin || v.isSuperadmin);
}
