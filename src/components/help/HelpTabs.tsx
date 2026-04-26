"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function HelpTabs({ canSeeAdmin }: { canSeeAdmin: boolean }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="mb-8 flex items-center gap-2 border-b border-white/10">
      <Tab href="/help/user" label="User guide" active={pathname.startsWith("/help/user") || pathname === "/help"} />
      {canSeeAdmin && (
        <Tab href="/help/admin" label="Admin guide" active={pathname.startsWith("/help/admin")} />
      )}
    </div>
  );
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative inline-flex items-center px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
        active ? "text-text" : "text-muted hover:text-text"
      }`}
    >
      {label}
      {active && (
        <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-gradient-to-r from-teal via-emerald to-magenta" />
      )}
    </Link>
  );
}
