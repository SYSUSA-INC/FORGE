"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type {
  AmendmentDiff,
  RequirementDiff,
  ScalarFieldDiff,
} from "@/lib/solicitation-amendment-diff";

const STATUS_TONE: Record<RequirementDiff["status"], { color: string; bg: string; border: string; label: string }> = {
  added: {
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.08)",
    border: "rgba(16, 185, 129, 0.30)",
    label: "ADDED",
  },
  removed: {
    color: "#f87171",
    bg: "rgba(248, 113, 113, 0.08)",
    border: "rgba(248, 113, 113, 0.30)",
    label: "REMOVED",
  },
  modified: {
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.08)",
    border: "rgba(251, 191, 36, 0.30)",
    label: "MODIFIED",
  },
  unchanged: {
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.06)",
    border: "rgba(148, 163, 184, 0.20)",
    label: "UNCHANGED",
  },
};

const FILTERS: { key: RequirementDiff["status"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "added", label: "Added" },
  { key: "removed", label: "Removed" },
  { key: "modified", label: "Modified" },
  { key: "unchanged", label: "Unchanged" },
];

export function DiffView({
  baseLabel,
  amendmentLabel,
  diff,
}: {
  baseLabel: string;
  amendmentLabel: string;
  diff: AmendmentDiff;
}) {
  const [filter, setFilter] = useState<RequirementDiff["status"] | "all">("all");

  const filteredReqs =
    filter === "all"
      ? diff.requirementChanges
      : diff.requirementChanges.filter((r) => r.status === filter);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary panel */}
      <Panel
        title="Summary"
        eyebrow={`${baseLabel} → ${amendmentLabel}`}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <SummaryCell
            label="Fields changed"
            value={diff.summary.fieldsChanged}
            tone={diff.summary.fieldsChanged > 0 ? "amber" : "muted"}
          />
          <SummaryCell
            label="Added"
            value={diff.summary.requirementsAdded}
            tone="emerald"
          />
          <SummaryCell
            label="Removed"
            value={diff.summary.requirementsRemoved}
            tone="rose"
          />
          <SummaryCell
            label="Modified"
            value={diff.summary.requirementsModified}
            tone="amber"
          />
          <SummaryCell
            label="Unchanged"
            value={diff.summary.requirementsUnchanged}
            tone="muted"
          />
        </div>
      </Panel>

      {/* Field-level diff */}
      <Panel
        title="Top-level fields"
        eyebrow={`${diff.summary.fieldsChanged} of ${diff.fieldChanges.length} changed`}
      >
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-widest text-subtle">
              <th className="py-2 pr-3">Field</th>
              <th className="py-2 pr-3">Before</th>
              <th className="py-2 pr-3">After</th>
              <th className="py-2 pr-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {diff.fieldChanges.map((f) => (
              <FieldRow key={f.field} field={f} />
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Requirements diff */}
      <Panel
        title="Requirements"
        eyebrow={`${filteredReqs.length} of ${diff.requirementChanges.length} shown`}
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const tone = f.key !== "all" ? STATUS_TONE[f.key] : null;
            const count =
              f.key === "all"
                ? diff.requirementChanges.length
                : diff.requirementChanges.filter((r) => r.status === f.key).length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-teal/15 text-teal"
                    : "text-muted hover:text-text"
                }`}
                style={
                  active && tone
                    ? {
                        background: tone.bg,
                        color: tone.color,
                        border: `1px solid ${tone.border}`,
                      }
                    : undefined
                }
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        {filteredReqs.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No requirements match this filter.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredReqs.map((r, i) => (
              <RequirementRow key={i} req={r} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "amber" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "#34d399"
      : tone === "rose"
        ? "#f87171"
        : tone === "amber"
          ? "#fbbf24"
          : "#94a3b8";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-subtle">
        {label}
      </div>
      <div
        className="mt-1 font-display text-xl font-semibold tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function FieldRow({ field }: { field: ScalarFieldDiff }) {
  const isChange = field.status === "modified";
  return (
    <tr className="border-b border-white/5 last:border-b-0">
      <td className="py-2 pr-3 font-mono text-[11px] uppercase tracking-widest text-subtle">
        {field.label}
      </td>
      <td
        className={`py-2 pr-3 font-body text-text ${
          isChange ? "bg-rose/[0.05] text-rose/90 line-through decoration-rose/40" : ""
        }`}
      >
        {field.before || <span className="text-subtle italic">—</span>}
      </td>
      <td
        className={`py-2 pr-3 font-body text-text ${
          isChange ? "bg-emerald/[0.06] text-emerald" : ""
        }`}
      >
        {field.after || <span className="text-subtle italic">—</span>}
      </td>
      <td className="py-2 pr-3 text-right">
        {isChange ? (
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{
              color: "#fbbf24",
              background: "rgba(251, 191, 36, 0.08)",
              border: "1px solid rgba(251, 191, 36, 0.30)",
            }}
          >
            CHANGED
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-subtle">
            unchanged
          </span>
        )}
      </td>
    </tr>
  );
}

function RequirementRow({ req }: { req: RequirementDiff }) {
  const tone = STATUS_TONE[req.status];

  if (req.status === "added") {
    const r = req.after!;
    return (
      <li
        className="rounded-md border px-3 py-2"
        style={{ background: tone.bg, borderColor: tone.border }}
      >
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {tone.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-body text-[12px] text-foreground">{r.text}</div>
            <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted">
              <span>{r.kind.toUpperCase()}</span>
              {r.ref ? <span>{r.ref}</span> : null}
            </div>
          </div>
        </div>
      </li>
    );
  }

  if (req.status === "removed") {
    const r = req.before!;
    return (
      <li
        className="rounded-md border px-3 py-2"
        style={{ background: tone.bg, borderColor: tone.border }}
      >
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {tone.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-body text-[12px] text-foreground/80 line-through decoration-rose/50">
              {r.text}
            </div>
            <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted">
              <span>{r.kind.toUpperCase()}</span>
              {r.ref ? <span>{r.ref}</span> : null}
            </div>
          </div>
        </div>
      </li>
    );
  }

  if (req.status === "modified") {
    const before = req.before!;
    const after = req.after!;
    return (
      <li
        className="rounded-md border px-3 py-2"
        style={{ background: tone.bg, borderColor: tone.border }}
      >
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {tone.label}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="rounded border border-rose/30 bg-rose/[0.05] px-2 py-1.5">
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-rose/80">
                Before
              </div>
              <div className="font-body text-[12px] text-foreground/90">
                {before.text}
              </div>
              <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted">
                <span>{before.kind.toUpperCase()}</span>
                {before.ref ? <span>{before.ref}</span> : null}
              </div>
            </div>
            <div className="rounded border border-emerald/30 bg-emerald/[0.05] px-2 py-1.5">
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald/80">
                After
              </div>
              <div className="font-body text-[12px] text-foreground">
                {after.text}
              </div>
              <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-muted">
                <span>{after.kind.toUpperCase()}</span>
                {after.ref ? <span>{after.ref}</span> : null}
                <span className="ml-auto text-subtle">
                  sim {Math.round(req.similarity * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </li>
    );
  }

  // unchanged
  const r = req.after ?? req.before!;
  return (
    <li
      className="rounded-md border px-3 py-2"
      style={{ background: tone.bg, borderColor: tone.border }}
    >
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: tone.color, border: `1px solid ${tone.border}` }}
        >
          {tone.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-body text-[12px] text-muted">{r.text}</div>
          <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-subtle">
            <span>{r.kind.toUpperCase()}</span>
            {r.ref ? <span>{r.ref}</span> : null}
          </div>
        </div>
      </div>
    </li>
  );
}
