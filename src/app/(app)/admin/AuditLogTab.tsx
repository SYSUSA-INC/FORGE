"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { AuditEvent, AuditEventKind } from "@/lib/admin-audit";

const KIND_LABELS: Record<AuditEventKind, string> = {
  org_created: "Org created",
  org_disabled: "Org disabled",
  user_created: "User created",
  user_disabled: "User disabled",
  opportunity_created: "Opportunity captured",
  opportunity_activity: "Opportunity activity",
  proposal_created: "Proposal created",
  proposal_updated: "Proposal updated",
};

const KIND_TONES: Record<AuditEventKind, string> = {
  org_created: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  org_disabled: "bg-rose/10 text-rose border-rose/30",
  user_created: "bg-teal-400/10 text-teal-300 border-teal-400/30",
  user_disabled: "bg-rose/10 text-rose border-rose/30",
  opportunity_created: "bg-violet-400/10 text-violet-300 border-violet-400/30",
  opportunity_activity: "bg-amber-400/10 text-amber-200 border-amber-400/30",
  proposal_created: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  proposal_updated: "bg-white/10 text-foreground border-white/20",
};

type Filter = "all" | AuditEventKind;

export function AuditLogTab({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () =>
      filter === "all" ? events : events.filter((e) => e.kind === filter),
    [events, filter],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: events.length };
    for (const e of events) map[e.kind] = (map[e.kind] ?? 0) + 1;
    return map;
  }, [events]);

  const kinds = (Object.keys(KIND_LABELS) as AuditEventKind[]).filter(
    (k) => (counts[k] ?? 0) > 0,
  );

  return (
    <Panel
      title="Audit log"
      eyebrow={`${events.length} most recent platform events`}
    >
      <p className="font-body text-[13px] leading-relaxed text-muted">
        Cross-org timeline of platform-level events. Read-only, sourced from
        existing tables: organization + user creations and disablements,
        opportunity activities (including stage changes), and proposal
        updates. The most recent 80 events are surfaced here, capped at 25
        per category.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={`All · ${counts.all ?? 0}`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {kinds.map((k) => (
          <FilterChip
            key={k}
            label={`${KIND_LABELS[k]} · ${counts[k] ?? 0}`}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 font-mono text-[12px] text-muted">
          No events match the current filter.
        </div>
      ) : (
        <ul className="mt-4 space-y-1">
          {visible.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-3 border-b border-white/5 px-1 py-2 last:border-b-0"
            >
              <span
                className={`aur-pill shrink-0 ${KIND_TONES[e.kind]}`}
                title={KIND_LABELS[e.kind]}
              >
                {KIND_LABELS[e.kind]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-body text-[13px] text-foreground">
                  {e.title}
                </div>
                <div className="font-mono text-[11px] text-muted truncate">
                  {e.detail}
                </div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-subtle">
                  {e.organizationName !== "—"
                    ? `${e.organizationName} · `
                    : ""}
                  {e.actorName !== "—" ? `${e.actorName} · ` : ""}
                  {new Date(e.at).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-teal-400/50 bg-teal-400/15 text-teal-200"
          : "border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
