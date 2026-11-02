"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { sectionTabsFor, visibleSectionTabs } from "@/lib/section-tabs";

/**
 * BL-NAV-LIFECYCLE — the tab strip above a page that shares a sidebar
 * item with its siblings (Identify's ways in, Measure's views, the
 * Knowledge base's pages). Rendered once by the shell; shows nothing on
 * a page that belongs to no set.
 */
export function SectionTabs({ isOrgAdmin, isSuperadmin }: { isOrgAdmin: boolean; isSuperadmin: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const found = sectionTabsFor(pathname, params?.toString() ?? "");
  if (!found) return null;
  const tabs = visibleSectionTabs(found.set, { isOrgAdmin, isSuperadmin });
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={`${found.set.label} sections`} className="-mt-2 mb-6 flex flex-wrap items-center gap-x-1 border-b border-layer/10">
      <span className="mr-2 py-2.5 font-mono text-[10px] uppercase tracking-label text-subtle">{found.set.label}</span>
      {tabs.map((t) => {
        const active = t.href === found.active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative inline-flex items-center px-3 py-2.5 font-mono text-[11px] uppercase tracking-label transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
          >
            {t.label}
            {active ? <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-accent" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
