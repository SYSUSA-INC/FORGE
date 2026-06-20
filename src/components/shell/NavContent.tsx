"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  /** Visible only to org admins (or superadmins). */
  admin?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  /** When set, the group has no expand affordance — it IS a link itself. */
  href?: string;
  /** Group visible only to org admins (or superadmins). */
  admin?: boolean;
  /** Group visible only to superadmins. */
  superadmin?: boolean;
  children?: NavItem[];
};

type NavUser = {
  name: string | null;
  email: string;
  image: string | null;
};

// Six top-level entries per the platform spec.
//
// Operations Management consolidates the per-tenant admin surface.
// Each sub-page is its own URL (BL-14 route split landed).
const NAV: NavGroup[] = [
  {
    id: "command",
    label: "Command Center",
    icon: "▦",
    href: "/",
  },
  {
    id: "ops",
    label: "Operations Management",
    icon: "⚙",
    admin: true,
    children: [
      { href: "/settings", label: "Settings" },
      { href: "/settings/billing", label: "Billing", admin: true },
      { href: "/users", label: "Users & Roles" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/ai-engine", label: "AI Engine" },
      { href: "/settings/templates", label: "Templates" },
      { href: "/notifications", label: "Notifications" },
      { href: "/notifications/rules", label: "Notification rules", admin: true },
      { href: "/audit-log", label: "Audit Log" },
    ],
  },
  {
    id: "opps",
    label: "Opportunities",
    icon: "✸",
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
    children: [
      { href: "/companies", label: "Company Search" },
      { href: "/intelligence", label: "FORGE Brain" },
      { href: "/intelligence/awards", label: "Awards & recompetes" },
      { href: "/intelligence/firms", label: "8(a) firms" },
      { href: "/intelligence/watchlist", label: "Watchlist" },
      { href: "/intelligence/saved-searches", label: "Saved searches" },
      { href: "/knowledge-base", label: "Knowledge" },
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
  {
    id: "platform",
    label: "Platform Administration",
    icon: "✱",
    superadmin: true,
    children: [
      { href: "/admin", label: "Tenants" },
      { href: "/admin/tiers", label: "Subscription tiers" },
      { href: "/admin/usage", label: "AI usage & costs" },
      { href: "/admin/promo-codes", label: "Promo codes" },
      { href: "/admin/errors", label: "Production errors" },
      { href: "/admin/migrations", label: "Database migrations" },
      { href: "/admin/sba-8a", label: "SBA 8(a) registry" },
      { href: "/admin/source-requests", label: "Source requests" },
      { href: "/platform/audit-log", label: "Audit Log" },
    ],
  },
];

const COLLAPSED_GROUPS_KEY = "forge.nav.collapsed.v2";
const NAV_RAIL_COLLAPSED_KEY = "forge.nav.rail.v1";

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((g): g is string => typeof g === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COLLAPSED_GROUPS_KEY,
      JSON.stringify([...set]),
    );
  } catch {
    /* private mode, quota — silently swallow */
  }
}

function readRailCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAV_RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRailCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      NAV_RAIL_COLLAPSED_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    /* swallow */
  }
}

function hrefMatches(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const cleanHref = href.split("?")[0]!;
  if (cleanHref === "/") return pathname === "/";
  return pathname === cleanHref || pathname.startsWith(cleanHref + "/");
}

function initialsFor(name: string | null, email: string): string {
  const seed = name?.trim() || email;
  return (
    seed
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

export function NavContent({
  onNavigate,
  isOrgAdmin = false,
  isSuperadmin = false,
  user,
  /** When true, parent shell can disable the rail toggle — useful in the
   *  mobile drawer where the nav is always full-width. */
  hideRailToggle = false,
}: {
  onNavigate?: () => void;
  isOrgAdmin?: boolean;
  isSuperadmin?: boolean;
  user: NavUser | null;
  hideRailToggle?: boolean;
}) {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [railCollapsed, setRailCollapsedState] = useState(false);

  // Hydrate from localStorage after mount. SSR + first client render
  // produce identical markup (avoids hydration mismatch warnings).
  useEffect(() => {
    setCollapsedGroups(readCollapsedGroups());
    setRailCollapsedState(readRailCollapsed());
  }, []);

  // Notify the parent shell when the rail collapses so it can resize
  // its sticky aside (60px ↔ 256px). The parent listens via a custom
  // event fired on window.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("forge:nav-rail", {
        detail: { collapsed: railCollapsed },
      }),
    );
  }, [railCollapsed]);

  function toggleGroup(g: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      writeCollapsedGroups(next);
      return next;
    });
  }

  function toggleRail() {
    setRailCollapsedState((prev) => {
      const next = !prev;
      writeRailCollapsed(next);
      return next;
    });
  }

  const visibleGroups = NAV.filter((g) => {
    if (g.superadmin && !isSuperadmin) return false;
    if (g.admin && !isOrgAdmin && !isSuperadmin) return false;
    return true;
  });

  function visibleChildren(group: NavGroup): NavItem[] {
    if (!group.children) return [];
    return group.children.filter((c) => {
      if (c.admin && !isOrgAdmin && !isSuperadmin) return false;
      return true;
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Collapsed rail variant — icons only, ~60px wide.
  // ─────────────────────────────────────────────────────────────────
  if (railCollapsed) {
    return (
      <>
        <div className="flex h-14 items-center justify-center border-b border-white/10">
          <div
            className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
            style={{
              background:
                "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)",
            }}
          >
            F
          </div>
        </div>

        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3">
          {visibleGroups.map((g) => {
            const children = visibleChildren(g);
            const groupActive = g.href
              ? hrefMatches(pathname, g.href)
              : children.some((c) => hrefMatches(pathname, c.href));

            // Standalone link (e.g. Command Center) — direct navigation.
            if (g.href && children.length === 0) {
              return (
                <Link
                  key={g.id}
                  href={g.href}
                  onClick={onNavigate}
                  title={g.label}
                  aria-label={g.label}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-colors ${
                    groupActive
                      ? "bg-gradient-to-br from-teal/30 to-emerald/20 text-text shadow-[inset_0_0_0_1px_rgba(45,212,191,0.4)]"
                      : "text-muted hover:bg-white/[0.05] hover:text-text"
                  }`}
                >
                  {g.icon}
                </Link>
              );
            }

            // Group with children — clicking expands the rail and reveals
            // the children. Tooltip shows the group label.
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  // Force the group open and expand the rail in one shot
                  // — otherwise the user has to click twice to get to
                  // their destination.
                  if (collapsedGroups.has(g.id)) toggleGroup(g.id);
                  toggleRail();
                }}
                title={g.label}
                aria-label={g.label}
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-colors ${
                  groupActive
                    ? "bg-gradient-to-br from-teal/30 to-emerald/20 text-text shadow-[inset_0_0_0_1px_rgba(45,212,191,0.4)]"
                    : "text-muted hover:bg-white/[0.05] hover:text-text"
                }`}
              >
                {g.icon}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col items-center gap-2 border-t border-white/10 py-3">
          {!hideRailToggle && (
            <button
              type="button"
              onClick={toggleRail}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
            >
              {/* simple chevron-right */}
              <span aria-hidden className="font-mono text-[14px]">›</span>
            </button>
          )}
          {user ? <UserAvatar user={user} compact /> : null}
        </div>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Expanded sidebar — full hierarchy with +/- toggles, tree connectors.
  // ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
          style={{
            background:
              "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)",
          }}
        >
          F
        </div>
        <div className="flex-1 leading-none">
          <div className="font-display text-[15px] font-semibold tracking-tight">
            FORGE
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
            Proposal Ops
          </div>
        </div>
        {!hideRailToggle && (
          <button
            type="button"
            onClick={toggleRail}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
          >
            <span aria-hidden className="font-mono text-[14px]">‹</span>
          </button>
        )}
      </div>

      <nav className="mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4">
        {visibleGroups.map((g) => {
          const children = visibleChildren(g);
          const groupActive = g.href
            ? hrefMatches(pathname, g.href)
            : children.some((c) => hrefMatches(pathname, c.href));
          const isCollapsedGroup = collapsedGroups.has(g.id);
          // Force the group open if the active page lives inside it.
          const showChildren =
            !!children.length && (!isCollapsedGroup || groupActive);

          // Standalone link group (e.g. Command Center) — no expand affordance.
          if (g.href && children.length === 0) {
            const active = hrefMatches(pathname, g.href);
            return (
              <Link
                key={g.id}
                href={g.href}
                onClick={onNavigate}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-white/10 text-text shadow-[inset_0_0_0_1px_rgba(45,212,191,0.3)]"
                    : "text-muted hover:bg-white/[0.04] hover:text-text"
                }`}
              >
                {active && (
                  <span className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-teal via-emerald to-magenta" />
                )}
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
                    active
                      ? "bg-gradient-to-br from-teal/30 to-emerald/20 text-text"
                      : "bg-white/5 text-muted"
                  }`}
                >
                  {g.icon}
                </span>
                <span className="font-medium">{g.label}</span>
              </Link>
            );
          }

          // Expandable group with children. Header is a button that
          // shows +/- on the right. Children render with a tree
          // connector line + horizontal hook into each item.
          return (
            <div key={g.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleGroup(g.id)}
                aria-expanded={showChildren}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  groupActive
                    ? "text-text"
                    : "text-muted hover:bg-white/[0.04] hover:text-text"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
                    groupActive
                      ? "bg-gradient-to-br from-teal/30 to-emerald/20 text-text"
                      : "bg-white/5 text-muted"
                  }`}
                >
                  {g.icon}
                </span>
                <span className="flex-1 font-medium">{g.label}</span>
                <span
                  aria-hidden
                  className="grid h-5 w-5 place-items-center rounded-md border border-white/10 bg-white/[0.03] font-mono text-[12px] text-muted"
                >
                  {showChildren ? "−" : "+"}
                </span>
              </button>
              {showChildren && (
                <ul
                  // Tree-connector line: the ul has a left border that
                  // forms the vertical trunk; each li uses a small ::before
                  // to draw the horizontal branch hook.
                  className="ml-[1.4rem] mt-0.5 flex flex-col border-l border-white/[0.08] pl-0"
                >
                  {children.map((c) => {
                    const active = hrefMatches(pathname, c.href);
                    return (
                      <li
                        key={c.href}
                        className="relative pl-3 before:absolute before:left-0 before:top-1/2 before:h-px before:w-2.5 before:bg-white/[0.08]"
                      >
                        <Link
                          href={c.href}
                          onClick={onNavigate}
                          className={`relative block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                            active
                              ? "bg-white/10 text-text"
                              : "text-muted hover:bg-white/[0.04] hover:text-text"
                          }`}
                        >
                          {c.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        {user ? <UserAvatar user={user} compact={false} /> : null}
      </div>
    </>
  );
}

function UserAvatar({
  user,
  compact,
}: {
  user: NavUser;
  compact: boolean;
}) {
  const label = user.name ?? user.email;
  const initials = initialsFor(user.name, user.email);

  if (compact) {
    return (
      <div
        title={`${label}\n${user.email}`}
        className="relative h-9 w-9 overflow-visible"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-9 w-9 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="grid h-9 w-9 place-items-center rounded-full font-mono text-[11px] font-bold text-white"
            style={{
              background: "linear-gradient(135deg, #2DD4BF 0%, #EC4899 100%)",
            }}
          >
            {initials}
          </span>
        )}
        <span
          aria-hidden
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-emerald"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <div className="relative h-9 w-9 shrink-0">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-9 w-9 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="grid h-9 w-9 place-items-center rounded-full font-mono text-[11px] font-bold text-white"
            style={{
              background: "linear-gradient(135deg, #2DD4BF 0%, #EC4899 100%)",
            }}
          >
            {initials}
          </span>
        )}
        <span
          aria-hidden
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-emerald"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[13px] font-semibold text-text leading-tight">
          {user.name ?? user.email.split("@")[0]}
        </div>
        <div className="truncate font-mono text-[10px] text-muted">
          {user.email}
        </div>
      </div>
    </div>
  );
}
