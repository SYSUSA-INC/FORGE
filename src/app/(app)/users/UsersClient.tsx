"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { Role, MembershipStatus } from "@/db/schema";
import {
  changeMemberRoleAction,
  inviteUserAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  setMemberStatusAction,
} from "./actions";

export type Member = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: Role;
  status: MembershipStatus;
  title: string | null;
  joinedAt: string;
  verified: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: Role;
  title: string | null;
  invitedAt: string;
};

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Full access, manages users" },
  { value: "capture", label: "Capture", description: "Qualifies opportunities" },
  { value: "proposal", label: "Proposal", description: "Runs proposal response" },
  { value: "author", label: "Author", description: "Writes sections" },
  { value: "reviewer", label: "Reviewer", description: "Reviews drafts" },
  { value: "pricing", label: "Pricing", description: "Owns cost volume" },
  { value: "viewer", label: "Viewer", description: "Read-only access" },
];

function roleLabel(r: Role): string {
  return ROLES.find((x) => x.value === r)?.label ?? r;
}

export function UsersClient({
  currentUserId,
  members,
  pendingInvites,
}: {
  currentUserId: string;
  members: Member[];
  pendingInvites: PendingInvite[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="Users & Roles"
        title="Team access"
        subtitle="Invite teammates, assign roles, and manage access for your organization."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <InvitePanel className="xl:col-span-1" />
        <PendingPanel
          className="xl:col-span-2"
          invites={pendingInvites}
        />
      </div>

      <div className="mt-4">
        <MembersPanel members={members} currentUserId={currentUserId} />
      </div>
    </>
  );
}

function InvitePanel({ className }: { className?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await inviteUserAction({ email, role, title });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(`Invitation sent to ${email}.`);
      setEmail("");
      setTitle("");
      setRole("viewer");
      router.refresh();
    });
  }

  return (
    <Panel
      title="Invite a user"
      eyebrow="Add team member"
      className={className}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
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
          <select
            className="aur-input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.description}
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
          disabled={pending || !email}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </form>
    </Panel>
  );
}

function PendingPanel({
  invites,
  className,
}: {
  invites: PendingInvite[];
  className?: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRevoke(id: string) {
    setError(null);
    setPendingId(id);
    const res = await revokeInviteAction(id);
    setPendingId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  async function onResend(id: string) {
    setError(null);
    setPendingId(id);
    const res = await resendInviteAction(id);
    setPendingId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <Panel
      title="Pending invitations"
      eyebrow="Awaiting acceptance"
      className={className}
    >
      {error ? (
        <div className="mb-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {invites.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">No pending invites.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((i) => (
            <li
              key={i.id}
              className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[1fr_auto_auto]"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px] text-text">{i.email}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  {roleLabel(i.role)} · invited {new Date(i.invitedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                onClick={() => onResend(i.id)}
                disabled={pendingId === i.id}
              >
                {pendingId === i.id ? "…" : "Resend"}
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-danger text-[11px]"
                onClick={() => onRevoke(i.id)}
                disabled={pendingId === i.id}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MembersPanel({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChangeRole(userId: string, role: Role) {
    setError(null);
    setPendingId(userId);
    const res = await changeMemberRoleAction(userId, role);
    setPendingId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  async function onToggleStatus(userId: string, currentStatus: MembershipStatus) {
    setError(null);
    setPendingId(userId);
    const next = currentStatus === "active" ? "disabled" : "active";
    const res = await setMemberStatusAction(userId, next);
    setPendingId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  async function onRemove(userId: string, email: string) {
    if (
      !window.confirm(`Remove ${email} from this organization? This cannot be undone.`)
    ) {
      return;
    }
    setError(null);
    setPendingId(userId);
    const res = await removeMemberAction(userId);
    setPendingId(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <Panel title="Members" eyebrow="Current team">
      {error ? (
        <div className="mb-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const isSelf = m.userId === currentUserId;
          const initials =
            (m.name ?? m.email)
              .split(/\s+|@/)
              .filter(Boolean)
              .slice(0, 2)
              .map((x) => x[0]?.toUpperCase() ?? "")
              .join("") || "·";
          return (
            <li
              key={m.userId}
              className="grid grid-cols-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[auto_1fr_auto_auto_auto_auto]"
            >
              {m.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.image}
                  alt=""
                  className="h-9 w-9 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  className="grid h-9 w-9 place-items-center rounded-full font-mono text-[11px] font-bold text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, #2DD4BF 0%, #EC4899 100%)",
                  }}
                >
                  {initials}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">
                  {m.name ?? m.email}
                  {isSelf ? (
                    <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                      You
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                  {m.email}
                  {m.title ? <> · {m.title}</> : null}
                </div>
              </div>
              <select
                className="aur-input text-[12px] md:w-40"
                value={m.role}
                disabled={isSelf || pendingId === m.userId}
                onChange={(e) => onChangeRole(m.userId, e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span
                className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                  m.status === "active"
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-white/20 bg-white/[0.03] text-muted"
                }`}
              >
                {m.status}
              </span>
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                disabled={isSelf || pendingId === m.userId}
                onClick={() => onToggleStatus(m.userId, m.status)}
              >
                {m.status === "active" ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-danger text-[11px]"
                disabled={isSelf || pendingId === m.userId}
                onClick={() => onRemove(m.userId, m.email)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
