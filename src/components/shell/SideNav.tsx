"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Command", icon: "▦", group: "ops" },
  { href: "/pipeline", label: "Pipeline", icon: "⧨", group: "ops" },
  { href: "/solicitations", label: "Solicitations", icon: "✦", group: "ops" },
  { href: "/proposals", label: "Proposals", icon: "❑", group: "ops" },
  { href: "/intelligence", label: "Intelligence", icon: "◈", group: "intel" },
  { href: "/knowledge-base", label: "Knowledge", icon: "❈", group: "intel" },
  { href: "/settings", label: "Settings", icon: "⚙", group: "intel" },
] as const;

const GROUPS: Record<string, string> = {
  ops: "Operations",
  intel: "Intelligence",
};

export function SideNav() {
  const pathname = usePathname();
  const groupOrder = ["ops", "intel"];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || (pathname?.startsWith(href + "/") ?? false);
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-canvas/70 backdrop-blur-xl lg:flex">
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg font-display text-sm font-bold text-white shadow-glow"
          style={{ background: "linear-gradient(135deg, #8B5CF6, #D946EF 60%, #F5B544 100%)" }}
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
          className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/20"
        >
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
              Organization
            </div>
            <div className="mt-0.5 font-display text-sm font-semibold">
              Configure in Settings
            </div>
          </div>
          <span className="text-muted">→</span>
        </Link>
      </div>

      <nav className="mt-6 flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-6">
        {groupOrder.map((g) => (
          <div key={g}>
            <div className="px-3 pb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-subtle">
              {GROUPS[g]}
            </div>
            <ul className="flex flex-col gap-0.5">
              {NAV.filter((n) => n.group === g).map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-white/10 text-text shadow-[inset_0_0_0_1px_rgba(139,92,246,0.25)]"
                          : "text-muted hover:bg-white/[0.04] hover:text-text"
                      }`}
                    >
                      {active && (
                        <span className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-violet via-magenta to-gold" />
                      )}
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
                          active
                            ? "bg-gradient-to-br from-violet/30 to-magenta/20 text-text"
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
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <Link
          href="/intelligence"
          className="aur-card block p-3 transition-colors hover:border-white/20"
        >
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              Brain status
            </div>
            <span className="text-[10px] text-muted">View →</span>
          </div>
          <div className="mt-2 font-display text-sm font-semibold text-text">
            Phase A · plumbing
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full"
              style={{
                width: "25%",
                background: "linear-gradient(90deg, #8B5CF6, #D946EF, #F5B544)",
              }}
            />
          </div>
        </Link>
      </div>
    </aside>
  );
}
