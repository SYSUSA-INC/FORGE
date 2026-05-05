"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  exportAuditLogCsvAction,
  type AuditFilter,
  type AuditQueryResult,
} from "./actions";

const RESOURCE_PRESETS = [
  { value: "", label: "All resources" },
  { value: "opportunity", label: "Opportunities" },
  { value: "proposal", label: "Proposals" },
  { value: "solicitation", label: "Solicitations" },
  { value: "knowledge", label: "Knowledge" },
  { value: "user", label: "Users" },
  { value: "settings", label: "Settings" },
  { value: "template", label: "Templates" },
  { value: "company", label: "Companies" },
  { value: "source_request", label: "Source requests" },
  { value: "notification", label: "Notifications" },
];

export function AuditLogClient({
  initialResult,
  actors,
  initialFilter,
}: {
  initialResult: AuditQueryResult;
  actors: { id: string; name: string | null; email: string }[];
  initialFilter: AuditFilter;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [query, setQuery] = useState(initialFilter.query ?? "");
  const [actorUserId, setActorUserId] = useState(
    initialFilter.actorUserId ?? "",
  );
  const [resourceType, setResourceType] = useState(
    initialFilter.resourceType ?? "",
  );
  const [fromDate, setFromDate] = useState(initialFilter.fromDate ?? "");
  const [toDate, setToDate] = useState(initialFilter.toDate ?? "");

  function applyFilters() {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (actorUserId) next.set("actor", actorUserId);
    if (resourceType) next.set("resource", resourceType);
    if (fromDate) next.set("from", fromDate);
    if (toDate) next.set("to", toDate);
    next.set("page", "1");
    startTransition(() => {
      router.push(`/audit-log?${next.toString()}`);
    });
  }

  function clearFilters() {
    setQuery("");
    setActorUserId("");
    setResourceType("");
    setFromDate("");
    setToDate("");
    startTransition(() => {
      router.push(`/audit-log`);
    });
  }

  function gotoPage(page: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("page", String(page));
    startTransition(() => {
      router.push(`/audit-log?${next.toString()}`);
    });
  }

  function exportCsv() {
    setExportError(null);
    startExport(async () => {
      const res = await exportAuditLogCsvAction({
        query: query.trim() || undefined,
        actorUserId: actorUserId || undefined,
        resourceType: resourceType || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      if (!res.ok) {
        setExportError(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  const totalPages = Math.max(
    1,
    Math.ceil(initialResult.total / initialResult.pageSize),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-end">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Search
          </span>
          <input
            className="aur-input"
            placeholder="action / resource id / actor email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Actor
          </span>
          <select
            className="aur-input"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
          >
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Resource
          </span>
          <select
            className="aur-input"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
          >
            {RESOURCE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            From
          </span>
          <input
            type="date"
            className="aur-input"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            To
          </span>
          <input
            type="date"
            className="aur-input"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={applyFilters}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
        >
          {pending ? "Applying…" : "Apply filters"}
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="aur-btn aur-btn-ghost text-[12px]"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="aur-btn aur-btn-ghost text-[12px] disabled:opacity-60"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {exportError ? (
          <span className="font-mono text-[11px] text-rose">{exportError}</span>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-white/10 bg-white/[0.02]">
        <table className="w-full min-w-[800px] text-left">
          <thead className="border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            <tr>
              <th className="px-3 py-2 font-normal">Time</th>
              <th className="px-3 py-2 font-normal">Actor</th>
              <th className="px-3 py-2 font-normal">Action</th>
              <th className="px-3 py-2 font-normal">Resource</th>
              <th className="px-3 py-2 font-normal" aria-label="Detail" />
            </tr>
          </thead>
          <tbody>
            {initialResult.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center font-mono text-[11px] text-muted"
                >
                  No audit events match the current filters.
                </td>
              </tr>
            ) : (
              initialResult.rows.map((r) => {
                const expanded = expandedId === r.id;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-white/5 align-top last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-body text-[12px] text-text">
                      {r.actorName ?? r.actorEmail ?? "(deleted)"}
                      {r.actorEmail && r.actorName ? (
                        <div className="font-mono text-[10px] text-subtle">
                          {r.actorEmail}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-cobalt">
                      {r.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text">
                      {r.resourceType ? (
                        <span className="text-muted">{r.resourceType}</span>
                      ) : null}
                      {r.resourceId ? (
                        <span className="ml-1 text-subtle">
                          {r.resourceId.slice(0, 12)}
                          {r.resourceId.length > 12 ? "…" : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((cur) => (cur === r.id ? null : r.id))
                        }
                        className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
                      >
                        {expanded ? "Hide" : "Detail"}
                      </button>
                      {expanded ? (
                        <div className="mt-2 rounded border border-white/10 bg-canvas px-3 py-2 text-left">
                          <div className="grid grid-cols-1 gap-2 font-mono text-[11px] md:grid-cols-2">
                            <Row label="resource id" value={r.resourceId} />
                            <Row label="ip" value={r.ip} />
                            <Row
                              label="user-agent"
                              value={r.userAgent.slice(0, 200)}
                            />
                          </div>
                          <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-subtle">
                            metadata
                          </div>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[10px] text-text">
                            {Object.keys(r.metadata).length === 0
                              ? "(empty)"
                              : JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between font-mono text-[11px]">
          <button
            type="button"
            onClick={() => gotoPage(initialResult.page - 1)}
            disabled={initialResult.page <= 1 || pending}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
          >
            ← Previous
          </button>
          <span className="text-muted">
            Page {initialResult.page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => gotoPage(initialResult.page + 1)}
            disabled={initialResult.page >= totalPages || pending}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-subtle">{label}:</span>
      <span className="min-w-0 flex-1 truncate text-text">{value}</span>
    </div>
  );
}
