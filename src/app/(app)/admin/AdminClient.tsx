"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  createOrganizationAction,
  deleteOrganizationAction,
  forcePasswordResetAction,
  resendOrgAdminInviteAction,
  setOrgDisabledAction,
  setUserDisabledAction,
  setUserSuperadminAction,
} from "./actions";

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
};

type Tab = "overview" | "organizations" | "users";

export function AdminClient({
  currentUserId,
  orgs,
  users,
  stats,
}: {
  currentUserId: string;
  orgs: OrgRow[];
  users: UserRow[];
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
        meta={[
          { label: "Organizations", value: String(stats.orgCount) },
          { label: "Active orgs", value: String(stats.activeOrgs), accent: "emerald" },
          { label: "Users", value: String(stats.userCount) },
          {
            label: "Pending admin invites",
            value: String(stats.pendingAdminInvites),
            accent: stats.pendingAdminInvites > 0 ? "gold" : undefined,
          },
        ]}
      />

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-white/10">
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
        <OrganizationsTab orgs={orgs} currentUserId={currentUserId} />
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
      <div className="mt-4 rounded-md border border-dashed border-white/10 px-3 py-2 font-mono text-[11px] text-muted">
        Audit log and cross-org activity feed ship in a later release.
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
  currentUserId,
}: {
  orgs: OrgRow[];
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
      <CreateOrgPanel className="xl:col-span-1" />
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

function CreateOrgPanel({ className }: { className?: string }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminTitle, setAdminTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setSuccess(
        `Created "${orgName}" and sent admin invite to ${adminEmail}.`,
      );
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
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {success}
          </div>
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

  async function toggleDisabled() {
    setBusy(true);
    setErr(null);
    const res = await setOrgDisabledAction(org.id, !org.disabled);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
  }

  async function resendAdminInvite(id: string) {
    setBusy(true);
    setErr(null);
    const res = await resendOrgAdminInviteAction(id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else router.refresh();
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
    <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
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
                <button
                  type="button"
                  className="aur-btn aur-btn-ghost text-[10px]"
                  disabled={busy}
                  onClick={() => resendAdminInvite(i.id)}
                >
                  Resend
                </button>
              </li>
            ))}
          </ul>
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
    const res = await forcePasswordResetAction(u.id);
    setBusy(false);
    if (!res.ok) setErr(res.error);
    else setNote(`Reset link emailed to ${u.email}.`);
  }

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text">
            {u.name ?? u.email}
            {isSelf ? (
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
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
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
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
    </li>
  );
}
