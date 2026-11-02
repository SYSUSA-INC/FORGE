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
    // BL-NAV-LIFECYCLE — the proposal lifecycle as the menu: Identify ·
    // Evaluate · Capture · Plan · Develop · Deliver · Measure, each item
    // the worklist for that stage. Until the stage pages exist, each
    // opens the opportunities at the pipeline stage it corresponds to
    // (Evaluated, Qualified, Captured, Submitted, Closed-Won), the
    // proposals in flight for Develop, and the ways in for Identify.
    id: "opps",
    label: "Opportunity Management",
    icon: "✸",
    needsWorkspace: true,
    children: [
      { href: "/opportunities", label: "Dashboard" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/opportunities/scout", label: "Identify" },
      { href: "/opportunities?stage=sources_sought", label: "Evaluate" },
      { href: "/opportunities?stage=qualification", label: "Capture" },
      { href: "/opportunities?stage=capture", label: "Plan" },
      { href: "/proposals", label: "Develop" },
      { href: "/opportunities?stage=submitted", label: "Deliver" },
      { href: "/reports", label: "Measure" },
    ],
  },
  {
    // The customer side: who we know and the agencies and companies
    // around a pursuit. Follow-ups, add and import are on the page.
    id: "customers",
    label: "Customers",
    icon: "◎",
    needsWorkspace: true,
    children: [
      { href: "/contacts", label: "Contacts" },
      { href: "/companies", label: "Companies" },
    ],
  },
  {
    // Finding and tracking firms to team with.
    id: "partners",
    label: "Partners",
    icon: "◇",
    needsWorkspace: true,
    children: [
      { href: "/companies/search", label: "Company Search" },
      { href: "/intelligence/firms", label: "8(a) firms" },
      { href: "/intelligence/awards", label: "Awards & recompetes" },
      { href: "/intelligence/watchlist", label: "Watchlist" },
      { href: "/intelligence/saved-searches", label: "Saved searches" },
    ],
  },
  {
    // What FORGE knows: ask it, feed it, approve its account of you.
    id: "brain",
    label: "FORGE Brain",
    icon: "◈",
    needsWorkspace: true,
    children: [
      { href: "/intelligence", label: "Brain" },
      { href: "/knowledge-base", label: "Knowledge base" },
      { href: "/settings/company-model", label: "Company model" },
    ],
  },
  {
    // How the business runs: settings for everyone, administration for
    // admins, in one group.
    id: "business",
    label: "Business Management",
    icon: "⚙",
    needsWorkspace: true,
    children: [
      { href: "/settings", label: "Company settings" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/ai-engine", label: "AI Engine" },
      { href: "/settings/security", label: "Security" },
      { href: "/notifications", label: "Notifications" },
      { href: "/users", label: "Users & Roles", admin: true },
      { href: "/settings/billing", label: "Billing", admin: true },
      { href: "/settings/templates", label: "Templates", admin: true },
      { href: "/notifications/rules", label: "Notification rules", admin: true },
      { href: "/settings/api", label: "API access", admin: true },
      { href: "/audit-log", label: "Audit Log", admin: true },
    ],
  },
  // The guides are tabs on the help page (the admin guide for admins).
  { id: "help", label: "Help", icon: "?", href: "/help/user" },
];

/**
 * BL-NAV-LIFECYCLE — pages the everyday tree no longer lists because
 * they are tabs or buttons on a listed page. ⌘K still offers them (and
 * nothing here is admin-only), so "new opp" or "ebuy" keeps working.
 */
export const WORK_SHORTCUTS: WorkspaceNavItem[] = [
  { href: "/opportunities/new", label: "New Opportunity" },
  { href: "/opportunities/import", label: "Import from SAM.gov" },
  { href: "/opportunities/import/ebuy", label: "Paste from eBuy" },
  { href: "/opportunities/import/gsa", label: "Paste GSA email" },
  { href: "/solicitations", label: "Solicitations" },
  { href: "/solicitations/new", label: "New Solicitation" },
  { href: "/proposals/new", label: "New Proposal" },
  { href: "/contacts?owed=1", label: "Follow-ups owed" },
  { href: "/contacts?add=1", label: "New contact" },
  { href: "/contacts?import=1", label: "Import contacts" },
  { href: "/companies/new", label: "Add company" },
  { href: "/intelligence/losses", label: "Loss intelligence" },
  { href: "/intelligence/lessons", label: "Lessons" },
  { href: "/opportunities?stage=won", label: "Closed-Won" },
  { href: "/knowledge-base/import", label: "Knowledge import" },
  { href: "/knowledge-base/usaspending", label: "USAspending import" },
  { href: "/knowledge-base/new", label: "New knowledge entry" },
  { href: "/help/faq", label: "FAQ" },
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
      { href: "/settings/company-model", label: "Company model" },
      { href: "/settings/security", label: "Security" },
      { href: "/settings/api", label: "API access" },
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
      { href: "/admin/sam-notices", label: "SAM.gov notice copy" },
      { href: "/admin/samgov-keys", label: "Company SAM.gov keys" },
      { href: "/admin/gold-set", label: "Extraction gold set" },
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
  "/settings/api",
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
