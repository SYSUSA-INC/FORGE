"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  createSourceRequestAction,
  type TenantSourceRequest,
} from "./actions";
import type { OpportunitySourceRequestStatus } from "@/db/schema";

const STATUS_TONES: Record<OpportunitySourceRequestStatus, string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  under_review:
    "border-teal-400/40 bg-teal-400/10 text-teal-300",
  shipped:
    "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose/40 bg-rose/10 text-rose",
};

const STATUS_LABELS: Record<OpportunitySourceRequestStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  shipped: "Shipped",
  rejected: "Won't build",
};

/**
 * Customer-facing panel for the Add Source flow. Shows:
 *   - A collapsible "Don't see your source?" form
 *   - The org's own previously-submitted requests with current status
 *
 * Submissions go into the platform-wide queue that super-admin
 * triages from /admin/source-requests. Status changes there
 * propagate back here on the next nav.
 */
export function SourceRequestPanel({
  initialOwnRequests,
}: {
  initialOwnRequests: TenantSourceRequest[];
}) {
  const [open, setOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [description, setDescription] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedJustNow, setSubmittedJustNow] = useState(false);
  const [pending, startTransition] = useTransition();
  const [own, setOwn] = useState(initialOwnRequests);

  function submit() {
    setError(null);
    setSubmittedJustNow(false);
    startTransition(async () => {
      const res = await createSourceRequestAction({
        sourceName,
        description,
        sampleText,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Optimistic prepend so the user sees their submission
      // immediately without a full refetch.
      const now = new Date().toISOString();
      setOwn((prev) => [
        {
          id: res.id,
          sourceName: sourceName.trim(),
          description: description.trim(),
          sampleText: sampleText.trim(),
          status: "pending",
          platformNotes: "",
          createdAt: now,
          statusChangedAt: null,
        },
        ...prev,
      ]);
      setSourceName("");
      setDescription("");
      setSampleText("");
      setSubmittedJustNow(true);
      setOpen(false);
    });
  }

  return (
    <Panel
      title="Don't see your source?"
      eyebrow="Tell us what to add"
      actions={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="aur-btn aur-btn-ghost text-[11px]"
        >
          {open ? "Cancel" : "+ Suggest a source"}
        </button>
      }
    >
      <p className="font-body text-[13px] leading-relaxed text-muted">
        FORGE supports SAM.gov, eBuy, and forwarded GSA emails today. If your
        team gets opportunities from somewhere else — a state procurement
        portal, GovWin, agency-specific feeds, etc. — let us know. We use
        these requests to shape what we build next.
      </p>

      {open ? (
        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Source name" required>
            <input
              className="aur-input"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. Texas SmartBuy, FedBizOpps RSS, GovWin notifications"
              maxLength={128}
            />
          </Field>
          <Field label="Description" required>
            <textarea
              className="aur-input min-h-[80px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is it, who uses it, how do you receive notices today?"
              maxLength={2000}
            />
          </Field>
          <Field label="Sample paste (optional)">
            <textarea
              className="aur-input min-h-[100px] resize-y font-mono text-[12px]"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Paste a real example — an email body, a notice text, etc. — so we can prototype against something real."
              maxLength={10_000}
            />
          </Field>
          {error ? (
            <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !sourceName.trim() || !description.trim()}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            >
              {pending ? "Submitting…" : "Submit"}
            </button>
          </div>
        </div>
      ) : null}

      {submittedJustNow ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald-300">
          Submitted. We'll triage and update the status here.
        </div>
      ) : null}

      {own.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Your previous requests
          </div>
          <ul className="flex flex-col gap-1.5">
            {own.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-[13px] text-text">
                      {r.sourceName}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_TONES[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 font-body text-[12px] text-muted">
                    {r.description}
                  </div>
                  {r.platformNotes ? (
                    <div className="mt-1 rounded border border-white/10 bg-white/[0.02] px-2 py-1 font-mono text-[10px] leading-relaxed text-text">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-teal">
                        FORGE team:
                      </span>{" "}
                      {r.platformNotes}
                    </div>
                  ) : null}
                  <div className="mt-1 font-mono text-[10px] text-subtle">
                    Submitted {formatRelative(r.createdAt)}
                    {r.statusChangedAt
                      ? ` · status updated ${formatRelative(r.statusChangedAt)}`
                      : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
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
