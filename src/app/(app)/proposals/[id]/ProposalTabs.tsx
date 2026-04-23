"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sections", label: "Sections" },
  { key: "reviews", label: "Reviews" },
  { key: "compliance", label: "Compliance" },
];

export function ProposalTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const basePath = `/proposals/${id}`;
  const current =
    TABS.find((t) => pathname?.endsWith(`/${t.key}`))?.key ?? "overview";

  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-white/10">
      {TABS.map((t) => {
        const href = t.key === "overview" ? basePath : `${basePath}/${t.key}`;
        const active = current === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            className={`relative -mb-px border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
              active
                ? "border-teal-400 text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
