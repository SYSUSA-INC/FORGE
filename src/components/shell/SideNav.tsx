"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Command", code: "CMD", group: "ops" },
  { href: "/solicitations", label: "Solicitations", code: "SOL", group: "ops" },
  { href: "/proposals", label: "Proposals", code: "PRP", group: "ops" },
  { href: "/proposals/FRG-0042/editor", label: "Editor", code: "EDT", group: "build" },
  { href: "/proposals/FRG-0042/compliance", label: "Compliance", code: "CMP", group: "build" },
  { href: "/proposals/FRG-0042/review", label: "Review", code: "RVW", group: "build" },
  { href: "/proposals/FRG-0042/export", label: "Export", code: "EXP", group: "build" },
  { href: "/knowledge-base", label: "Knowledge Base", code: "KB", group: "intel" },
  { href: "/settings", label: "Settings", code: "SET", group: "intel" },
] as const;

const GROUPS: Record<string, string> = {
  ops: "OPERATIONS",
  build: "PROPOSAL BUILD",
  intel: "INTELLIGENCE",
};

export function SideNav() {
  const pathname = usePathname();
  const groupOrder = ["ops", "build", "intel"];

  return (
    <aside className="sticky top-[6rem] hidden h-[calc(100vh-6rem)] w-60 shrink-0 border-r-2 border-ink bg-paper lg:block">
      <nav className="flex h-full flex-col">
        {groupOrder.map((g) => (
          <div key={g} className="border-b-2 border-ink">
            <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-3 py-1.5 text-paper">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em]">
                {GROUPS[g]}
              </span>
              <span className="font-mono text-[10px] text-paper/60">
                {NAV.filter((n) => n.group === g).length.toString().padStart(2, "0")}
              </span>
            </div>
            <ul>
              {NAV.filter((n) => n.group === g).map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname?.startsWith(
                        item.href
                          .split("/editor")[0]
                          .split("/compliance")[0]
                          .split("/review")[0]
                          .split("/export")[0],
                      ) &&
                      (item.href.includes("editor")
                        ? pathname?.includes("editor")
                        : item.href.includes("compliance")
                          ? pathname?.includes("compliance")
                          : item.href.includes("review")
                            ? pathname?.includes("review")
                            : item.href.includes("export")
                              ? pathname?.includes("export")
                              : pathname === item.href || pathname?.startsWith(item.href + "/"));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`relative flex items-center justify-between border-b border-ink/10 px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                        active ? "bg-bone font-bold text-ink" : "hover:bg-bone/60"
                      }`}
                    >
                      {active ? (
                        <span className="absolute inset-y-0 left-0 w-1 bg-hazard" aria-hidden />
                      ) : null}
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 border border-ink ${active ? "bg-ink" : "bg-transparent"}`}
                        />
                        {item.label}
                      </span>
                      <span className="text-[10px] text-ink/50">{item.code}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="mt-auto border-t-2 border-ink p-3">
          <div className="brut-label">Weekly activity</div>
          <div className="grid grid-cols-7 gap-[2px]">
            {[4, 3, 5, 2, 1, 2, 0].map((v, i) => (
              <div
                key={i}
                className="h-6 border border-ink bg-ink"
                style={{ opacity: 0.15 + v * 0.12 }}
              />
            ))}
          </div>
          <div className="mt-2 font-mono text-[9px] uppercase tracking-widest text-ink/60">
            Mon · Tue · Wed · Thu · Fri · Sat · Sun
          </div>
        </div>
      </nav>
    </aside>
  );
}
