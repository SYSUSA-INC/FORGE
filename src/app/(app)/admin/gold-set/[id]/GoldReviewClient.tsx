"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { GOLD_KIND_LABEL, GOLD_KINDS, type GoldKind, type TextHit } from "@/lib/gold-set-logic";
import {
  addGoldItemAction,
  appendGoldDocTextAction,
  decideGoldItemAction,
  deleteGoldDocAction,
  searchGoldDocTextAction,
  setGoldDocApprovedAction,
  updateGoldItemAction,
} from "../actions";

type Item = { id: string; kind: string; ref: string; text: string; value: string; position: number; origin: string; status: string };
type Draft = { kind: GoldKind; ref: string; text: string; value: string; position: number };

const STATUS_TONE: Record<string, string> = { proposed: "text-gold", approved: "text-emerald", rejected: "text-rose line-through" };
const VALUE_HINT: Record<GoldKind, string> = {
  requirement: "",
  page_limit: "Limit, e.g. 25 pages, 12 pt, 1-inch margins",
  eval_factor: "Relative importance, e.g. most important / equal / 40%",
};

/**
 * BL-AIX Phase 1e — the reviewer's screen: every annotation can be
 * approved, rejected, edited or put back; new ones can be added; the
 * document's text can be searched to check an annotation against the RFP.
 */
export function GoldReviewClient({
  docId,
  status,
  items,
  approveBlockedReason,
}: {
  docId: string;
  status: string;
  items: Item[];
  approveBlockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TextHit[] | null>(null);
  const [paste, setPaste] = useState({ name: "", text: "" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      after?.();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}

      <Panel
        title="Gold status"
        actions={
          <div className="flex gap-2">
            {status === "approved" ? (
              <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={() => run(() => setGoldDocApprovedAction({ docId, approved: false }))}>
                Reopen for review
              </button>
            ) : (
              <button
                type="button"
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
                disabled={pending || !!approveBlockedReason}
                title={approveBlockedReason ?? "Approve this document as gold."}
                onClick={() => run(() => setGoldDocApprovedAction({ docId, approved: true }))}
              >
                Approve as gold
              </button>
            )}
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px] text-rose"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete this document and all its annotations?")) run(() => deleteGoldDocAction(docId), () => router.push("/admin/gold-set"));
              }}
            >
              Delete
            </button>
          </div>
        }
      >
        <p className="font-mono text-[11px] text-muted">
          {status === "approved"
            ? "Approved: this document counts in extraction accuracy runs. Any change sends it back to review."
            : approveBlockedReason ?? "Every annotation is decided. Approve to make this document count in accuracy runs."}
        </p>
      </Panel>

      {GOLD_KINDS.map((kind) => (
        <KindPanel
          key={kind}
          kind={kind}
          items={items.filter((i) => i.kind === kind)}
          editing={editing}
          setEditing={setEditing}
          pending={pending}
          onDecide={(itemId, s) => run(() => decideGoldItemAction({ itemId, status: s }))}
          onSave={(itemId, d) => run(() => updateGoldItemAction({ itemId, ...d }), () => setEditing(null))}
          onAdd={(d) => run(() => addGoldItemAction({ docId, ...d }), () => setEditing(null))}
        />
      ))}

      <Panel title="Search the document" eyebrow="Check an annotation against the RFP text">
        <div className="flex gap-2">
          <input className="aur-input flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. shall not exceed" />
          <button
            type="button"
            className="aur-btn aur-btn-ghost text-[11px]"
            disabled={pending || query.trim().length < 3}
            onClick={() => startTransition(async () => setHits(await searchGoldDocTextAction({ docId, query })))}
          >
            Search
          </button>
        </div>
        {hits ? (
          <ul className="mt-2 flex flex-col gap-1.5 font-mono text-[11px] text-muted">
            {hits.length === 0 ? <li>No matches.</li> : hits.map((h) => <li key={h.at}>{h.snippet}</li>)}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Add an attachment's text" eyebrow="For a scanned or unreadable attachment">
        <div className="flex flex-col gap-2">
          <input className="aur-input" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} placeholder="Attachment name" />
          <textarea className="aur-input min-h-[100px] font-mono text-[11px]" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
          <div className="flex justify-end">
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px]"
              disabled={pending}
              onClick={() => run(() => appendGoldDocTextAction({ docId, ...paste }), () => setPaste({ name: "", text: "" }))}
            >
              Add text
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function KindPanel({
  kind,
  items,
  editing,
  setEditing,
  pending,
  onDecide,
  onSave,
  onAdd,
}: {
  kind: GoldKind;
  items: Item[];
  editing: string | null;
  setEditing: (id: string | null) => void;
  pending: boolean;
  onDecide: (itemId: string, status: string) => void;
  onSave: (itemId: string, d: Draft) => void;
  onAdd: (d: Draft) => void;
}) {
  const addKey = `new-${kind}`;
  const live = items.filter((i) => i.status !== "rejected").length;
  return (
    <Panel
      title={GOLD_KIND_LABEL[kind]}
      eyebrow={`${live} kept · ${items.filter((i) => i.status === "proposed").length} to review`}
      actions={
        <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={() => setEditing(editing === addKey ? null : addKey)}>
          Add
        </button>
      }
    >
      {editing === addKey ? <ItemForm kind={kind} pending={pending} onCancel={() => setEditing(null)} onSubmit={onAdd} /> : null}
      {items.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-layer/5">
          {items.map((i) =>
            editing === i.id ? (
              <li key={i.id} className="py-2">
                <ItemForm kind={kind} initial={i} pending={pending} onCancel={() => setEditing(null)} onSubmit={(d) => onSave(i.id, d)} />
              </li>
            ) : (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 flex-1 font-body text-[13px]">
                  <span className={STATUS_TONE[i.status] ?? "text-text"}>
                    {kind === "eval_factor" && i.position ? `${i.position}. ` : ""}
                    {i.ref ? <span className="font-mono text-[11px] text-muted">[{i.ref}] </span> : null}
                    {i.text}
                  </span>
                  {i.value ? <span className="ml-2 font-mono text-[11px] text-muted">· {i.value}</span> : null}
                  <span className="ml-2 font-mono text-[10px] text-subtle">{i.origin === "ai" ? "AI draft" : "expert"}</span>
                </div>
                <div className="flex gap-1">
                  {i.status !== "approved" ? (
                    <button type="button" className="aur-btn aur-btn-ghost text-[10px]" disabled={pending} onClick={() => onDecide(i.id, "approved")}>
                      Approve
                    </button>
                  ) : null}
                  {i.status !== "rejected" ? (
                    <button type="button" className="aur-btn aur-btn-ghost text-[10px]" disabled={pending} onClick={() => onDecide(i.id, "rejected")}>
                      Reject
                    </button>
                  ) : null}
                  {i.status !== "proposed" ? (
                    <button type="button" className="aur-btn aur-btn-ghost text-[10px]" disabled={pending} onClick={() => onDecide(i.id, "proposed")}>
                      Undo
                    </button>
                  ) : null}
                  <button type="button" className="aur-btn aur-btn-ghost text-[10px]" disabled={pending} onClick={() => setEditing(i.id)}>
                    Edit
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

function ItemForm({
  kind,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  kind: GoldKind;
  initial?: Item;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>({
    kind,
    ref: initial?.ref ?? "",
    text: initial?.text ?? "",
    value: initial?.value ?? "",
    position: initial?.position ?? 0,
  });
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-md border border-layer/10 p-2">
      <div className="flex gap-2">
        <input className="aur-input w-32" value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} placeholder="Ref, e.g. L.5.2" />
        {kind === "eval_factor" ? (
          <input
            className="aur-input w-20"
            type="number"
            min={1}
            value={d.position || ""}
            onChange={(e) => setD({ ...d, position: Number(e.target.value) })}
            placeholder="Order"
          />
        ) : null}
        {kind !== "requirement" ? (
          <input className="aur-input flex-1" value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} placeholder={VALUE_HINT[kind]} />
        ) : null}
      </div>
      <textarea className="aur-input min-h-[60px]" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} placeholder="The text as the RFP states it" />
      <div className="flex justify-end gap-2">
        <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60" disabled={pending} onClick={() => onSubmit(d)}>
          {initial ? "Save (approves)" : "Add (approved)"}
        </button>
      </div>
    </div>
  );
}
