"use client";

import { useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  updateSourceRequestAction,
  type AdminSourceRequest,
} from "@/app/(app)/opportunities/import/source-requests/actions";
import type { OpportunitySourceRequestStatus } from "@/db/schema";

const STATUSES: OpportunitySourceRequestStatus[] = [
  "pending",
  "under_review",
  "shipped",
  "rejected",
];

const STATUS_LABELS: Record<OpportunitySourceRequestStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  shipped: "Shipped",
  rejected: "Won't build",
};

const STATUS_TONES: Record<OpportunitySourceRequestStatus, string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  under_review: "border-teal-400/40 bg-teal-400/10 text-teal-300",
  shipped: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose/40 bg-rose/10 text-rose",
};

type Filter = "all" | OpportunitySourceRequestStatus;

/**
 * Triage queue for the platform-admin source-request review flow.
 * Filterable by status, expandable per-row to read description +
 * sample text and edit status / notes inline.
 */
export function SourceRequestTriageClient({
  initialRequests,
}: {
  initialRequests: AdminSourceRequest[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const f = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!f) return true;
      return (
        r.sourceName.toLowerCase().includes(f) ||
        r.description.toLowerCase().includes(f) ||
        (r.organizationName ?? "").toLowerCase().includes(f) ||
        (r.requesterName ?? "").toLowerCase().includes(f) ||
        (r.requesterEmail ?? "").toLowerCase().includes(f)
      );
    });
  }, [requests, filter, search]);

  function applyLocalUpdate(
    id: string,
    patch: Partial<AdminSourceRequest>,
  ) {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            filter === "all"
              ? "border-teal-400 bg-teal-400/10 text-text"
              : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
          }`}
        >
          All {requests.length}
        </button>
        {STATUSES.map((s) => {
          const n = requests.filter((r) => r.status === s).length;
          if (n === 0 && filter !== s) return null;
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              {STATUS_LABELS[s]} · {n}
            </button>
          );
        })}
        <input
          className="aur-input ml-auto w-64 text-[12px]"
          placeholder="Search source, tenant, requester…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Panel
        title={
          filter === "all" ? "All source requests" : STATUS_LABELS[filter]
        }
        eyebrow={`${filtered.length} of ${requests.length}`}
      >
        {filtered.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            {requests.length === 0
              ? "No requests yet. They'll appear here as customers submit them from the import page."
              : "No requests match the current filter."}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                expanded={expandedId === r.id}
                onToggle={() =>
                  setExpandedId((cur) => (cur === r.id ? null : r.id))
                }
                onLocalUpdate={(patch) => applyLocalUpdate(r.id, patch)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function RequestRow({
  request,
  expanded,
  onToggle,
  onLocalUpdate,
}: {
  request: AdminSourceRequest;
  expanded: boolean;
  onToggle: () => void;
  onLocalUpdate: (patch: Partial<AdminSourceRequest>) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.platformNotes);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    status !== request.status || notes !== request.platformNotes;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateSourceRequestAction({
        id: request.id,
        status,
        platformNotes: notes,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLocalUpdate({
        status,
        platformNotes: notes,
        statusChangedAt:
          status !== request.status
            ? new Date().toISOString()
            : request.statusChangedAt,
      });
    });
  }

  return (
    <li className="rounded-md border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[14px] font-semibold text-text">
              {request.sourceName || "(untitled)"}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_TONES[request.status]}`}
            >
              {STATUS_LABELS[request.status]}
            </span>
          </div>
          <div className="mt-0.5 line-clamp-1 font-body text-[12px] text-muted">
            {request.description || "(no description)"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-subtle">
            <span>{request.organizationName ?? "(deleted org)"}</span>
            <span>·</span>
            <span>
              {request.requesterName ??
                request.requesterEmail ??
                "(deleted user)"}
            </span>
            <span>·</span>
            <span>submitted {formatRelative(request.createdAt)}</span>
            {request.statusChangedAt ? (
              <>
                <span>·</span>
                <span>
                  status updated {formatRelative(request.statusChangedAt)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <span
          aria-hidden
          className="shrink-0 font-mono text-[12px] text-muted"
        >
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-white/10 px-3 py-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Description
              </div>
              <div className="mt-1 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">
                {request.description || "—"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Sample paste
              </div>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-canvas px-2 py-1.5 font-mono text-[11px] text-text">
                {request.sampleText || "(none)"}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr]">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Status
              </span>
              <select
                className="aur-input"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as OpportunitySourceRequestStatus)
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Platform notes (visible to customer)
              </span>
              <textarea
                className="aur-input min-h-[60px] resize-y"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reply visible to the requesting tenant: e.g. 'Targeting Q3 release.'"
                maxLength={2000}
              />
            </label>
          </div>

          {error ? (
            <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}
