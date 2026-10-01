"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveWorkspace, WORKSPACES, type Workspace } from "@/lib/nav-workspaces";
import { PALETTE_OPEN_EVENT } from "@/lib/palette";

/**
 * BL-NAV-WORKSPACES — the top bar's middle and its Settings shortcut
 * follow the active workspace: the tenant search box and Settings link
 * belong to everyday work; the company and platform consoles show a
 * badge naming the console instead, so an admin page never looks like
 * a proposal page with extra menus.
 *
 * BL-AIP-7d — the search box opens the ⌘K command palette (mounted by
 * the shell), which finds pages and records and asks the Brain.
 */
function openPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}
export function HeaderWorkspace({
  isOrgAdmin,
  isSuperadmin,
  hasWorkspace,
  preferredWorkspace = null,
}: {
  isOrgAdmin: boolean;
  isSuperadmin: boolean;
  hasWorkspace: boolean;
  preferredWorkspace?: Workspace | null;
}) {
  const pathname = usePathname();
  const workspace = resolveWorkspace(
    pathname,
    { isOrgAdmin, isSuperadmin, hasWorkspace },
    preferredWorkspace,
  );

  if (workspace === "work") {
    return (
      <>
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search or ask the Brain"
          className="grid h-9 w-9 place-items-center rounded-lg border border-layer/10 bg-layer/5 text-muted transition-colors hover:border-layer/20 hover:text-text md:hidden"
        >
          ⌕
        </button>
        <div className="ml-4 hidden min-w-0 flex-1 items-center md:flex">
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search or ask the Brain (⌘K)"
            className="aur-input relative flex w-full max-w-md items-center pl-8 pr-14 text-left font-body text-sm text-subtle hover:border-layer/30"
          >
            <span className="pointer-events-none absolute left-3 text-muted">⌕</span>
            <span className="truncate">Find a page or record, or ask the Brain…</span>
            <kbd className="absolute right-2 rounded-md border border-layer/10 bg-layer/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">
              ⌘K
            </kbd>
          </button>
        </div>
      </>
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
  preferredWorkspace = null,
}: {
  isOrgAdmin: boolean;
  isSuperadmin: boolean;
  hasWorkspace: boolean;
  preferredWorkspace?: Workspace | null;
}) {
  const pathname = usePathname();
  const workspace = resolveWorkspace(
    pathname,
    { isOrgAdmin, isSuperadmin, hasWorkspace },
    preferredWorkspace,
  );
  if (!hasWorkspace || workspace !== "work") return null;
  return (
    <Link href="/settings" className="aur-btn-ghost hidden md:inline-flex">
      Settings
    </Link>
  );
}
