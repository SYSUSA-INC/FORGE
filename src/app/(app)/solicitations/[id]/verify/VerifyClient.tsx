"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewAction } from "@/lib/requirement-review";
import {
  addRequirementAction,
  confirmVerbatimRequirementsAction,
  reviewRequirementAction,
  undoRequirementReviewAction,
} from "../verify-actions";

type Kind = "shall" | "should" | "may";

export type VerifyItem = {
  docKey: string;
  originalKey: string;
  kind: Kind;
  text: string;
  ref: string;
  /** What intake extracted, when a person edited or rejected it. */
  original: { kind: Kind; text: string; ref: string } | null;
  status: ReviewAction | null;
  quote: "exact" | "partial" | "none" | null;
  where: string;
  snippet: string;
  docName: string;
};

type Filter = "todo" | "all" | "rejected";

const QUOTE_LABEL: Record<"exact" | "partial" | "none", string> = {
  exact: "word for word",
  partial: "in part",
  none: "not found in source",
};

const STATUS_LABEL: Record<ReviewAction, string> = {
  confirmed: "confirmed",
  edited: "edited",
  rejected: "rejected",
  added: "added",
};

/**
 * BL-AIX Phase 2c — the verify list. Requirements that most need a
 * person come first (not found in the source, then found only in part);
 * each shows the document text around it so the check is quick.
 */
export function VerifyClient({ solicitationId, items, verbatimToConfirm }: { solicitationId: string; items: VerifyItem[]; verbatimToConfirm: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>("todo");
  const [note, setNote] = useState<string | null>(null);

  const run: Run = (fn, done, onSuccess) => {
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setNote(res.error ?? "That didn't work.");
      else {
        const message = typeof done === "function" ? done(res) : done;
        if (message) setNote(message);
        onSuccess?.();
        router.refresh();
      }
    });
  };

  const shown = items.filter((i) => (filter === "all" ? true : filter === "rejected" ? i.status === "rejected" : i.status === null));
  const todo = items.filter((i) => i.status === null).length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
        {(
          [
            ["todo", `To review (${todo})`],
            ["all", `All (${items.length})`],
            ["rejected", `Rejected (${rejected})`],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`aur-btn text-[11px] ${filter === f ? "aur-btn-primary" : "aur-btn-ghost"}`}
          >
            {label}
          </button>
        ))}
        {verbatimToConfirm > 0 ? (
          <button
            type="button"
            disabled={pending}
            className="aur-btn aur-btn-ghost ml-auto text-[11px] disabled:opacity-60"
            onClick={() =>
              run(
                () => confirmVerbatimRequirementsAction(solicitationId),
                (res) => `Confirmed ${res.confirmed ?? 0} found word for word.`,
              )
            }
            title="Confirm every requirement not yet reviewed that the document states word for word"
          >
            Confirm all found word for word ({verbatimToConfirm})
          </button>
        ) : null}
      </div>
      {note ? <p className="font-mono text-[11px] text-text">{note}</p> : null}

      {shown.length === 0 ? (
        <p className="font-body text-[13px] text-muted">{filter === "todo" ? "Nothing left to review." : "None."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item, i) => (
            // A scanned document can list the same clause twice: the index keeps keys unique.
            <Row key={`${item.docKey}:${item.originalKey}:${i}`} item={item} pending={pending} solicitationId={solicitationId} run={run} />
          ))}
        </ul>
      )}

      <AddForm solicitationId={solicitationId} pending={pending} run={run} />
    </div>
  );
}

type ActionResult = { ok: boolean; error?: string; confirmed?: number };
type Run = (fn: () => Promise<ActionResult>, done?: string | ((res: ActionResult) => string), onSuccess?: () => void) => void;

function Row({ item, pending, solicitationId, run }: { item: VerifyItem; pending: boolean; solicitationId: string; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<Kind>(item.kind);
  const [text, setText] = useState(item.text);
  const [ref, setRef] = useState(item.ref);
  const ids = { solicitationId, docKey: item.docKey, originalKey: item.originalKey };

  return (
    <li className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
        <span className="text-subtle">{item.kind}</span>
        {item.ref ? <span className="text-subtle">{item.ref}</span> : null}
        {item.where ? <span className="normal-case tracking-normal text-subtle">{item.where}</span> : null}
        {item.docName ? <span className="normal-case tracking-normal text-muted">{item.docName}</span> : null}
        {item.quote && item.status === null ? (
          <span className={item.quote === "none" ? "text-gold" : item.quote === "partial" ? "text-amber-200" : "text-emerald"}>{QUOTE_LABEL[item.quote]}</span>
        ) : null}
        {item.status ? <span className={item.status === "rejected" ? "text-rose" : "text-emerald"}>{STATUS_LABEL[item.status]}</span> : null}
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="aur-input font-body text-[13px]" aria-label="Requirement text" />
          <div className="flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="aur-input text-[12px]" aria-label="Kind">
              <option value="shall">shall</option>
              <option value="should">should</option>
              <option value="may">may</option>
            </select>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference (e.g. L.5.2)" className="aur-input w-40 text-[12px]" aria-label="Reference" />
            <button
              type="button"
              disabled={pending}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              onClick={() => {
                setEditing(false);
                run(() => reviewRequirementAction({ ...ids, action: "edited", corrected: { kind, text, ref } }));
              }}
            >
              Save
            </button>
            <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={`mt-1 font-body text-[13px] leading-relaxed ${item.status === "rejected" ? "text-muted line-through" : "text-text"}`}>{item.text}</p>
      )}
      {item.original && item.status === "edited" ? (
        <p className="mt-0.5 font-body text-[12px] text-muted">
          Extracted as: <span className="line-through">{item.original.text}</span>
        </p>
      ) : null}
      {item.snippet ? (
        <p className="mt-1.5 rounded border border-layer/10 bg-layer/[0.03] px-2 py-1 font-mono text-[11px] leading-relaxed text-muted" title="The document text around this requirement">
          {item.snippet}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {item.status === null ? (
          <>
            <button type="button" disabled={pending} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" onClick={() => run(() => reviewRequirementAction({ ...ids, action: "confirmed" }))}>
              Confirm
            </button>
            <button
              type="button"
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
              onClick={() => {
                // Start from the requirement as it is now, not as it was when the row first rendered.
                setKind(item.kind);
                setText(item.text);
                setRef(item.ref);
                setEditing(true);
              }}
            >
              Edit
            </button>
            <button type="button" disabled={pending} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" onClick={() => run(() => reviewRequirementAction({ ...ids, action: "rejected" }))}>
              Reject
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" onClick={() => run(() => undoRequirementReviewAction(ids))}>
            {item.status === "added" ? "Remove" : "Undo"}
          </button>
        )}
      </div>
    </li>
  );
}

function AddForm({ solicitationId, pending, run }: { solicitationId: string; pending: boolean; run: Run }) {
  const [kind, setKind] = useState<Kind>("shall");
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-layer/20 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">Add a requirement the extraction missed</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Quote the clause from the document" className="aur-input font-body text-[13px]" aria-label="New requirement text" />
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="aur-input text-[12px]" aria-label="Kind">
          <option value="shall">shall</option>
          <option value="should">should</option>
          <option value="may">may</option>
        </select>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference" className="aur-input w-40 text-[12px]" aria-label="Reference" />
        <button
          type="button"
          disabled={pending || !text.trim()}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          onClick={() =>
            run(() => addRequirementAction({ solicitationId, kind, text, ref }), "Requirement added.", () => {
              setText("");
              setRef("");
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  );
}
