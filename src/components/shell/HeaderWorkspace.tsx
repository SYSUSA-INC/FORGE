"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveWorkspace, WORKSPACES } from "@/lib/nav-workspaces";

/**
 * BL-NAV-WORKSPACES — the top bar's middle and its Settings shortcut
 * follow the active workspace: the tenant search box and Settings link
 * belong to everyday work; the company and platform consoles show a
 * badge naming the console instead, so an admin page never looks like
 * a proposal page with extra menus.
 */
export function HeaderWorkspace({
  isOrgAdmin,
  isSuperadmin,
  hasWorkspace,
}: {
  isOrgAdmin: boolean;
  isSuperadmin: boolean;
  hasWorkspace: boolean;
}) {
  const pathname = usePathname();
  const workspace = resolveWorkspace(pathname, { isOrgAdmin, isSuperadmin, hasWorkspace });

  if (workspace === "work") {
    return (
      <div className="ml-4 hidden min-w-0 flex-1 items-center md:flex">
        <label className="relative flex w-full max-w-md items-center">
          <span className="pointer-events-none absolute left-3 text-muted">⌕</span>
          <input
            placeholder="Search solicitations, proposals, people…"
            className="aur-input pl-8 font-body text-sm"
          />
          <kbd className="absolute right-2 hidden rounded-md border border-layer/10 bg-layer/5 px-1.5 py-0.5 font-mono text-[10px] text-muted md:inline">
            ⌘K
          </kbd>
        </label>
      </div>
    );
  }

  const meta = WORKSPACES[workspace];
  return (
    <div className="ml-4 hidden min-w-0 flex-1 items-center gap-3 md:flex">
      <span
        className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${
          workspace === "platform"
            ? "border-violet/40 bg-violet/10 text-text"
            : "border-cobalt/40 bg-cobalt/10 text-text"
        }`}
      >
        {meta.label}
      </span>
      <span className="truncate font-mono text-[11px] text-muted">
        {workspace === "platform"
          ? "Every page here reads across tenants and is recorded in the platform audit log."
          : "Administration for your organization only."}
      </span>
    </div>
  );
}

/** The header's Settings shortcut — everyday work only. */
export function HeaderSettingsLink({
  isOrgAdmin,
  isSuperadmin,
  hasWorkspace,
}: {
  isOrgAdmin: boolean;
  isSuperadmin: boolean;
  hasWorkspace: boolean;
}) {
  const pathname = usePathname();
  const workspace = resolveWorkspace(pathname, { isOrgAdmin, isSuperadmin, hasWorkspace });
  if (!hasWorkspace || workspace !== "work") return null;
  return (
    <Link href="/settings" className="aur-btn-ghost hidden md:inline-flex">
      Settings
    </Link>
  );
}
