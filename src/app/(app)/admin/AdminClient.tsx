"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InviteLinkNotice } from "@/components/auth/InviteLinkNotice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { isPublicEmailDomain } from "@/lib/email-domain";
import type { InviteResult, ResetLinkResult } from "@/lib/invite-types";
import {
  superadminApproveCrossDomainInviteAction,
  superadminCreateInviteLinkAction,
  superadminDenyCrossDomainInviteAction,
  superadminInviteUserAction,
} from "./orgs/[id]/users/actions";
import {
  createOrganizationAction,
  deleteOrganizationAction,
  forcePasswordResetAction,
  resendOrgAdminInviteAction,
  setOrgDisabledAction,
  setUserDisabledAction,
  setUserSuperadminAction,
} from "./actions";

const INVITE_ROLES: { value: string; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "capture", label: "Capture lead" },
  { value: "proposal", label: "Proposal manager" },
  { value: "author", label: "Author" },
  { value: "reviewer", label: "Reviewer" },
  { value: "pricing", label: "Pricing" },
  { value: "viewer", label: "Viewer" },
];

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  disabled: boolean;
  memberCount: number;
  pendingAdminInvites: { id: string; email: string; invitedAt: string }[];
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  isSuperadmin: boolean;
  disabled: boolean;
  verified: boolean;
  createdAt: string;
  memberships: {
    organizationId: string;
    organizationName: string;
    role: string;
    status: string;
  }[];
};

type Stats = {
  orgCount: number;
  userCount: number;
  activeOrgs: number;
  activeUsers: number;
  pendingAdminInvites: number;
  pendingApprovals: number;
};

/** BL-AUTH-DOMAIN — one cross-domain invite waiting for the platform stamp. */
export type ApprovalRow = {
  inviteId: string;
  email: string;
  domain: string | null;
  role: string;
  title: string | null;
  invitedAt: string;
  invitedByEmail: string | null;
  organizationId: string;
  organizationName: string;
  homeOrganizationId: string | null;
  homeOrganizationName: string | null;
};

type Tab = "overview" | "organizations" | "users";

export function AdminClient({
  currentUserId,
  orgs,
  users,
  approvals = [],
  stats,
}: {
  currentUserId: string;
  orgs: OrgRow[];
  users: UserRow[];
  approvals?: ApprovalRow[];
  stats: Stats;
}) {
  const [tab, setTab] = useState<Tab>("organizations");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "organizations", label: "Organizations" },
    { key: "users", label: "Platform users" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="SuperAdmin portal"
        subtitle="Onboard organizations, manage platform users, and control access globally."
        actions={
          <>
            <Link
              href="/admin/migrations"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Apply pending DB migrations"
            >
              Migrations →
            </Link>
            <Link
              href="/admin/source-requests"
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Source requests →
            </Link>
            <Link
              href="/admin/sba-8a"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Import the SBA 8(a) participant registry"
            >
              SBA 8(a) →
            </Link>
            <Link
              href="/admin/tiers"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="View subscription tier definitions and per-tier tenant counts"
            >
              Tiers →
            </Link>
            <Link
              href="/admin/promo-codes"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Manage promotional discount codes"
            >
              Promo codes →
            </Link>
            <Link
              href="/admin/errors"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="In-app production error log — uncaught exceptions deduped by fingerprint"
            >
              Errors →
            </Link>
            <Link
              href="/platform/audit-log"
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Cross-tenant audit log — every recorded action across every org"
            >
              Audit log →
            </Link>
          </>
        }
        meta={[
          { label: "Organizations", value: String(stats.orgCount) },
          { label: "Active orgs", value: String(stats.activeOrgs), accent: "emerald" },
          { label: "Users", value: String(stats.userCount) },
          {
            label: "Pending admin invites",
            value: String(stats.pendingAdminInvites),
            accent: stats.pendingAdminInvites > 0 ? "gold" : undefined,
          },
          {
            label: "Cross-domain approvals",
            value: String(stats.pendingApprovals),
            accent: stats.pendingApprovals > 0 ? "gold" : undefined,
          },
        ]}
      />

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-layer/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative -mb-px border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
              tab === t.key
                ? "border-teal-400 text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab stats={stats} />}
      {tab === "organizations" && (
        <OrganizationsTab orgs={orgs} approvals={approvals} currentUserId={currentUserId} />
      )}
      {tab === "users" && <UsersTab users={users} currentUserId={currentUserId} />}
    </>
  );
}

function OverviewTab({ stats }: { stats: Stats }) {
  return (
    <Panel title="Platform overview">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Organizations" value={stats.orgCount} />
        <StatTile label="Active orgs" value={stats.activeOrgs} />
        <StatTile label="Users" value={stats.userCount} />
        <StatTile label="Active users" value={stats.activeUsers} />
      </div>
    </Panel>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="aur-card px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight text-text">
        {value}
      </div>
    </div>
  );
}

function OrganizationsTab({
  orgs,
  approvals,
  currentUserId,
}: {
  orgs: OrgRow[];
  approvals: ApprovalRow[];
  currentUserId: string;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return orgs;
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(f) ||
        o.slug.toLowerCase().includes(f) ||
        o.pendingAdminInvites.some((i) => i.email.toLowerCase().includes(f)),
    );
  }, [orgs, filter]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-3">
        <CrossDomainApprovalsPanel approvals={approvals} />
      </div>
      <div className="flex flex-col gap-4 xl:col-span-1">
        <InviteUserPanel orgs={orgs} />
        <CreateOrgPanel />
      </div>
      <div className="xl:col-span-2">
        <Panel
          title="All organizations"
          eyebrow={`${filtered.length} of ${orgs.length}`}
          actions={
            <input
              className="aur-input w-56 text-[12px]"
              placeholder="Search name or slug…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          }
        >
          {filtered.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No organizations match.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((org) => (
                <OrgRowItem
                  key={org.id}
                  org={org}
                  currentUserId={currentUserId}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * BL-AUTH-DOMAIN — the platform admin's approval queue. By default a
 * person may only join the tenant that owns their email domain; a tenant
 * admin who invites someone from another domain only creates a request.
 * Nothing reaches the invitee until a platform admin approves it here.
 * "Approve and allow domain" also adds the domain to the tenant's
 * approved external domains so later invites from it go straight out.
 */
function CrossDomainApprovalsPanel({ approvals }: { approvals: ApprovalRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    inviteId: string;
    email: string;
    tenantName: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  async function approve(a: ApprovalRow, allowDomain: boolean) {
    if (
      allowDomain &&
      !window.confirm(
        `Approve ${a.email} AND allow every future invite from ${a.domain} into ${a.organizationName} without approval?`,
      )
    ) {
      return;
    }
    setError(null);
    setDone(null);
    setBusyId(a.inviteId);
    const res = await superadminApproveCrossDomainInviteAction(a.organizationId, a.inviteId, {
      allowDomain,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone({ inviteId: a.inviteId, email: a.email, tenantName: a.organizationName, res });
    router.refresh();
  }

  async function deny(a: ApprovalRow) {
    if (!window.confirm(`Deny ${a.email} joining ${a.organizationName}? The invitation is revoked.`)) {
      return;
    }
    setError(null);
    setDone(null);
    setBusyId(a.inviteId);
    const res = await superadminDenyCrossDomainInviteAction(a.organizationId, a.inviteId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <Panel
      title="Cross-domain approvals"
      eyebrow={
        approvals.length === 0
          ? "Nothing waiting"
          : `${approvals.length} request${approvals.length === 1 ? "" : "s"} waiting for you`
      }
    >
      <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
        By default people may only join the tenant that owns their email domain.
        These invitations were requested by tenant admins for people from other
        domains; the invitee has not been contacted. Approving sends the
        invitation. Denying revokes it.
      </p>
      {error ? (
        <div className="mb-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="mb-3">
          <InviteLinkNotice
            url={done.res.inviteUrl}
            emailSent={done.res.emailSent}
            warning={done.res.warning}
            sentTo={`${done.email} (${done.tenantName})`}
          />
        </div>
      ) : null}
      {approvals.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No cross-domain invitations are waiting. Tenant domains are set on each
          tenant&apos;s detail page.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {approvals.map((a) => {
            const canAllowDomain = !!a.domain && !isPublicEmailDomain(a.domain);
            return (
              <li
                key={a.inviteId}
                className="rounded-lg border border-gold/30 bg-gold/5 p-3"
              >
                <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px] text-text">
                      {a.email} <span className="text-muted">→</span>{" "}
                      <Link
                        href={`/admin/orgs/${a.organizationId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {a.organizationName}
                      </Link>{" "}
                      <span className="text-muted">as {a.role}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted">
                      {a.homeOrganizationName
                        ? `${a.domain} belongs to ${a.homeOrganizationName}`
                        : `${a.domain ?? "domain"} is not owned by any tenant`}
                      {" · "}requested by {a.invitedByEmail ?? "a tenant admin"} on{" "}
                      {new Date(a.invitedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="aur-btn aur-btn-primary text-[11px]"
                    disabled={busyId === a.inviteId}
                    onClick={() => approve(a, false)}
                    title="Approve this one person; the invitation is sent now"
                  >
                    {busyId === a.inviteId ? "…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="aur-btn aur-btn-ghost text-[11px]"
                    disabled={busyId === a.inviteId || !canAllowDomain}
                    onClick={() => approve(a, true)}
                    title={
                      canAllowDomain
                        ? `Approve and add ${a.domain} to the tenant's approved external domains`
                        : "Public mailbox providers cannot be approved as a domain"
                    }
                  >
                    Approve + allow domain
                  </button>
                  <button
                    type="button"
                    className="aur-btn aur-btn-danger text-[11px]"
                    disabled={busyId === a.inviteId}
                    onClick={() => deny(a)}
                  >
                    Deny
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * BL-AUTH-INVITE — platform admins invite into any tenant from here. The
 * tenant is a mandatory choice: a superadmin is not a member of the
 * tenants they support, so the session cannot supply it. Tenant admins
 * never see this panel; their /users page invites into their own tenant.
 */
function InviteUserPanel({ orgs }: { orgs: OrgRow[] }) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [title, setTitle] = useState("");
  const [attestUsPerson, setAttestUsPerson] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    email: string;
    tenantName: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  const activeOrgs = orgs.filter((o) => !o.disabled);
  const tenantName = activeOrgs.find((o) => o.id === tenantId)?.name ?? "";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!tenantId) {
      setError("Pick the tenant this person should join.");
      return;
    }
    startTransition(async () => {
      const res = await superadminInviteUserAction(tenantId, {
        email,
        role,
        title,
        attestUsPerson,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ email, tenantName, res });
      setEmail("");
      setTitle("");
      setRole("viewer");
      setAttestUsPerson(false);
      router.refresh();
    });
  }

  return (
    <Panel title="Invite a user to a tenant" eyebrow="Platform admin · tenant is required">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Tenant (required)</label>
          <select
            className="aur-input"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            required
          >
            <option value="">— choose a tenant —</option>
            {activeOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.memberCount} {o.memberCount === 1 ? "member" : "members"}
              </option>
            ))}
          </select>
        </div>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="aur-label">Role</label>
            <select className="aur-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {INVITE_ROLES.map((r) => (
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
        </div>
        <label className="flex items-start gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2 font-mono text-[11px] text-muted">
          <input
            type="checkbox"
            checked={attestUsPerson}
            onChange={(e) => setAttestUsPerson(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I confirm this invitee is a US person. Required when the tenant is
            ITAR-restricted; recorded with your user id and timestamp.
          </span>
        </label>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {result ? (
          <InviteLinkNotice
            url={result.res.inviteUrl}
            emailSent={result.res.emailSent}
            warning={result.res.warning}
            sentTo={`${result.email} (${result.tenantName})`}
          />
        ) : null}
        <button
          type="submit"
          disabled={pending || !email || !tenantId}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </form>
    </Panel>
  );
}

function CreateOrgPanel({ className }: { className?: string }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminTitle, setAdminTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    email: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createOrganizationAction({
        orgName,
        adminEmail,
        adminTitle,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess({ email: adminEmail, res });
      setOrgName("");
      setAdminEmail("");
      setAdminTitle("");
      router.refresh();
    });
  }

  return (
    <Panel
      title="Onboard a new organization"
      eyebrow="Create + invite admin"
      className={className}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Organization name</label>
          <input
            className="aur-input"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            placeholder="Acme Federal Services"
          />
        </div>
        <div>
          <label className="aur-label">Initial admin email</label>
          <input
            className="aur-input"
            type="email"
            inputMode="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
            placeholder="admin@company.com"
          />
        </div>
        <div>
          <label className="aur-label">Admin title (optional)</label>
          <input
            className="aur-input"
            value={adminTitle}
            onChange={(e) => setAdminTitle(e.target.value)}
            placeholder="Managing Director"
          />
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {success ? (
          <InviteLinkNotice
            url={success.res.inviteUrl}
            emailSent={success.res.emailSent}
            warning={success.res.warning}
            sentTo={success.email}
          />
        ) : null}
        <button
          type="submit"
          disabled={pending || !orgName || !adminEmail}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create organization"}
        </button>
      </form>
    </Panel>
  );
}

function OrgRowItem({
  org,
  currentUserId,
}: {
  org: OrgRow;
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{
    email: string;
    res: Extract<InviteResult, { ok: true }>;
  } | null>(null);

  async function toggleDisabled() {
    setBusy(true);
    setErr(null);
    const res = await setOrgDisabledAction(org.id, !org.disabled);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
  }

  async function resendAdminInvite(id: string, email: string) {
    setBusy(true);
    setErr(null);
    setInviteLink(null);
    const res = await resendOrgAdminInviteAction(id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else {
      setInviteLink({ email, res });
      router.refresh();
    }
  }

  async function copyAdminInviteLink(id: string, email: string) {
    setBusy(true);
    setErr(null);
    setInviteLink(null);
    const res = await superadminCreateInviteLinkAction(org.id, id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else setInviteLink({ email, res });
  }

  async function deleteOrg() {
    if (
      !window.confirm(
        `Permanently delete "${org.name}"? All members will lose access immediately. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const res = await deleteOrganizationAction(org.id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
  }

  void currentUserId;

  return (
    <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-3">
      <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="min-w-0">
          <div className="truncate font-display text-[13px] font-semibold text-text">
            {org.name}
            {org.disabled ? (
              <span className="ml-2 rounded bg-rose/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">
                Disabled
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            {org.slug} · {org.memberCount}{" "}
            {org.memberCount === 1 ? "member" : "members"} · created{" "}
            {new Date(org.createdAt).toLocaleDateString()}
          </div>
        </div>
        <Link
          href={`/admin/orgs/${org.id}`}
          className="aur-btn aur-btn-ghost text-[11px]"
          title="View per-tenant detail + storage + activity"
        >
          Details →
        </Link>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[11px]"
          disabled={busy}
          onClick={toggleDisabled}
        >
          {org.disabled ? "Enable" : "Disable"}
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-danger text-[11px]"
          disabled={busy}
          onClick={deleteOrg}
        >
          Delete
        </button>
      </div>

      {org.pendingAdminInvites.length > 0 ? (
        <div className="mt-3 rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
            Pending admin invitation
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {org.pendingAdminInvites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-2 font-mono text-[11px]"
              >
                <span>
                  {i.email} · invited{" "}
                  {new Date(i.invitedAt).toLocaleDateString()}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="aur-btn aur-btn-ghost text-[10px]"
                    disabled={busy}
                    onClick={() => copyAdminInviteLink(i.id, i.email)}
                    title="Get a fresh invite link to send by chat or ticket"
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="aur-btn aur-btn-ghost text-[10px]"
                    disabled={busy}
                    onClick={() => resendAdminInvite(i.id, i.email)}
                  >
                    Resend
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {inviteLink ? (
            <div className="mt-2">
              <InviteLinkNotice
                url={inviteLink.res.inviteUrl}
                emailSent={inviteLink.res.emailSent}
                warning={inviteLink.res.warning}
                sentTo={inviteLink.email}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {err ? (
        <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {err}
        </div>
      ) : null}
    </li>
  );
}

function UsersTab({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(f) ||
        u.email.toLowerCase().includes(f) ||
        u.memberships.some((m) =>
          m.organizationName.toLowerCase().includes(f),
        ),
    );
  }, [users, filter]);

  return (
    <Panel
      title="All platform users"
      eyebrow={`${filtered.length} of ${users.length}`}
      actions={
        <input
          className="aur-input w-56 text-[12px]"
          placeholder="Search name, email, or org…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      }
    >
      {filtered.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">No users match.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((u) => (
            <UserRowItem key={u.id} u={u} currentUserId={currentUserId} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UserRowItem({
  u,
  currentUserId,
}: {
  u: UserRow;
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reset, setReset] = useState<Extract<ResetLinkResult, { ok: true }> | null>(null);

  const isSelf = u.id === currentUserId;

  async function toggleDisabled() {
    setBusy(true);
    setErr(null);
    setNote(null);
    const res = await setUserDisabledAction(u.id, !u.disabled);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
  }

  async function toggleSuperadmin() {
    if (
      !u.isSuperadmin &&
      !window.confirm(
        `Grant ${u.email} full platform superadmin access? This is equivalent to your own access.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    setNote(null);
    const res = await setUserSuperadminAction(u.id, !u.isSuperadmin);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
  }

  async function forceReset() {
    setBusy(true);
    setErr(null);
    setNote(null);
    setReset(null);
    const res = await forcePasswordResetAction(u.id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else setReset(res);
  }

  return (
    <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-3">
      <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text">
            {u.name ?? u.email}
            {isSelf ? (
              <span className="ml-2 rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                You
              </span>
            ) : null}
            {u.isSuperadmin ? (
              <span className="ml-2 rounded bg-teal/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                Superadmin
              </span>
            ) : null}
            {u.disabled ? (
              <span className="ml-2 rounded bg-rose/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-rose">
                Disabled
              </span>
            ) : null}
            {!u.verified ? (
              <span className="ml-2 rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                Unverified
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
            {u.email} ·{" "}
            {u.memberships.length === 0
              ? "No org"
              : u.memberships
                  .map((m) => `${m.organizationName} (${m.role})`)
                  .join(", ")}
          </div>
        </div>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[11px]"
          disabled={busy}
          onClick={forceReset}
        >
          Reset password
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[11px]"
          disabled={busy || isSelf}
          onClick={toggleSuperadmin}
        >
          {u.isSuperadmin ? "Revoke superadmin" : "Make superadmin"}
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-danger text-[11px]"
          disabled={busy || isSelf}
          onClick={toggleDisabled}
        >
          {u.disabled ? "Enable" : "Disable"}
        </button>
      </div>
      {err ? (
        <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {err}
        </div>
      ) : null}
      {note ? (
        <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {note}
        </div>
      ) : null}
      {reset ? (
        <div className="mt-2">
          <InviteLinkNotice
            kind="reset"
            url={reset.resetUrl}
            emailSent={reset.emailSent}
            warning={reset.warning}
            sentTo={u.email}
          />
        </div>
      ) : null}
    </li>
  );
}
