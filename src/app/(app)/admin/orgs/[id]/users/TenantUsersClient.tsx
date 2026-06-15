"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  superadminChangeMemberRoleAction,
  superadminRemoveMemberAction,
  superadminResendInviteAction,
  superadminRevokeInviteAction,
  superadminSetMembershipStatusAction,
} from "./actions";

type Member = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  status: string;
  title: string | null;
  joinedAt: string;
  verified: boolean;
  userGloballyDisabled: boolean;
  isPrimaryAdmin: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  title: string | null;
  invitedAt: string;
};

const ROLES: { value: string; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "capture", label: "Capture lead" },
  { value: "proposal", label: "Proposal manager" },
  { value: "author", label: "Author" },
  { value: "reviewer", label: "Reviewer" },
  { value: "pricing", label: "Pricing" },
  { value: "viewer", label: "Viewer" },
];

export function TenantUsersClient({
  organizationId,
  members,
  pendingInvites,
  activeAdminCount,
}: {
  organizationId: string;
  members: Member[];
  pendingInvites: Invite[];
  activeAdminCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(
    label: string,
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ): void {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(`${label}: ${res.error}`);
        return;
      }
      setNotice(`${label}: done.`);
      router.refresh();
    });
  }

  function changeRole(userId: string, role: string) {
    run("Change role", () =>
      superadminChangeMemberRoleAction(organizationId, userId, role),
    );
  }

  function setStatus(userId: string, status: "active" | "disabled") {
    run(status === "disabled" ? "Disable membership" : "Re-enable", () =>
      superadminSetMembershipStatusAction(organizationId, userId, status),
    );
  }

  function remove(userId: string, label: string) {
    if (
      !window.confirm(
        `Remove ${label} from this tenant?\n\nThis deletes their membership row. Their user account stays, but they lose access to this tenant's data. Reversible by inviting them again.`,
      )
    ) {
      return;
    }
    run("Remove member", () =>
      superadminRemoveMemberAction(organizationId, userId),
    );
  }

  function resendInvite(inviteId: string, email: string) {
    run(`Resend invite to ${email}`, () =>
      superadminResendInviteAction(organizationId, inviteId),
    );
  }

  function revokeInvite(inviteId: string, email: string) {
    if (
      !window.confirm(
        `Revoke pending invite for ${email}?\n\nThe magic link in their inbox will stop working. They can be invited again later.`,
      )
    ) {
      return;
    }
    run(`Revoke invite to ${email}`, () =>
      superadminRevokeInviteAction(organizationId, inviteId),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald-300">
          {notice}
        </div>
      ) : null}

      <Panel
        title="Members"
        eyebrow={`${members.length} total`}
      >
        {members.length === 0 ? (
          <p className="font-mono text-[11px] text-muted">
            No members. The tenant is empty — invite the primary admin via{" "}
            <a href="/admin" className="text-violet underline-offset-2 hover:underline">
              the SuperAdmin portal
            </a>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const isOnlyAdmin =
                activeAdminCount === 1 &&
                m.role === "admin" &&
                m.status === "active";
              return (
                <li
                  key={m.userId}
                  className={`rounded-lg border p-3 ${
                    m.status === "disabled" || m.userGloballyDisabled
                      ? "border-rose/30 bg-rose/[0.04]"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="font-display text-[13px] font-semibold text-text">
                        {m.name || m.email}
                        {m.isPrimaryAdmin ? (
                          <span className="ml-2 rounded bg-violet/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-violet">
                            Primary admin
                          </span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[10px] text-muted">
                        {m.email}
                        {m.title ? ` · ${m.title}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Tag tone={m.status === "active" ? "emerald" : "rose"}>
                        {m.status}
                      </Tag>
                      {m.userGloballyDisabled ? (
                        <Tag tone="rose">user disabled</Tag>
                      ) : null}
                      {m.verified ? (
                        <Tag tone="emerald">verified</Tag>
                      ) : (
                        <Tag tone="muted">unverified</Tag>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px]">
                    <span className="text-muted/70">
                      Joined {formatDate(m.joinedAt)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      defaultValue={m.role}
                      disabled={pending || isOnlyAdmin}
                      onChange={(e) => {
                        const newRole = e.target.value;
                        if (newRole === m.role) return;
                        if (
                          isOnlyAdmin &&
                          newRole !== "admin"
                        ) {
                          setError(
                            "Cannot demote the only active admin. Promote another member to admin first.",
                          );
                          e.target.value = m.role;
                          return;
                        }
                        changeRole(m.userId, newRole);
                      }}
                      className="aur-input min-w-[140px] text-[11px]"
                      title={
                        isOnlyAdmin
                          ? "Last active admin — promote someone else first"
                          : "Change member's role in this tenant"
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>

                    {m.status === "active" ? (
                      <button
                        type="button"
                        disabled={pending || isOnlyAdmin}
                        onClick={() => setStatus(m.userId, "disabled")}
                        className="aur-btn aur-btn-ghost text-[11px]"
                        title={
                          isOnlyAdmin
                            ? "Last active admin — promote someone else first"
                            : "Disable this user's membership in this tenant (user account stays active globally)"
                        }
                      >
                        Disable membership
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setStatus(m.userId, "active")}
                        className="aur-btn aur-btn-ghost text-[11px]"
                      >
                        Re-enable
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={pending || isOnlyAdmin}
                      onClick={() => remove(m.userId, m.name || m.email)}
                      className="aur-btn aur-btn-danger text-[11px]"
                      title={
                        isOnlyAdmin
                          ? "Last active admin — promote someone else first"
                          : "Delete the membership row; user keeps their account but loses access here"
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Pending invites"
        eyebrow={`${pendingInvites.length} waiting`}
      >
        {pendingInvites.length === 0 ? (
          <p className="font-mono text-[11px] text-muted">
            No pending invites for this tenant.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="font-display text-[13px] text-text">
                      {i.email}
                    </div>
                    <div className="font-mono text-[10px] text-muted">
                      Role: {i.role}
                      {i.title ? ` · ${i.title}` : ""} · invited{" "}
                      {formatDate(i.invitedAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => resendInvite(i.id, i.email)}
                      className="aur-btn aur-btn-ghost text-[11px]"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => revokeInvite(i.id, i.email)}
                      className="aur-btn aur-btn-danger text-[11px]"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Cross-tenant user controls (global)">
        <p className="font-body text-[12px] leading-relaxed text-muted">
          Some user-level operations apply across all tenants (not
          just this one). Use the SuperAdmin portal for:
        </p>
        <ul className="mt-2 list-disc pl-5 font-mono text-[11px] text-muted">
          <li>
            Disable a user globally (locks them out of every tenant)
          </li>
          <li>Force a password reset (emails the user a reset link)</li>
          <li>Toggle SuperAdmin status</li>
        </ul>
        <p className="mt-2 font-mono text-[11px]">
          <a
            href="/admin"
            className="text-violet underline-offset-2 hover:underline"
          >
            → SuperAdmin portal
          </a>
        </p>
      </Panel>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "emerald" | "rose" | "muted";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : tone === "rose"
        ? "border-rose/40 bg-rose/10 text-rose"
        : "border-white/10 bg-white/5 text-muted";
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${toneClass}`}
    >
      {children}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
