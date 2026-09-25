"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InviteLinkNotice } from "@/components/auth/InviteLinkNotice";
import { Panel } from "@/components/ui/Panel";
import { isPublicEmailDomain, type TenantDomains } from "@/lib/email-domain";
import type { InviteResult } from "@/lib/invite-types";
import {
  superadminApproveCrossDomainInviteAction,
  superadminChangeMemberRoleAction,
  superadminCreateInviteLinkAction,
  superadminDenyCrossDomainInviteAction,
  superadminInviteUserAction,
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
  /** BL-AUTH-DOMAIN — domain neither owned by nor approved for the tenant. */
  externalDomain?: boolean;
};

type Invite = {
  id: string;
  email: string;
  domain?: string | null;
  role: string;
  title: string | null;
  invitedAt: string;
  /** BL-AUTH-DOMAIN — held until a platform admin approves it. */
  awaitingApproval?: boolean;
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
  organizationName,
  itarRestricted = false,
  tenantDomains,
  members,
  pendingInvites,
  activeAdminCount,
}: {
  organizationId: string;
  organizationName?: string;
  itarRestricted?: boolean;
  tenantDomains?: TenantDomains;
  members: Member[];
  pendingInvites: Invite[];
  activeAdminCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // BL-AUTH-INVITE — link produced by Resend / Copy link on an invite row.
  const [inviteLink, setInviteLink] = useState<{
    id: string;
    email: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  function runInvite(
    id: string,
    email: string,
    fn: () => Promise<InviteResult>,
  ): void {
    setError(null);
    setNotice(null);
    setInviteLink(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInviteLink({ id, email, res });
      router.refresh();
    });
  }

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
    runInvite(inviteId, email, () =>
      superadminResendInviteAction(organizationId, inviteId),
    );
  }

  function copyInviteLink(inviteId: string, email: string) {
    runInvite(inviteId, email, () =>
      superadminCreateInviteLinkAction(organizationId, inviteId),
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

  // BL-AUTH-DOMAIN — approving sends the invitation; the link shows below.
  function approveInvite(inviteId: string, email: string, domain: string | null | undefined, allowDomain: boolean) {
    if (
      allowDomain &&
      !window.confirm(
        `Approve ${email} AND allow every future invite from ${domain} into ${organizationName ?? "this tenant"} without approval?`,
      )
    ) {
      return;
    }
    runInvite(inviteId, email, () =>
      superadminApproveCrossDomainInviteAction(organizationId, inviteId, { allowDomain }),
    );
  }

  function denyInvite(inviteId: string, email: string) {
    if (!window.confirm(`Deny ${email}? The invitation is revoked.`)) return;
    run(`Deny invite to ${email}`, () =>
      superadminDenyCrossDomainInviteAction(organizationId, inviteId),
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

      <TenantInvitePanel
        organizationId={organizationId}
        organizationName={organizationName ?? "this tenant"}
        itarRestricted={itarRestricted}
        tenantDomains={tenantDomains}
      />

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
                      : "border-layer/10 bg-layer/[0.02]"
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
                      {m.externalDomain ? (
                        <Tag tone="gold">external domain</Tag>
                      ) : null}
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
                className="rounded-lg border border-layer/10 bg-layer/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="font-display text-[13px] text-text">
                      {i.email}
                      {i.awaitingApproval ? (
                        <span className="ml-2 align-middle">
                          <Tag tone="gold">awaiting your approval</Tag>
                        </span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[10px] text-muted">
                      Role: {i.role}
                      {i.title ? ` · ${i.title}` : ""} · invited{" "}
                      {formatDate(i.invitedAt)}
                      {i.awaitingApproval
                        ? " · cross-domain: the invitee has not been contacted"
                        : ""}
                    </div>
                  </div>
                  {i.awaitingApproval ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => approveInvite(i.id, i.email, i.domain, false)}
                        className="aur-btn aur-btn-primary text-[11px]"
                        title="Approve this one person; the invitation is sent now"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={pending || !i.domain || isPublicEmailDomain(i.domain)}
                        onClick={() => approveInvite(i.id, i.email, i.domain, true)}
                        className="aur-btn aur-btn-ghost text-[11px]"
                        title={
                          i.domain && !isPublicEmailDomain(i.domain)
                            ? `Approve and add ${i.domain} to this tenant's approved external domains`
                            : "Public mailbox providers cannot be approved as a domain"
                        }
                      >
                        Approve + allow domain
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => denyInvite(i.id, i.email)}
                        className="aur-btn aur-btn-danger text-[11px]"
                      >
                        Deny
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => copyInviteLink(i.id, i.email)}
                        className="aur-btn aur-btn-ghost text-[11px]"
                        title="Get a fresh invite link to send by chat or ticket"
                      >
                        Copy link
                      </button>
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
                  )}
                </div>
                {inviteLink && inviteLink.id === i.id ? (
                  <div className="mt-2">
                    <InviteLinkNotice
                      url={inviteLink.res.inviteUrl}
                      emailSent={inviteLink.res.emailSent}
                      warning={inviteLink.res.warning}
                      sentTo={inviteLink.email}
                    />
                  </div>
                ) : null}
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
  tone: "emerald" | "rose" | "muted" | "gold";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : tone === "rose"
        ? "border-rose/40 bg-rose/10 text-rose"
        : tone === "gold"
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-layer/10 bg-layer/5 text-muted";
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

/**
 * BL-AUTH-INVITE — invite straight into this tenant as platform support.
 * The tenant is fixed by the page; the action takes it explicitly and
 * audits the invite into the tenant's log with viaSuperadmin.
 */
function TenantInvitePanel({
  organizationId,
  organizationName,
  itarRestricted,
  tenantDomains,
}: {
  organizationId: string;
  organizationName: string;
  itarRestricted: boolean;
  tenantDomains?: TenantDomains;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [title, setTitle] = useState("");
  const [attestUsPerson, setAttestUsPerson] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    email: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await superadminInviteUserAction(organizationId, {
        email,
        role,
        title,
        attestUsPerson,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ email, res });
      setEmail("");
      setTitle("");
      setRole("viewer");
      setAttestUsPerson(false);
      router.refresh();
    });
  }

  return (
    <Panel title={`Invite a user to ${organizationName}`} eyebrow="Platform admin · this tenant">
      {tenantDomains ? (
        <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted">
          Tenant domains:{" "}
          {tenantDomains.emailDomains.length > 0 ? tenantDomains.emailDomains.join(", ") : "none on file"}
          {tenantDomains.approvedExternalDomains.length > 0
            ? ` · approved external: ${tenantDomains.approvedExternalDomains.join(", ")}`
            : ""}
          . As a platform admin your invite from any other domain counts as approved
          and goes out at once; it is audited as a cross-domain invite.
        </p>
      ) : null}
      <form className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Email</label>
          <input
            className="aur-input"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@company.com"
          />
        </div>
        <div>
          <label className="aur-label">Role</label>
          <select className="aur-input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="aur-label">Title (optional)</label>
          <input
            className="aur-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Capture Manager"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending || !email}
            className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send invitation"}
          </button>
        </div>
        {itarRestricted ? (
          <label className="flex items-start gap-2 rounded-md border border-rose/30 bg-rose/[0.04] px-3 py-2 font-mono text-[11px] text-text md:col-span-4">
            <input
              type="checkbox"
              checked={attestUsPerson}
              onChange={(e) => setAttestUsPerson(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="text-rose">ITAR-restricted tenant.</strong> I confirm this
              invitee is a US person and that this attestation is recorded with my user id
              and timestamp.
            </span>
          </label>
        ) : null}
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose md:col-span-4">
            {error}
          </div>
        ) : null}
        {result ? (
          <div className="md:col-span-4">
            <InviteLinkNotice
              url={result.res.inviteUrl}
              emailSent={result.res.emailSent}
              warning={result.res.warning}
              sentTo={result.email}
            />
          </div>
        ) : null}
      </form>
    </Panel>
  );
}
