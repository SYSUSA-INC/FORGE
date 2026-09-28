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

/** Everyday proposal operations — what every member works in. */
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
      { href: "/opportunities/new", label: "New Opportunity" },
      { href: "/solicitations", label: "Solicitations" },
      { href: "/proposals", label: "In-flight Proposals" },
      { href: "/proposals/new", label: "New Proposals" },
    ],
  },
  {
    id: "intel",
    label: "Platform Intelligence",
    icon: "◈",
    needsWorkspace: true,
    children: [
      { href: "/companies", label: "Company Search" },
      { href: "/intelligence", label: "FORGE Brain" },
      { href: "/intelligence/losses", label: "Loss intelligence" },
      { href: "/intelligence/awards", label: "Awards & recompetes" },
      { href: "/intelligence/firms", label: "8(a) firms" },
      { href: "/intelligence/watchlist", label: "Watchlist" },
      { href: "/intelligence/saved-searches", label: "Saved searches" },
      { href: "/knowledge-base", label: "Knowledge" },
    ],
  },
  { id: "inbox", label: "Inbox", icon: "✉", href: "/notifications", needsWorkspace: true },
  {
    id: "org",
    label: "My organization",
    icon: "⚙",
    needsWorkspace: true,
    children: [
      { href: "/settings", label: "Settings" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/ai-engine", label: "AI Engine" },
    ],
  },
  {
    id: "help",
    label: "Help",
    icon: "?",
    children: [
      { href: "/help/user", label: "User guide" },
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
    children: [{ href: "/users", label: "Users & roles" }],
  },
  {
    id: "organization",
    label: "Organization",
    icon: "⚙",
    admin: true,
    needsWorkspace: true,
    children: [
      { href: "/settings", label: "Profile & domains" },
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
      { href: "/audit-log", label: "Audit log" },
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
    id: "tenants",
    label: "Tenants & users",
    icon: "✱",
    superadmin: true,
    children: [
      { href: "/admin", label: "Organizations" },
      { href: "/admin?tab=users", label: "Platform users" },
      { href: "/admin?tab=overview", label: "Overview" },
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
      { href: "/platform/audit-log", label: "Audit log (all tenants)" },
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
 * The workspace to render for this URL and person: the URL's workspace
 * when they may use it, else their default — a member on a settings
 * page stays in the work workspace, a superadmin without a tenant
 * lands in platform admin.
 */
export function resolveWorkspace(pathname: string | null, v: NavVisibility): Workspace {
  const wanted = workspaceForPath(pathname);
  return availableWorkspaces(v).includes(wanted) ? wanted : defaultWorkspace(v);
}
