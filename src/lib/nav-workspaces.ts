/**
 * BL-NAV-WORKSPACES — three navigation workspaces, one per hat.
 *
 * The sidebar used to be a single tree with role-gated groups, so a
 * platform admin saw tenant work pages and platform pages side by side,
 * and a company admin saw admin pages mixed into everyday work. Now the
 * shell has three workspaces, each with only the menu items that role
 * needs, and a switcher for people who wear more than one hat:
 *
 *   work      — everyday proposal operations (every member)
 *   company   — the company admin console (org admins, superadmins)
 *   platform  — platform administration (superadmins only)
 *
 * The active workspace follows the URL: platform paths open the
 * platform workspace, company-admin paths the company console, and
 * everything else the work workspace — so links inside a workspace keep
 * you there, and a bookmark opens the right one. Pure; unit-tested.
 */
import type { NavVisibility } from "@/lib/nav-visibility";

export type Workspace = "work" | "company" | "platform";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  /** Visible only to org admins (or superadmins). */
  admin?: boolean;
};

export type WorkspaceNavGroup = {
  id: string;
  label: string;
  icon: string;
  /** When set, the group has no expand affordance — it IS a link itself. */
  href?: string;
  admin?: boolean;
  superadmin?: boolean;
  needsWorkspace?: boolean;
  children?: WorkspaceNavItem[];
};

export type WorkspaceMeta = {
  key: Workspace;
  label: string;
  /** Brand subtitle in the sidebar. */
  subtitle: string;
  /** Where the switcher lands. */
  home: string;
  /** One-letter marker for the collapsed rail. */
  initial: string;
};

export const WORKSPACES: Record<Workspace, WorkspaceMeta> = {
  work: { key: "work", label: "Workspace", subtitle: "Proposal Ops", home: "/", initial: "W" },
  company: {
    key: "company",
    label: "Company admin",
    subtitle: "Company admin",
    home: "/users",
    initial: "C",
  },
  platform: {
    key: "platform",
    label: "Platform admin",
    subtitle: "Platform admin",
    home: "/admin",
    initial: "P",
  },
};

/**
 * Everyday proposal operations — what every member works in.
 *
 * BL-NAV-RESTORE — the everyday tree is the complete map of the product
 * again: every page a member can open is listed (imports and creates
 * included), and the pages an org admin administers sit in an
 * **Administration** group that only admins see (`admin: true`, filtered
 * by `visibleNavGroups`), so nothing needs a workspace switch. The
 * Company admin workspace remains as the admin-only console view.
 */
const WORK_NAV: WorkspaceNavGroup[] = [
  { id: "command", label: "Command Center", icon: "▦", href: "/", needsWorkspace: true },
  {
    id: "opps",
    label: "Opportunities",
    icon: "✸",
    needsWorkspace: true,
    children: [
      { href: "/opportunities", label: "Dashboard" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/opportunities/scout", label: "Scout" },
      { href: "/opportunities/new", label: "New Opportunity" },
      { href: "/opportunities/import", label: "Import from SAM.gov" },
      { href: "/opportunities/import/ebuy", label: "Paste from eBuy" },
      { href: "/opportunities/import/gsa", label: "Paste GSA email" },
      { href: "/solicitations", label: "Solicitations" },
      { href: "/solicitations/new", label: "New Solicitation" },
      { href: "/proposals", label: "In-flight Proposals" },
      { href: "/proposals/new", label: "New Proposals" },
    ],
  },
  {
    // BL-FB-X-CRM Slice 3 — the customer side of capture in one place:
    // who we know, who we owe a call, and how people get in.
    id: "customers",
    label: "Customer Relations",
    icon: "◎",
    needsWorkspace: true,
    children: [
      { href: "/contacts", label: "Customer contacts" },
      { href: "/contacts?owed=1", label: "Follow-ups owed" },
      { href: "/contacts?add=1", label: "New contact" },
      { href: "/contacts?import=1", label: "Import contacts" },
    ],
  },
  {
    id: "intel",
    label: "Platform Intelligence",
    icon: "◈",
    needsWorkspace: true,
    children: [
      { href: "/companies", label: "Company Search" },
      { href: "/companies/new", label: "Add company" },
      { href: "/intelligence", label: "FORGE Brain" },
      { href: "/intelligence/losses", label: "Loss intelligence" },
      { href: "/intelligence/awards", label: "Awards & recompetes" },
      { href: "/intelligence/firms", label: "8(a) firms" },
      { href: "/intelligence/watchlist", label: "Watchlist" },
      { href: "/intelligence/saved-searches", label: "Saved searches" },
      { href: "/knowledge-base", label: "Knowledge" },
      { href: "/knowledge-base/import", label: "Knowledge import" },
      { href: "/knowledge-base/usaspending", label: "USAspending import" },
      { href: "/knowledge-base/new", label: "New knowledge entry" },
    ],
  },
  {
    id: "ops",
    label: "Operations Management",
    icon: "⚙",
    needsWorkspace: true,
    children: [
      { href: "/settings", label: "Settings" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/ai-engine", label: "AI Engine" },
      { href: "/notifications", label: "Notifications" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: "◆",
    admin: true,
    needsWorkspace: true,
    children: [
      { href: "/users", label: "Users & Roles" },
      { href: "/settings/billing", label: "Billing" },
      { href: "/settings/templates", label: "Templates" },
      { href: "/notifications/rules", label: "Notification rules" },
      { href: "/audit-log", label: "Audit Log" },
    ],
  },
  {
    id: "help",
    label: "Help",
    icon: "?",
    children: [
      { href: "/help/user", label: "User guide" },
      { href: "/help/admin", label: "Admin guide", admin: true },
      { href: "/help/faq", label: "FAQ" },
    ],
  },
];

/** The company admin console — only what an org admin administers. */
const COMPANY_NAV: WorkspaceNavGroup[] = [
  {
    id: "people",
    label: "People",
    icon: "◉",
    admin: true,
    needsWorkspace: true,
    children: [{ href: "/users", label: "Users & Roles" }],
  },
  {
    id: "organization",
    label: "Organization",
    icon: "⚙",
    admin: true,
    needsWorkspace: true,
    children: [
      { href: "/settings", label: "Settings" },
      { href: "/settings/billing", label: "Billing" },
      { href: "/settings/templates", label: "Templates" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/ai-engine", label: "AI Engine" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    icon: "▤",
    admin: true,
    needsWorkspace: true,
    children: [
      { href: "/notifications/rules", label: "Notification rules" },
      { href: "/audit-log", label: "Audit Log" },
    ],
  },
  {
    id: "help",
    label: "Help",
    icon: "?",
    children: [{ href: "/help/admin", label: "Admin guide" }],
  },
];

/** Platform administration — superadmins only, no tenant work pages. */
const PLATFORM_NAV: WorkspaceNavGroup[] = [
  {
    // The three portal tabs, in the portal's order and with its labels, so
    // the menu and the tabs read as one thing; each link opens its tab and
    // a tab click writes the same URL back, so the menu follows.
    id: "tenants",
    label: "Organizations & users",
    icon: "✱",
    superadmin: true,
    children: [
      { href: "/admin?tab=overview", label: "Overview" },
      { href: "/admin?tab=organizations", label: "Organizations" },
      { href: "/admin?tab=users", label: "Platform users" },
      { href: "/admin/trial-requests", label: "Trial requests" },
      { href: "/admin/source-requests", label: "Source requests" },
    ],
  },
  {
    id: "commercial",
    label: "Commercial",
    icon: "◈",
    superadmin: true,
    children: [
      { href: "/admin/tiers", label: "Subscription tiers" },
      { href: "/admin/usage", label: "AI usage & costs" },
      { href: "/admin/promo-codes", label: "Promo codes" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: "▤",
    superadmin: true,
    children: [
      { href: "/admin/jobs", label: "Background jobs" },
      { href: "/admin/errors", label: "Production errors" },
      { href: "/admin/migrations", label: "Database migrations" },
      { href: "/admin/sba-8a", label: "SBA 8(a) registry" },
      { href: "/platform/audit-log", label: "Audit Log" },
    ],
  },
  {
    id: "help",
    label: "Help",
    icon: "?",
    children: [{ href: "/help/admin", label: "Admin guide" }],
  },
];

export const NAV_BY_WORKSPACE: Record<Workspace, WorkspaceNavGroup[]> = {
  work: WORK_NAV,
  company: COMPANY_NAV,
  platform: PLATFORM_NAV,
};

/** Paths that belong to the company admin console. */
const COMPANY_PATHS = [
  "/users",
  "/audit-log",
  "/notifications/rules",
  "/settings/billing",
  "/settings/templates",
  "/help/admin",
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Which workspace a URL belongs to, before role checks. */
export function workspaceForPath(pathname: string | null): Workspace {
  const p = (pathname ?? "/").split("?")[0] ?? "/";
  if (under(p, "/admin") || under(p, "/platform")) return "platform";
  if (COMPANY_PATHS.some((c) => under(p, c))) return "company";
  return "work";
}

/** The workspaces this person may switch to, in switcher order. */
export function availableWorkspaces(v: NavVisibility): Workspace[] {
  const out: Workspace[] = [];
  if (v.hasWorkspace) out.push("work");
  if (v.hasWorkspace && (v.isOrgAdmin || v.isSuperadmin)) out.push("company");
  if (v.isSuperadmin) out.push("platform");
  return out;
}

/** Where a person lands when the URL's workspace is not theirs. */
export function defaultWorkspace(v: NavVisibility): Workspace {
  const available = availableWorkspaces(v);
  return available[0] ?? (v.isSuperadmin ? "platform" : "work");
}

/**
 * BL-NAV-RESTORE — the workspace a person chose with the switcher is
 * remembered in this cookie (set by the switcher, read by the shell), so
 * an admin who opens Users & Roles from the everyday tree stays in the
 * everyday tree instead of being moved to the console.
 */
export const WORKSPACE_COOKIE = "forge.workspace";

export function isWorkspace(v: unknown): v is Workspace {
  return v === "work" || v === "company" || v === "platform";
}

function hrefsOf(ws: Workspace): string[] {
  return NAV_BY_WORKSPACE[ws]
    .flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)])
    .filter((h): h is string => !!h)
    .map((h) => h.split("?")[0]!);
}

/** Whether a URL is one of this workspace's listed pages, or under one. */
export function pathInWorkspace(pathname: string | null, ws: Workspace): boolean {
  const p = (pathname ?? "/").split("?")[0] ?? "/";
  return hrefsOf(ws).some((h) => (h === "/" ? p === "/" : under(p, h)));
}

/**
 * The workspace to render for this URL and person. The one they chose
 * wins while the URL is a page it lists; otherwise the URL's own
 * workspace when they may use it; otherwise the chosen one again (an
 * unlisted page such as /onboarding never bounces them); otherwise
 * their default — a member on an admin URL is shown the work workspace
 * (the page itself refuses), a superadmin without a tenant lands in
 * platform admin.
 */
export function resolveWorkspace(
  pathname: string | null,
  v: NavVisibility,
  preferred?: Workspace | null,
): Workspace {
  const available = availableWorkspaces(v);
  const chosen = preferred && available.includes(preferred) ? preferred : null;
  if (chosen && pathInWorkspace(pathname, chosen)) return chosen;
  // The URL's own workspace — when the person may use it and, once they
  // have chosen one, only when it actually lists the page.
  const wanted = workspaceForPath(pathname);
  if (available.includes(wanted) && (chosen === null || pathInWorkspace(pathname, wanted))) {
    return wanted;
  }
  return chosen ?? defaultWorkspace(v);
}
