"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { canAnswer, REPLY_NEXT_STEPS, replyTypeLabel, type ReplyType } from "@/lib/correspondence-logic";
import { SUBMISSION_METHOD_LABELS } from "@/lib/deliver-logic";
import type { DeliverView } from "@/lib/deliver-store";
import { fileReplyAttachmentAction, readReplyAction } from "./actions";
import { ReplyForm } from "./ReplyForm";

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
 * its attachments download from there; File as a document adds an
 * attachment to the opportunity's documents. What FORGE reads a reply
 * as is a suggestion: nothing on it changes the opportunity.
 */
export function Correspondence({ view }: { view: DeliverView }) {
  const [open, setOpen] = useState<Record<string, { text: string; truncated: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A submission is listed once it has left; an answer from the first moment, so one that did not leave is seen here.
  const entries: Entry[] = [
    ...view.submissions.filter((s) => s.sentAt || s.inReplyToEmailId).map((s) => ({ at: s.sentAt ?? s.createdAt, kind: "sent" as const, submission: s })),
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

  function file(emailId: string, index: number) {
    setError(null);
    setFiled(null);
    start(async () => {
      const res = await fileReplyAttachmentAction({ opportunityId: view.opportunityId, emailId, index });
      if (!res.ok) return setError(res.error);
      setFiled(`${res.fileName} is filed with this opportunity's documents and is being read.`);
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
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
                  {!e.submission.inReplyToEmailId ? "Sent" : e.submission.status === "sent" ? "Replied" : e.submission.status === "failed" ? "Reply not sent" : "Sending reply"} · {when(e.at)}
                </span>
                <span className="font-body text-[13px] text-text">{e.submission.subject || SUBMISSION_METHOD_LABELS[e.submission.method]}</span>
                <span className="font-mono text-[11px] text-muted">
                  {e.submission.sentBy}
                  {e.submission.recipients.length > 0 ? ` to ${e.submission.recipients.join(", ")}` : ""}
                  {e.submission.inReplyToEmailId && e.submission.cc.length > 0 ? ` · Cc ${e.submission.cc.join(", ")}` : ""}
                </span>
                {e.submission.inReplyToEmailId && e.submission.status === "failed" ? (
                  <span role="alert" className="font-body text-[13px] text-red">Not sent: {e.submission.error || "the mail service gave no reason"}. Nothing left FORGE; reply again.</span>
                ) : null}
                {e.submission.inReplyToEmailId
                  ? e.submission.files.map((f, i) => (
                      <span key={`${i}-${f.fileName}`} className="font-mono text-[11px] text-muted">
                        {f.kept ? <a href={`/api/opportunities/${view.opportunityId}/submissions/${e.submission.id}/file?i=${i}`} className="text-cobalt underline-offset-2 hover:underline">{f.fileName}</a> : f.fileName} · {kb(f.byteSize)}
                      </span>
                    ))
                  : null}
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
                {e.reply.date ? <span className="font-body text-[13px] text-text">Names a date: {new Date(`${e.reply.date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" })}</span> : null}
                <NextStep type={e.reply.type} opportunityId={view.opportunityId} />
                {open[e.reply.id] ? (
                  <>
                    <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words border-l border-layer/10 pl-3 font-body text-[13px] leading-[1.5] text-text">{open[e.reply.id]!.text || "This message has no text."}</pre>
                    {open[e.reply.id]!.truncated ? <span className="font-body text-[13px] text-muted">The message is longer than FORGE shows here.</span> : null}
                  </>
                ) : null}
                {e.reply.attachments.map((a, i) => (
                  <span key={`${i}-${a.name}`} className="font-mono text-[11px] text-muted">
                    <a href={`/api/opportunities/${view.opportunityId}/correspondence/${e.reply.id}/file?i=${i}`} className="text-cobalt underline-offset-2 hover:underline">{a.name}</a> · {kb(a.size)} ·{" "}
                    <button type="button" className="text-cobalt underline-offset-2 hover:underline disabled:opacity-50" disabled={pending} onClick={() => file(e.reply.id, i)}>
                      File as a document
                    </button>
                  </span>
                ))}
                {answering === e.reply.id ? (
                  <ReplyForm opportunityId={view.opportunityId} emailId={e.reply.id} to={e.reply.fromAddress} subject={e.reply.subject} senderEmail={view.send.senderEmail} onClose={() => setAnswering(null)} />
                ) : (
                  <span className="mt-1 flex flex-wrap gap-2">
                    {open[e.reply.id] ? null : (
                      <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => read(e.reply.id)}>
                        Open
                      </button>
                    )}
                    {view.canSubmit && view.send.configured && e.reply.read && canAnswer(e.reply.type) ? (
                      <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => setAnswering(e.reply.id)}>
                        Reply
                      </button>
                    ) : null}
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {error ? <p role="alert" className="mt-3 font-body text-[13px] text-red">{error}</p> : null}
      {filed ? <p role="status" className="mt-3 font-body text-[13px] text-green">{filed}</p> : null}
    </Panel>
  );
}

/** What FORGE suggests for a reply of this type. The reading may be wrong: it is advice, and the person acts. */
function NextStep({ type, opportunityId }: { type: string; opportunityId: string }) {
  const step = REPLY_NEXT_STEPS[type as ReplyType];
  if (!step) return null;
  return (
    <span className="font-body text-[13px] leading-[1.5] text-text">
      Suggested: {step.text}{" "}
      {step.outcome ? (
        <Link href={`/opportunities/${opportunityId}`} className="text-cobalt underline-offset-2 hover:underline">
          Record the outcome
        </Link>
      ) : null}
    </span>
  );
}
