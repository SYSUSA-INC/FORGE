"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { describeQa } from "@/lib/solicitation-qa-logic";
import { addManualQaAction, pollSolicitationQaAction, type SolicitationQaView } from "./qa-actions";

/**
 * BL-FB-SOL-QA — the contracting officer's answers on this solicitation:
 * read from the SAM.gov notice's Q&A attachments on request (and daily),
 * or pasted in. Each answer names the requirements it refines.
 */
export function QaPanel({
  solicitationId,
  noticeId,
  qaCheckedAt,
  hasSamKey,
  initial,
}: {
  solicitationId: string;
  noticeId: string;
  qaCheckedAt: string | null;
  hasSamKey: boolean;
  initial: SolicitationQaView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = new Set(initial.flatMap((q) => q.affectedRefs));

  function poll() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await pollSolicitationQaAction(solicitationId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const notRead =
        res.skipped.length > 0
          ? ` ${res.skipped.length} attachment${res.skipped.length === 1 ? "" : "s"} not read${res.retrying > 0 ? ` (${res.retrying} will be retried)` : ""}: ${res.skipped[0]}`
          : "";
      setNotice(
        (res.added > 0
          ? `Checked SAM.gov: ${res.newDocuments} new document${res.newDocuments === 1 ? "" : "s"}, ${res.added} answer${res.added === 1 ? "" : "s"} added${res.flagged > 0 ? `, ${res.flagged} compliance row${res.flagged === 1 ? "" : "s"} flagged` : ""}.`
          : `Checked SAM.gov: nothing new${res.newDocuments > 0 ? ` (${res.newDocuments} new document${res.newDocuments === 1 ? "" : "s"}, none with Q&A)` : ""}.`) + notRead,
      );
      router.refresh();
    });
  }

  function addPasted() {
    if (!text.trim()) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await addManualQaAction(solicitationId, text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${res.added} answer${res.added === 1 ? "" : "s"} added${res.duplicates > 0 ? `, ${res.duplicates} already known` : ""}${res.flagged > 0 ? `, ${res.flagged} compliance row${res.flagged === 1 ? "" : "s"} flagged` : ""}.`);
      setText("");
      setPasteOpen(false);
      router.refresh();
    });
  }

  const pollTitle = !noticeId
    ? "This solicitation has no SAM.gov notice ID"
    : !hasSamKey
      ? "SAM.gov isn't connected in FORGE yet"
      : "Read the notice's new attachments and description for Q&A";

  return (
    <Panel
      title="Q&A from the contracting officer"
      eyebrow={`${describeQa(initial.length, refs.size)}${qaCheckedAt ? ` · SAM.gov checked ${qaCheckedAt.slice(0, 10)}` : noticeId ? " · not checked yet" : ""}`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={poll}
            disabled={pending || !noticeId || !hasSamKey}
            title={pollTitle}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check SAM.gov now"}
          </button>
          <button type="button" onClick={() => setPasteOpen((v) => !v)} className="aur-btn aur-btn-ghost text-[11px]">
            {pasteOpen ? "Cancel" : "Paste Q&A"}
          </button>
        </div>
      }
    >
      {pasteOpen ? (
        <div className="mb-3 rounded-md border border-teal/30 bg-teal/[0.04] p-3">
          <p className="font-body text-[12px] text-muted">
            Paste the Q&A as received (email, portal, PDF text). Lines such as <span className="font-mono">Q1:</span> / <span className="font-mono">A1:</span>,{" "}
            <span className="font-mono">Question:</span> / <span className="font-mono">Answer:</span> or <span className="font-mono">Government Response:</span> are recognised; answers
            are matched to the requirements they refine.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="aur-input mt-2 w-full resize-y font-mono text-[12px]"
            placeholder={"Q1: Does Section L.5.2.1 require resumes for all key personnel?\nA1: Only the program manager and technical lead."}
          />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={addPasted} disabled={pending || !text.trim()} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
              {pending ? "Adding…" : "Add answers"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">{notice}</div>
      ) : null}

      {initial.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          {noticeId
            ? "No answers yet. FORGE checks the notice daily; Check SAM.gov now reads it on demand."
            : "No answers yet. Add a SAM.gov notice ID to poll the notice, or paste the Q&A."}
        </p>
      ) : (
        <ul className="flex max-h-[480px] flex-col gap-2 overflow-y-auto">
          {initial.map((q) => (
            <li key={q.id} className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
              {q.question ? (
                <p className="font-body text-[12px] leading-relaxed text-muted">
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-widest text-subtle">Q{q.ordinal}</span>
                  {q.question}
                </p>
              ) : null}
              <p className="mt-0.5 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">{q.answer}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-subtle">
                <span>
                  {q.source === "attachment" ? `SAM.gov · ${q.sourceRef}` : q.source === "description" ? "SAM.gov · notice description" : `pasted${q.addedByName ? ` by ${q.addedByName}` : ""}`}
                </span>
                {q.postedAt ? <span>· {q.postedAt.slice(0, 10)}</span> : null}
                {q.affectedRefs.map((r) => (
                  <span key={r} className="rounded border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-amber-200" title="This answer refines the requirement">
                    refines {r}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
