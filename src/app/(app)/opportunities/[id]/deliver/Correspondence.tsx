"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { replyTypeLabel } from "@/lib/correspondence-logic";
import { SUBMISSION_METHOD_LABELS } from "@/lib/deliver-logic";
import type { DeliverView } from "@/lib/deliver-store";
import { readReplyAction } from "./actions";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

type Entry =
  | { at: string; kind: "sent"; submission: DeliverView["submissions"][number] }
  | { at: string; kind: "reply"; reply: DeliverView["replies"][number] };

/**
 * BL-NAV-LIFECYCLE 6c (FORGE II S-4) — the Deliver tab's Correspondence
 * list: what went out and what came back to the opportunity's own
 * address, in order. A reply shows who sent it, what FORGE reads it as
 * and two lines of it; Open reads the full text (an audited read) and
 * its attachments download from there. A reply is information only:
 * nothing on it changes the opportunity.
 */
export function Correspondence({ view }: { view: DeliverView }) {
  const [open, setOpen] = useState<Record<string, { text: string; truncated: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const entries: Entry[] = [
    ...view.submissions.filter((s) => s.sentAt).map((s) => ({ at: s.sentAt as string, kind: "sent" as const, submission: s })),
    ...view.replies.map((r) => ({ at: r.receivedAt, kind: "reply" as const, reply: r })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  function read(emailId: string) {
    setError(null);
    start(async () => {
      const res = await readReplyAction({ opportunityId: view.opportunityId, emailId });
      if (!res.ok) return setError(res.error);
      setOpen((o) => ({ ...o, [emailId]: { text: res.text, truncated: res.truncated } }));
    });
  }

  return (
    <Panel title="Correspondence" eyebrow={view.replies.length === 0 ? "No replies yet" : `${view.replies.length} repl${view.replies.length === 1 ? "y" : "ies"}`}>
      {view.replies.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          Replies to a proposal sent from FORGE come back to this opportunity and are listed here: an acknowledgement, a question, an out-of-office notice, a message that could not be delivered.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-layer/10">
          {entries.map((e) =>
            e.kind === "sent" ? (
              <li key={`s-${e.submission.id}`} className="flex flex-col gap-1 py-3">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted">Sent · {when(e.at)}</span>
                <span className="font-body text-[13px] text-text">{e.submission.subject || SUBMISSION_METHOD_LABELS[e.submission.method]}</span>
                <span className="font-mono text-[11px] text-muted">
                  {e.submission.sentBy}
                  {e.submission.recipients.length > 0 ? ` to ${e.submission.recipients.join(", ")}` : ""}
                </span>
              </li>
            ) : (
              <li key={`r-${e.reply.id}`} className="flex flex-col gap-1 py-3">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                  Received · {when(e.at)} · <span className="text-cobalt">{e.reply.read ? replyTypeLabel(e.reply.type) : "Being read"}</span>
                </span>
                <span className="font-body text-[13px] text-text">{e.reply.subject || "(no subject)"}</span>
                <span className="font-mono text-[11px] text-muted">
                  From {e.reply.fromName ? `${e.reply.fromName} <${e.reply.fromAddress}>` : e.reply.fromAddress}
                </span>
                {e.reply.checkSender ? (
                  <span className="font-body text-[13px] text-brass">
                    Check the sender: this address is not one the proposal was sent to, or its mail system did not vouch for the message. Confirm it another way before acting on it.
                  </span>
                ) : null}
                {e.reply.summary ? <span className="font-body text-[13px] leading-[1.5] text-muted">{e.reply.summary}</span> : null}
                {open[e.reply.id] ? (
                  <>
                    <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words border-l border-layer/10 pl-3 font-body text-[13px] leading-[1.5] text-text">{open[e.reply.id]!.text || "This message has no text."}</pre>
                    {open[e.reply.id]!.truncated ? <span className="font-body text-[13px] text-muted">The message is longer than FORGE shows here.</span> : null}
                  </>
                ) : null}
                {e.reply.attachments.map((a, i) => (
                  <span key={`${i}-${a.name}`} className="font-mono text-[11px] text-muted">
                    <a href={`/api/opportunities/${view.opportunityId}/correspondence/${e.reply.id}/file?i=${i}`} className="text-cobalt underline-offset-2 hover:underline">{a.name}</a> · {kb(a.size)}
                  </span>
                ))}
                {open[e.reply.id] ? null : (
                  <button type="button" className="aur-btn aur-btn-ghost mt-1 self-start" disabled={pending} onClick={() => read(e.reply.id)}>
                    Open
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {error ? <p role="alert" className="mt-3 font-body text-[13px] text-red">{error}</p> : null}
    </Panel>
  );
}
