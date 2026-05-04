"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  group: GroupId;
  admin?: boolean;
  superadmin?: boolean;
};

type GroupId =
  | "ops"
  | "proposals"
  | "intel"
  | "admin"
  | "platform";

const NAV: NavItem[] = [
  // Capture & pursuit — the top of the funnel
  { href: "/", label: "Command", icon: "▦", group: "ops" },
  { href: "/opportunities", label: "Opportunities", icon: "✸", group: "ops" },
  { href: "/pipeline", label: "Pipeline", icon: "⧨", group: "ops" },
  { href: "/companies", label: "Companies", icon: "⌬", group: "ops" },

  // Execution — solicitations + proposals
  { href: "/solicitations", label: "Solicitations", icon: "✦", group: "proposals" },
  { href: "/proposals", label: "Proposals", icon: "❑", group: "proposals" },
  { href: "/settings/templates", label: "Templates", icon: "▤", group: "proposals", admin: true },

  // Intelligence — the brain & knowledge corpus
  { href: "/intelligence", label: "Intelligence", icon: "◈", group: "intel" },
  { href: "/knowledge-base", label: "Knowledge", icon: "❈", group: "intel" },

  // Administration — per-tenant
  { href: "/users", label: "Users", icon: "☰", group: "admin", admin: true },
  { href: "/notifications", label: "Notifications", icon: "✺", group: "admin" },
  { href: "/settings", label: "Settings", icon: "⚙", group: "admin" },
  { href: "/help", label: "Help", icon: "?", group: "admin" },

  // Platform — superadmin only
  { href: "/admin", label: "Platform admin", icon: "✱", group: "platform", superadmin: true },
];

const GROUPS: Record<GroupId, string> = {
  ops: "Capture & pursuit",
  proposals: "Proposal operations",
  intel: "Intelligence",
  admin: "Administration",
  platform: "Platform",
};

const GROUP_ORDER: GroupId[] = ["ops", "proposals", "intel", "admin", "platform"];

const COLLAPSED_KEY = "forge.nav.collapsed.v1";

/**
 * Read collapsed-group state from localStorage. Falls back to an
 * empty set on SSR / first-paint (browsers without localStorage,
 * incognito, etc.) — that means every group renders expanded by
 * default, which matches our pre-Ch16 behavior.
 */
function readCollapsed(): Set<GroupId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((g): g is GroupId => typeof g === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<GroupId>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded / private mode — silently swallow.
  }
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
  const [collapsed, setCollapsed] = useState<Set<GroupId>>(() => new Set());

  // Hydrate from localStorage after mount. We do this in an effect
  // (not in useState's initializer) so SSR + first client render
  // produce identical markup — avoids a hydration mismatch warning.
  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  function toggle(g: GroupId) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      writeCollapsed(next);
      return next;
    });
  }

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || (pathname?.startsWith(href + "/") ?? false);
  };

  const visible = NAV.filter((n) => {
    if (n.superadmin && !isSuperadmin) return false;
    if (n.admin && !isOrgAdmin && !isSuperadmin) return false;
    return true;
  });

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

      <div className="px-4 pt-4">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/20"
        >
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">Organization</div>
            <div className="mt-0.5 font-display text-sm font-semibold text-text">
              Configure in Settings
            </div>
          </div>
          <span className="text-muted">→</span>
        </Link>
      </div>

      <nav className="mt-6 flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-6">
        {GROUP_ORDER.map((g) => {
          const items = visible.filter((n) => n.group === g);
          if (items.length === 0) return null;
          const isCollapsed = collapsed.has(g);
          // If any descendant is the active page, force the group open
          // — collapsing the active page out of view is hostile UX.
          const hasActiveChild = items.some((it) => isActive(it.href));
          const showItems = !isCollapsed || hasActiveChild;

          return (
            <div key={g}>
              <button
                type="button"
                onClick={() => toggle(g)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                aria-expanded={showItems}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-subtle">
                  {GROUPS[g]}
                </span>
                <span
                  aria-hidden
                  className={`font-mono text-[10px] text-muted transition-transform ${
                    showItems ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </button>
              {showItems ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
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
                            {item.icon}
                          </span>
                          <span className="font-medium">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
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
              Intelligence
            </div>
            <span className="text-[10px] text-teal">Open →</span>
          </div>
          <div className="mt-1 text-[12px] leading-snug text-text">
            The FORGE brain — learns from every proposal.
          </div>
        </Link>
      </div>
    </>
  );
}
