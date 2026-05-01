"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import type { Role } from "@/db/schema";
import type { MembersSummary } from "@/lib/settings-status";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  capture: "Capture manager",
  proposal: "Proposal manager",
  author: "Author",
  reviewer: "Reviewer",
  pricing: "Pricing analyst",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin:
    "Full org control — invite/disable users, edit org profile, manage settings.",
  capture: "Owns opportunity capture, evaluation, and bid/no-bid decisions.",
  proposal: "Owns proposal lifecycle, sections, color-team reviews, output.",
  author: "Drafts proposal sections; can edit assigned content.",
  reviewer: "Reviews assigned proposals; leaves comments and verdicts.",
  pricing: "Owns pricing volumes (Phase 8 deferred — placeholder role today).",
  viewer: "Read-only access to opportunities, proposals, and knowledge base.",
};

const ROLE_ORDER: Role[] = [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
];

export function UsersRolesTab({ members }: { members: MembersSummary }) {
  return (
    <>
      <Panel
        title="Members"
        eyebrow={`${members.total} active`}
        actions={
          <Link
            href="/users"
            className="aur-btn aur-btn-primary text-[11px]"
            title="Open the full user-management page (invite, disable, change role)."
          >
            Manage users →
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {ROLE_ORDER.map((role) => (
            <div
              key={role}
              className="aur-card-elevated px-3 py-2"
              title={ROLE_DESCRIPTIONS[role]}
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                {ROLE_LABELS[role]}
              </div>
              <div className="mt-1 font-display text-[20px] font-semibold text-foreground">
                {String(members.byRole[role] ?? 0).padStart(2, "0")}
              </div>
            </div>
          ))}
        </div>

        {members.recent.length > 0 ? (
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
              Recently joined
            </div>
            <ul className="space-y-1">
              {members.recent.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between font-body text-[13px]"
                >
                  <span>
                    <span className="text-foreground">{m.name || m.email}</span>
                    {m.name ? (
                      <span className="ml-2 text-muted">{m.email}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {ROLE_LABELS[m.role]} · {new Date(m.joinedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel title="Roles" eyebrow="What each role can do">
        <ul className="space-y-2">
          {ROLE_ORDER.map((role) => (
            <li
              key={role}
              className="aur-card-elevated px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-teal-300">
                  {ROLE_LABELS[role]}
                </div>
                <div className="font-mono text-[11px] text-muted">
                  {String(members.byRole[role] ?? 0).padStart(2, "0")} member
                  {members.byRole[role] === 1 ? "" : "s"}
                </div>
              </div>
              <div className="mt-1 font-body text-[13px] leading-relaxed text-muted">
                {ROLE_DESCRIPTIONS[role]}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
