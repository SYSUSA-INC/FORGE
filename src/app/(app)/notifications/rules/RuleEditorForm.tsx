"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import {
  CHANNEL_LABELS,
  FORMULA_KIND_LABELS,
  FORMULA_KINDS,
  FREQUENCY_LABELS,
  RECIPIENT_STRATEGY_LABELS,
  TRIGGER_EVENT_KIND_LABELS,
} from "@/lib/notification-rules-types";
import type {
  NotificationChannel,
  NotificationFrequency,
  NotificationRecipientStrategy,
  NotificationTriggerEventKind,
} from "@/db/schema";
import {
  createNotificationRuleAction,
  deleteNotificationRuleAction,
  setNotificationRuleActiveAction,
  testSendNotificationRuleAction,
  updateNotificationRuleAction,
  type OrgUserOption,
} from "./actions";
import type { RuleInput } from "@/lib/notification-rules-validation";

const ROLE_OPTIONS = [
  "admin",
  "capture",
  "proposal",
  "author",
  "reviewer",
  "pricing",
  "viewer",
] as const;
type Role = (typeof ROLE_OPTIONS)[number];

// Form state — a mutable variant of RuleInput (kept loose to allow
// the user to type free-form JSON in the match-filter textarea and
// have it parsed only on submit).
type FormState = {
  name: string;
  description: string;
  triggerEventKind: NotificationTriggerEventKind;
  matchFilterText: string;
  recipientStrategy: NotificationRecipientStrategy;
  specificUserIds: string[];
  roleBased: Role[];
  formulaKind: (typeof FORMULA_KINDS)[number];
  channels: NotificationChannel[];
  frequency: NotificationFrequency;
  slaHours: string; // "" or "0" = no SLA; UI uses hours; server stores seconds
  escalationEnabled: boolean;
  escalationStrategy: NotificationRecipientStrategy;
  escalationSpecificUserIds: string[];
  escalationRoleBased: Role[];
  escalationFormulaKind: (typeof FORMULA_KINDS)[number];
  active: boolean;
};

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  triggerEventKind: "opportunity_due_soon",
  matchFilterText: "{}",
  recipientStrategy: "role_based",
  specificUserIds: [],
  roleBased: ["admin"],
  formulaKind: "proposal_owner",
  channels: ["in_app"],
  frequency: "immediate",
  slaHours: "",
  escalationEnabled: false,
  escalationStrategy: "role_based",
  escalationSpecificUserIds: [],
  escalationRoleBased: ["admin"],
  escalationFormulaKind: "proposal_owner",
  active: true,
};

export type EditorInitial = {
  id: string;
  name: string;
  description: string;
  triggerEventKind: string;
  matchFilter: Record<string, unknown>;
  recipientStrategy: string;
  recipientConfig: Record<string, unknown>;
  channels: NotificationChannel[];
  frequency: string;
  slaSeconds: number | null;
  escalationStrategy: {
    strategy: string;
    config: Record<string, unknown>;
  } | null;
  active: boolean;
};

function initialFormFromLoaded(initial: EditorInitial | null): FormState {
  if (!initial) return { ...DEFAULT_FORM };
  const recipientCfg = initial.recipientConfig as {
    userIds?: string[];
    roles?: Role[];
    kind?: (typeof FORMULA_KINDS)[number];
  };
  const escCfg = (initial.escalationStrategy?.config ?? {}) as {
    userIds?: string[];
    roles?: Role[];
    kind?: (typeof FORMULA_KINDS)[number];
  };
  return {
    name: initial.name,
    description: initial.description,
    triggerEventKind: initial.triggerEventKind as NotificationTriggerEventKind,
    matchFilterText: JSON.stringify(initial.matchFilter ?? {}, null, 2),
    recipientStrategy: initial.recipientStrategy as NotificationRecipientStrategy,
    specificUserIds: recipientCfg.userIds ?? [],
    roleBased: recipientCfg.roles ?? ["admin"],
    formulaKind: recipientCfg.kind ?? "proposal_owner",
    channels: initial.channels,
    frequency: initial.frequency as NotificationFrequency,
    slaHours: initial.slaSeconds ? String(Math.round(initial.slaSeconds / 3600)) : "",
    escalationEnabled: !!initial.escalationStrategy,
    escalationStrategy:
      (initial.escalationStrategy?.strategy as NotificationRecipientStrategy) ?? "role_based",
    escalationSpecificUserIds: escCfg.userIds ?? [],
    escalationRoleBased: escCfg.roles ?? ["admin"],
    escalationFormulaKind: escCfg.kind ?? "proposal_owner",
    active: initial.active,
  };
}

function buildRuleInput(form: FormState): RuleInput | { error: string } {
  let matchFilter: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(form.matchFilterText || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "Match filter must be a JSON object." };
    }
    matchFilter = parsed as Record<string, unknown>;
  } catch {
    return { error: "Match filter is not valid JSON." };
  }

  const recipient: RuleInput["recipient"] =
    form.recipientStrategy === "specific_users"
      ? {
          strategy: "specific_users",
          config: { userIds: form.specificUserIds },
        }
      : form.recipientStrategy === "role_based"
        ? {
            strategy: "role_based",
            config: { roles: form.roleBased },
          }
        : form.recipientStrategy === "mentioned_in_payload"
          ? {
              strategy: "mentioned_in_payload",
              config: {},
            }
          : {
              strategy: "formula",
              config: { kind: form.formulaKind },
            };

  const escalation = !form.escalationEnabled
    ? null
    : {
        strategy: form.escalationStrategy,
        config:
          form.escalationStrategy === "specific_users"
            ? { userIds: form.escalationSpecificUserIds }
            : form.escalationStrategy === "role_based"
              ? { roles: form.escalationRoleBased }
              : form.escalationStrategy === "mentioned_in_payload"
                ? {}
                : { kind: form.escalationFormulaKind },
      };

  const slaParsed = form.slaHours.trim() ? Number(form.slaHours) : 0;
  if (form.slaHours.trim() && !Number.isFinite(slaParsed)) {
    return { error: "SLA hours must be a number." };
  }
  const slaSeconds = slaParsed > 0 ? Math.round(slaParsed * 3600) : null;

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    triggerEventKind: form.triggerEventKind,
    matchFilter,
    recipient,
    channels: form.channels,
    frequency: form.frequency,
    slaSeconds,
    escalation,
    active: form.active,
  };
}

type Props = {
  mode: "create" | "edit";
  ruleId?: string;
  initial: EditorInitial | null;
  orgUsers: OrgUserOption[];
};

export function RuleEditorForm({ mode, ruleId, initial, orgUsers }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialFormFromLoaded(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChannel(channel: NotificationChannel) {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel],
    }));
  }

  function toggleRole(role: Role, primary: boolean) {
    setForm((prev) => {
      const key = primary ? "roleBased" : "escalationRoleBased";
      const current = prev[key];
      return {
        ...prev,
        [key]: current.includes(role)
          ? current.filter((r) => r !== role)
          : [...current, role],
      };
    });
  }

  function onSubmit() {
    setError(null);
    const built = buildRuleInput(form);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createNotificationRuleAction(built)
          : await updateNotificationRuleAction(ruleId!, built);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (mode === "create") {
        const id = "id" in res ? res.id : null;
        router.push(id ? `/notifications/rules/${id}` : "/notifications/rules");
      } else {
        router.refresh();
      }
    });
  }

  function onToggleActive() {
    if (!ruleId) return;
    startTransition(async () => {
      const res = await setNotificationRuleActiveAction(ruleId, !form.active);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setForm((prev) => ({ ...prev, active: !prev.active }));
    });
  }

  function onTestSend() {
    if (!ruleId) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await testSendNotificationRuleAction(ruleId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Test send dispatched — check the configured recipients.");
    });
  }

  function onDelete() {
    if (!ruleId) return;
    if (!confirm("Delete this rule? This cannot be undone.")) return;
    startTransition(async () => {
      const res = await deleteNotificationRuleAction(ruleId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/notifications/rules");
    });
  }

  const triggerOptions = useMemo(
    () =>
      Object.entries(TRIGGER_EVENT_KIND_LABELS) as Array<
        [NotificationTriggerEventKind, string]
      >,
    [],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Identity">
        <div className="grid grid-cols-1 gap-3">
          <label>
            <div className="aur-label">Name</div>
            <input
              className="aur-input"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Notify pricing lead 48h before due date"
              maxLength={128}
            />
          </label>
          <label>
            <div className="aur-label">Description (optional)</div>
            <textarea
              className="aur-input"
              rows={2}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={512}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Trigger">
        <div className="grid grid-cols-1 gap-3">
          <label>
            <div className="aur-label">Event</div>
            <select
              className="aur-input"
              value={form.triggerEventKind}
              onChange={(e) =>
                update("triggerEventKind", e.target.value as NotificationTriggerEventKind)
              }
            >
              {triggerOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="aur-label">
              Match filter (JSON object — narrows the trigger)
            </div>
            <textarea
              className="aur-input font-mono text-[11px]"
              rows={3}
              spellCheck={false}
              value={form.matchFilterText}
              onChange={(e) => update("matchFilterText", e.target.value)}
              placeholder='{"stage": "submitted"}'
            />
          </label>
        </div>
      </Panel>

      <Panel title="Recipients">
        <div className="grid grid-cols-1 gap-3">
          <label>
            <div className="aur-label">Strategy</div>
            <select
              className="aur-input"
              value={form.recipientStrategy}
              onChange={(e) =>
                update(
                  "recipientStrategy",
                  e.target.value as NotificationRecipientStrategy,
                )
              }
            >
              {(
                Object.entries(RECIPIENT_STRATEGY_LABELS) as Array<
                  [NotificationRecipientStrategy, string]
                >
              ).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          {form.recipientStrategy === "specific_users" ? (
            <UserPicker
              label="Users"
              selected={form.specificUserIds}
              users={orgUsers}
              onChange={(ids) => update("specificUserIds", ids)}
            />
          ) : null}

          {form.recipientStrategy === "role_based" ? (
            <RoleChecklist
              selected={form.roleBased}
              onToggle={(r) => toggleRole(r, true)}
            />
          ) : null}

          {form.recipientStrategy === "formula" ? (
            <label>
              <div className="aur-label">Relationship</div>
              <select
                className="aur-input"
                value={form.formulaKind}
                onChange={(e) =>
                  update(
                    "formulaKind",
                    e.target.value as (typeof FORMULA_KINDS)[number],
                  )
                }
              >
                {FORMULA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FORMULA_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {form.recipientStrategy === "mentioned_in_payload" ? (
            <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
              Fires for every user the triggering event tagged as
              mentioned (in <code>payload.mentionedUserIds</code>) who
              is still an active member of this org. No extra
              configuration — the dispatcher decides the recipient
              set at runtime.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Delivery">
        <div className="grid grid-cols-1 gap-3">
          <div>
            <div className="aur-label">Channels</div>
            <div className="flex flex-wrap gap-2">
              {(
                Object.entries(CHANNEL_LABELS) as Array<
                  [NotificationChannel, string]
                >
              ).map(([key, label]) => {
                const active = form.channels.includes(key);
                const disabled = key === "slack" || key === "teams";
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => toggleChannel(key)}
                    disabled={disabled}
                    className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                      active && !disabled
                        ? "border-teal-400 bg-teal-400/10 text-text"
                        : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
                    } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label>
            <div className="aur-label">Frequency</div>
            <select
              className="aur-input"
              value={form.frequency}
              onChange={(e) =>
                update("frequency", e.target.value as NotificationFrequency)
              }
            >
              {(
                Object.entries(FREQUENCY_LABELS) as Array<
                  [NotificationFrequency, string]
                >
              ).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div className="aur-label">
              SLA — hours to acknowledge (blank = no SLA)
            </div>
            <input
              className="aur-input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.slaHours}
              onChange={(e) => update("slaHours", e.target.value)}
              placeholder="48"
            />
          </label>
        </div>
      </Panel>

      <Panel title="Escalation" className="xl:col-span-2">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.escalationEnabled}
              onChange={(e) => update("escalationEnabled", e.target.checked)}
            />
            <span className="font-mono text-[12px]">
              Escalate to a fallback recipient if SLA breaches
            </span>
          </label>
          {form.escalationEnabled ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label>
                <div className="aur-label">Fallback strategy</div>
                <select
                  className="aur-input"
                  value={form.escalationStrategy}
                  onChange={(e) =>
                    update(
                      "escalationStrategy",
                      e.target.value as NotificationRecipientStrategy,
                    )
                  }
                >
                  {(
                    Object.entries(RECIPIENT_STRATEGY_LABELS) as Array<
                      [NotificationRecipientStrategy, string]
                    >
                  ).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              {form.escalationStrategy === "specific_users" ? (
                <UserPicker
                  label="Fallback users"
                  selected={form.escalationSpecificUserIds}
                  users={orgUsers}
                  onChange={(ids) => update("escalationSpecificUserIds", ids)}
                />
              ) : null}

              {form.escalationStrategy === "role_based" ? (
                <RoleChecklist
                  selected={form.escalationRoleBased}
                  onToggle={(r) => toggleRole(r, false)}
                />
              ) : null}

              {form.escalationStrategy === "mentioned_in_payload" ? (
                <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
                  Falls back to whoever the original event tagged as
                  mentioned. Same runtime lookup as the primary
                  strategy — no extra configuration.
                </div>
              ) : null}

              {form.escalationStrategy === "formula" ? (
                <label>
                  <div className="aur-label">Fallback relationship</div>
                  <select
                    className="aur-input"
                    value={form.escalationFormulaKind}
                    onChange={(e) =>
                      update(
                        "escalationFormulaKind",
                        e.target.value as (typeof FORMULA_KINDS)[number],
                      )
                    }
                  >
                    {FORMULA_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {FORMULA_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Status" className="xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => update("active", e.target.checked)}
            />
            <span className="font-mono text-[12px]">
              {form.active ? "Active — rule will fire on matching events" : "Inactive — rule is stored but doesn't fire"}
            </span>
          </label>
          {mode === "edit" && ruleId ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                onClick={onTestSend}
                disabled={pending || !form.active}
                title={
                  form.active
                    ? "Send a sample notification to verify recipients + channels"
                    : "Activate the rule first to enable test send"
                }
              >
                Test send
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                onClick={onToggleActive}
                disabled={pending}
              >
                {form.active ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px] border-rose/40 text-rose"
                onClick={onDelete}
                disabled={pending}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </Panel>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose xl:col-span-2">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald-300 xl:col-span-2">
          ✓ {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
        <button
          type="button"
          className="aur-btn aur-btn-primary"
          onClick={onSubmit}
          disabled={pending}
        >
          {pending ? "Saving…" : mode === "create" ? "Create rule" : "Save changes"}
        </button>
        <Link href="/notifications/rules" className="aur-btn aur-btn-ghost">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function UserPicker({
  label,
  selected,
  users,
  onChange,
}: {
  label: string;
  selected: string[];
  users: OrgUserOption[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  return (
    <div>
      <div className="aur-label">{label}</div>
      {users.length === 0 ? (
        <div className="font-mono text-[11px] text-muted">
          No active members yet.
        </div>
      ) : (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-white/10 bg-white/[0.02] p-2">
          {users.map((u) => {
            const active = selected.includes(u.id);
            return (
              <button
                type="button"
                key={u.id}
                onClick={() => toggle(u.id)}
                className={`flex items-center justify-between rounded px-2 py-1 text-left font-mono text-[11px] transition-colors ${
                  active
                    ? "bg-teal-400/10 text-text"
                    : "text-muted hover:bg-white/[0.04]"
                }`}
              >
                <span>{u.name ?? u.email}</span>
                <span className="text-[10px] text-subtle">{u.email}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleChecklist({
  selected,
  onToggle,
}: {
  selected: Role[];
  onToggle: (r: Role) => void;
}) {
  return (
    <div>
      <div className="aur-label">Roles</div>
      <div className="flex flex-wrap gap-2">
        {ROLE_OPTIONS.map((r) => {
          const active = selected.includes(r);
          return (
            <button
              type="button"
              key={r}
              onClick={() => onToggle(r)}
              className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
}
