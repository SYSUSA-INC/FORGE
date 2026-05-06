"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  createRuleAction,
  deleteRuleAction,
  testSendRuleAction,
  updateRuleAction,
  type OrgUserRow,
  type RuleRow,
} from "./actions";
import type {
  NotificationFrequency,
  NotificationRecipientStrategy,
  NotificationRuleEventKind,
} from "@/db/schema";

const EVENT_KINDS: { value: NotificationRuleEventKind; label: string }[] = [
  { value: "opportunity_due_soon", label: "Opportunity due soon" },
  { value: "proposal_section_overdue", label: "Proposal section overdue" },
  { value: "review_request_pending", label: "Review request pending" },
  { value: "audit_anomaly", label: "Audit anomaly" },
  { value: "opportunity_stage_advance", label: "Opportunity stage advance" },
  { value: "proposal_stage_advance", label: "Proposal stage advance" },
  { value: "solicitation_review_complete", label: "Solicitation review complete" },
];

const STRATEGIES: { value: NotificationRecipientStrategy; label: string }[] = [
  { value: "specific_users", label: "Specific users" },
  { value: "role", label: "By role" },
  { value: "proposal_owner", label: "Proposal owner / manager" },
  { value: "opportunity_owner", label: "Opportunity owner" },
  { value: "all_admins", label: "All org admins" },
];

const FREQUENCIES: { value: NotificationFrequency; label: string }[] = [
  { value: "immediate", label: "Immediate" },
  { value: "daily_digest", label: "Daily digest" },
  { value: "weekly_digest", label: "Weekly digest" },
];

const ROLES = ["admin", "capture", "proposal", "pricing", "viewer"];

function emptyRule(): RuleFormState {
  return {
    id: null,
    name: "",
    description: "",
    eventKind: "opportunity_due_soon",
    matchFilterText: "",
    recipientStrategy: "all_admins",
    recipientUserIds: [],
    recipientRoles: ["admin"],
    channels: ["in_app"],
    frequency: "immediate",
    slaSeconds: 0,
    escalationUserIds: [],
    active: true,
  };
}

type RuleFormState = {
  id: string | null;
  name: string;
  description: string;
  eventKind: NotificationRuleEventKind;
  matchFilterText: string;
  recipientStrategy: NotificationRecipientStrategy;
  recipientUserIds: string[];
  recipientRoles: string[];
  channels: string[];
  frequency: NotificationFrequency;
  slaSeconds: number;
  escalationUserIds: string[];
  active: boolean;
};

function ruleToForm(r: RuleRow): RuleFormState {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    eventKind: r.eventKind,
    matchFilterText:
      Object.keys(r.matchFilter).length === 0
        ? ""
        : JSON.stringify(r.matchFilter, null, 2),
    recipientStrategy: r.recipientStrategy,
    recipientUserIds: r.recipientUserIds,
    recipientRoles: r.recipientRoles,
    channels: r.channels,
    frequency: r.frequency,
    slaSeconds: r.slaSeconds,
    escalationUserIds: r.escalationUserIds,
    active: r.active,
  };
}

export function NotificationRulesClient({
  initialRules,
  orgUsers,
  canEdit,
}: {
  initialRules: RuleRow[];
  orgUsers: OrgUserRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const usersById = useMemo(() => {
    const m = new Map<string, OrgUserRow>();
    for (const u of orgUsers) m.set(u.id, u);
    return m;
  }, [orgUsers]);

  function startNew() {
    setEditing(emptyRule());
    setError(null);
    setNotice(null);
  }

  function startEdit(rule: RuleRow) {
    setEditing(ruleToForm(rule));
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditing(null);
    setError(null);
  }

  function setField<K extends keyof RuleFormState>(
    key: K,
    value: RuleFormState[K],
  ) {
    setEditing((cur) => (cur ? { ...cur, [key]: value } : cur));
  }

  function toggleArrayValue(
    key: "channels" | "recipientUserIds" | "recipientRoles" | "escalationUserIds",
    value: string,
  ) {
    setEditing((cur) => {
      if (!cur) return cur;
      const set = new Set(cur[key]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...cur, [key]: [...set] };
    });
  }

  function save() {
    if (!editing) return;
    setError(null);

    let matchFilter: Record<string, unknown> = {};
    if (editing.matchFilterText.trim()) {
      try {
        const parsed = JSON.parse(editing.matchFilterText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          matchFilter = parsed as Record<string, unknown>;
        } else {
          setError("Match filter must be a JSON object.");
          return;
        }
      } catch {
        setError("Match filter is not valid JSON.");
        return;
      }
    }

    const payload = {
      name: editing.name,
      description: editing.description,
      eventKind: editing.eventKind,
      matchFilter,
      recipientStrategy: editing.recipientStrategy,
      recipientUserIds: editing.recipientUserIds,
      recipientRoles: editing.recipientRoles,
      channels: editing.channels,
      frequency: editing.frequency,
      slaSeconds: editing.slaSeconds,
      escalationUserIds: editing.escalationUserIds,
      active: editing.active,
    };

    startTransition(async () => {
      const res = editing.id
        ? await updateRuleAction(editing.id, payload)
        : await createRuleAction(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(editing.id ? "Rule updated." : "Rule created.");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete this rule? Existing deliveries are preserved.")) return;
    startTransition(async () => {
      const res = await deleteRuleAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Rule deleted.");
      router.refresh();
    });
  }

  function testSend(id: string) {
    startTransition(async () => {
      const res = await testSendRuleAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        res.deliveryCount === 0
          ? "Test fired but produced no deliveries — check the rule's recipients."
          : `Test fired — ${res.deliveryCount} delivery row${res.deliveryCount === 1 ? "" : "s"} created.`,
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald-300">
          {notice}
        </div>
      ) : null}

      {editing ? (
        <Panel
          title={editing.id ? "Edit rule" : "New rule"}
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="aur-btn aur-btn-ghost text-[11px]"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !editing.name.trim()}
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {pending ? "Saving…" : editing.id ? "Save changes" : "Create rule"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name" required>
              <input
                className="aur-input"
                value={editing.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </Field>
            <Field label="Active">
              <label className="flex items-center gap-2 font-mono text-[12px]">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setField("active", e.target.checked)}
                />
                {editing.active ? "Rule fires on matching events" : "Rule paused"}
              </label>
            </Field>
            <Field label="Event kind" className="md:col-span-2">
              <select
                className="aur-input"
                value={editing.eventKind}
                onChange={(e) =>
                  setField(
                    "eventKind",
                    e.target.value as NotificationRuleEventKind,
                  )
                }
              >
                {EVENT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description" className="md:col-span-2">
              <textarea
                className="aur-input min-h-[60px] resize-y"
                value={editing.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Why this rule exists; who owns it."
              />
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Recipient strategy">
              <select
                className="aur-input"
                value={editing.recipientStrategy}
                onChange={(e) =>
                  setField(
                    "recipientStrategy",
                    e.target.value as NotificationRecipientStrategy,
                  )
                }
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frequency">
              <select
                className="aur-input"
                value={editing.frequency}
                onChange={(e) =>
                  setField("frequency", e.target.value as NotificationFrequency)
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {editing.recipientStrategy === "specific_users" ? (
            <Field label="Recipients" className="mt-3">
              <UserCheckList
                users={orgUsers}
                selected={editing.recipientUserIds}
                onToggle={(id) => toggleArrayValue("recipientUserIds", id)}
              />
            </Field>
          ) : null}

          {editing.recipientStrategy === "role" ? (
            <Field label="Roles" className="mt-3">
              <div className="flex flex-wrap gap-2">
                {ROLES.map((role) => {
                  const checked = editing.recipientRoles.includes(role);
                  return (
                    <label
                      key={role}
                      className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1 font-mono text-[11px] ${checked ? "border-cobalt-400 bg-cobalt-400/10 text-cobalt" : "border-white/10 bg-white/[0.02] text-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleArrayValue("recipientRoles", role)}
                      />
                      {role}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}

          <Field label="Channels" className="mt-3">
            <div className="flex gap-3 font-mono text-[12px]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.channels.includes("in_app")}
                  onChange={() => toggleArrayValue("channels", "in_app")}
                />
                In-app
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.channels.includes("email")}
                  onChange={() => toggleArrayValue("channels", "email")}
                />
                Email
              </label>
            </div>
          </Field>

          <Field label="SLA escalation (seconds)" className="mt-3">
            <input
              type="number"
              min={0}
              max={30 * 24 * 3600}
              className="aur-input w-40"
              value={editing.slaSeconds}
              onChange={(e) =>
                setField("slaSeconds", Math.max(0, Number(e.target.value) || 0))
              }
            />
            <p className="mt-1 font-mono text-[10px] text-muted">
              0 = no SLA. If set, deliveries that aren't acknowledged in this
              window get escalated to the users below.
            </p>
          </Field>

          {editing.slaSeconds > 0 ? (
            <Field label="Escalation recipients" className="mt-3">
              <UserCheckList
                users={orgUsers}
                selected={editing.escalationUserIds}
                onToggle={(id) => toggleArrayValue("escalationUserIds", id)}
              />
            </Field>
          ) : null}

          <Field label="Match filter (advanced — JSON)" className="mt-3">
            <textarea
              className="aur-input min-h-[80px] resize-y font-mono text-[11px]"
              value={editing.matchFilterText}
              onChange={(e) => setField("matchFilterText", e.target.value)}
              placeholder={`{}\n\nLeave empty to match every event of this kind.\nExample: {"toStage": "submitted"} only fires for transitions into submitted.`}
            />
          </Field>
        </Panel>
      ) : (
        canEdit ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={startNew}
              className="aur-btn aur-btn-primary text-[12px]"
            >
              + New rule
            </button>
          </div>
        ) : null
      )}

      <Panel title="Rules" eyebrow={`${initialRules.length} configured`}>
        {initialRules.length === 0 ? (
          <p className="font-body text-[13px] text-muted">
            No rules yet. Click <strong>+ New rule</strong> to define who gets
            notified when something happens.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {initialRules.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-[14px] font-semibold text-text">
                        {r.name}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${r.active ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-white/15 bg-white/5 text-muted"}`}
                      >
                        {r.active ? "Active" : "Paused"}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                      Event:{" "}
                      <span className="text-text">{
                        EVENT_KINDS.find((k) => k.value === r.eventKind)?.label ?? r.eventKind
                      }</span>
                      {" · "}Recipients:{" "}
                      <span className="text-text">{
                        STRATEGIES.find((s) => s.value === r.recipientStrategy)?.label ?? r.recipientStrategy
                      }</span>
                      {" · "}Channels:{" "}
                      <span className="text-text">{r.channels.join(", ")}</span>
                      {" · "}Frequency:{" "}
                      <span className="text-text">{
                        FREQUENCIES.find((f) => f.value === r.frequency)?.label ?? r.frequency
                      }</span>
                      {r.slaSeconds > 0 ? (
                        <>
                          {" · "}SLA:{" "}
                          <span className="text-amber-200">{Math.round(r.slaSeconds / 60)}m</span>
                        </>
                      ) : null}
                    </div>
                    {r.description ? (
                      <p className="mt-1 font-body text-[12px] text-muted">
                        {r.description}
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => testSend(r.id)}
                        className="aur-btn aur-btn-ghost text-[11px]"
                        disabled={pending}
                      >
                        Test send
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        className="aur-btn aur-btn-ghost text-[11px]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="aur-btn aur-btn-ghost text-[11px] text-rose"
                        disabled={pending}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function UserCheckList({
  users,
  selected,
  onToggle,
}: {
  users: OrgUserRow[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <div className="max-h-48 overflow-auto rounded border border-white/10 bg-canvas px-2 py-1">
      {users.length === 0 ? (
        <p className="px-2 py-1 font-mono text-[11px] text-muted">
          No active members in this org.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {users.map((u) => {
            const checked = selectedSet.has(u.id);
            return (
              <li key={u.id}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-mono text-[11px] ${checked ? "bg-cobalt-400/10 text-text" : "text-muted hover:bg-white/[0.04] hover:text-text"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(u.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {u.name ?? u.email}
                  </span>
                  <span className="shrink-0 text-subtle">{u.role}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
