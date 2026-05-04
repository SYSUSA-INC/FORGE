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

// Six top-level entries per the platform spec.
//
// Operations Management consolidates the per-tenant admin surface
// (Settings, Users & Roles, Integrations, AI Engine, Templates,
// Notifications). Settings/Integrations/AI Engine are tabs of a
// single page today, so we deep-link via `?tab=` until BL-14 splits
// them into real routes.
//
// Platform Administration today is the existing /admin page (legacy
// super-admin view of orgs, users, activity). Once BL-15 / BL-16 /
// BL-17 / BL-18 ship, this becomes a parent group with sub-items
// (Tenant Administration, Platform Configuration, Subscriptions,
// Platform Audit Log). Hidden from non-superadmins server-side.
//
// Items not yet in the menu (waiting on their backing BL):
//   - Operations Management → Audit Log (BL-12)
//   - Platform Administration → 4 sub-items (BL-15..BL-18)
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
      { href: "/users", label: "Users & Roles" },
      { href: "/settings?tab=integrations", label: "Integrations" },
      { href: "/settings?tab=ai", label: "AI Engine" },
      { href: "/settings/templates", label: "Templates" },
      { href: "/notifications", label: "Notifications" },
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
      { href: "/proposals", label: "Proposals" },
    ],
  },
  {
    id: "intel",
    label: "Platform Intelligence",
    icon: "◈",
    children: [
      { href: "/companies", label: "Company Search" },
      { href: "/intelligence", label: "FORGE Brain" },
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
    href: "/admin",
    superadmin: true,
  },
];

const COLLAPSED_KEY = "forge.nav.collapsed.v2";

function readCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((g): g is string => typeof g === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // Quota / private mode — silently swallow.
  }
}

function hrefMatches(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // Strip query string for comparison — `?tab=integrations` is a
  // tab hint, not a different page.
  const cleanHref = href.split("?")[0]!;
  if (cleanHref === "/") return pathname === "/";
  return pathname === cleanHref || pathname.startsWith(cleanHref + "/");
}

export function NavContent({
  onNavigate,
  isOrgAdmin = false,
  isSuperadmin = false,
}: {
  onNavigate?: () => void;
  isOrgAdmin?: boolean;
  isSuperadmin?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Hydrate from localStorage after mount. SSR + first client render
  // produce identical markup, avoiding hydration mismatch warnings.
  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  function toggle(g: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      writeCollapsed(next);
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

  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
          style={{ background: "linear-gradient(135deg, #2DD4BF, #34D399 55%, #EC4899 100%)" }}
        >
          F
        </div>
        <div className="leading-none">
          <div className="font-display text-[15px] font-semibold tracking-tight">FORGE</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
            Proposal Ops
          </div>
        </div>
      </div>

      <nav className="mt-4 flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6">
        {visibleGroups.map((g) => {
          const children = visibleChildren(g);
          const groupActive = g.href
            ? hrefMatches(pathname, g.href)
            : children.some((c) => hrefMatches(pathname, c.href));
          const isCollapsed = collapsed.has(g.id);
          // If the active page lives inside this group, force it open
          // — collapsing the active context out of view is hostile.
          const showChildren = !!children.length && (!isCollapsed || groupActive);

          // Standalone link group (Command Center) — no expand affordance.
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

          // Expandable group with children.
          return (
            <div key={g.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(g.id)}
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
                  className={`font-mono text-[10px] text-subtle transition-transform ${
                    showChildren ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </button>
              {showChildren && (
                <ul className="ml-9 mt-0.5 flex flex-col gap-0.5 border-l border-white/[0.06] pl-2">
                  {children.map((c) => {
                    const active = hrefMatches(pathname, c.href);
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          onClick={onNavigate}
                          className={`relative block rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                            active
                              ? "bg-white/10 text-text"
                              : "text-muted hover:bg-white/[0.04] hover:text-text"
                          }`}
                        >
                          {active && (
                            <span className="absolute -left-2 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-teal" />
                          )}
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

      <div className="border-t border-white/10 p-4">
        <Link
          href="/intelligence"
          onClick={onNavigate}
          className="aur-card block p-3 transition-colors hover:border-white/20"
        >
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              FORGE Brain
            </div>
            <span className="text-[10px] text-teal">Open →</span>
          </div>
          <div className="mt-1 text-[12px] leading-snug text-text">
            Learns from every proposal you ship.
          </div>
        </Link>
      </div>
    </>
  );
}
