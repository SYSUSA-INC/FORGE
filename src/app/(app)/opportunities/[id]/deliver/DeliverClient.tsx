"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { OVERRIDE_REASON_MIN, RECORD_METHODS, SIGNOFF_COLOR_LABELS, SUBMISSION_METHOD_LABELS, SUBMISSION_STATUS_LABELS, signoffLine, type ColourSignoff, type RecordMethod } from "@/lib/deliver-logic";
import type { DeliverView } from "@/lib/deliver-store";
import { recordSubmissionAction } from "./actions";
import { Correspondence } from "./Correspondence";
import { ReceiptUpload } from "./ReceiptUpload";
import { SendPanel } from "./SendPanel";

const STATE_TEXT: Record<ColourSignoff["state"], { label: string; tone: string }> = {
  signed_off: { label: "Signed off", tone: "text-green" },
  open: { label: "Open", tone: "text-brass" },
  not_run: { label: "Not run", tone: "text-muted" },
};

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

/** The value a datetime-local input takes for "now", in the browser's own zone. */
function localNow(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function DeliverClient({ view }: { view: DeliverView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [method, setMethod] = useState<RecordMethod>("own_email");
  const [sentAt, setSentAt] = useState(localNow);
  const [recipients, setRecipients] = useState("");
  const [note, setNote] = useState("");
  const [renderId, setRenderId] = useState(view.renders[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const { proposal, gate } = view;
  // A send runs in a job: look again while one is on its way.
  const sending = view.submissions.some((s) => s.status === "sending");
  // An answer to a reply is correspondence: it is listed there, not among the submissions.
  const submissions = view.submissions.filter((s) => !s.inReplyToEmailId);
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [sending, router]);

  if (!proposal || !gate) {
    return (
      <Panel title="Nothing to deliver yet" eyebrow="Deliver">
        <p className="font-body text-[13px] leading-[1.5] text-muted">This opportunity has no proposal. Create the draft on the Develop tab; the sign-off and the submission appear here.</p>
        <Link href={`/opportunities/${view.opportunityId}/develop`} className="aur-btn aur-btn-primary mt-4">Open Develop</Link>
      </Panel>
    );
  }

  const needsOverride = !gate.clear;
  const blocked = needsOverride && !view.canOverride;

  function record() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await recordSubmissionAction({
        opportunityId: view.opportunityId,
        method,
        sentAt: sentAt ? new Date(sentAt).toISOString() : "",
        recipients,
        note,
        renderId,
        overrideReason: needsOverride ? reason : undefined,
      });
      if (!res.ok) return setError(res.error);
      setDone(res.overridden ? "Submission recorded, with the sign-off override on the audit log." : "Submission recorded.");
      setRecipients("");
      setNote("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Sign-off" eyebrow={gate.clear ? "Ready to submit" : signoffLine(gate)}>
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          Every colour team signs off before the proposal is submitted: its newest round closed as a pass, and each assigned reviewer&apos;s own verdict in.
        </p>
        <ul className="mt-3 flex flex-col divide-y divide-layer/10 border-y border-layer/10">
          {gate.colors.map((c) => (
            <li key={c.color} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-body text-[13px] text-text">{SIGNOFF_COLOR_LABELS[c.color]}</span>
              <span className="font-mono text-[11px] text-muted">
                {c.reviewersTotal > 0 ? `${c.reviewersSigned} of ${c.reviewersTotal} reviewers · ` : ""}
                <span className={STATE_TEXT[c.state].tone}>{STATE_TEXT[c.state].label}</span>
              </span>
              {c.reason ? <span className="w-full font-body text-[12px] text-muted">{c.reason}</span> : null}
            </li>
          ))}
        </ul>
        <ul className="mt-3 flex flex-col gap-1 font-mono text-[11px] text-muted">
          <li>
            Submission pack (White Gloves checklist): <span className={gate.submissionPack ? "text-green" : "text-brass"}>{gate.submissionPack ? "ticked" : "not ticked"}</span>
          </li>
          <li>
            Export gate (compliance and citations): <span className={gate.exportClean ? "text-green" : "text-brass"}>{gate.exportClean ? "clean" : "not clean"}</span>
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/proposals/${proposal.id}/reviews`} className="aur-btn aur-btn-ghost">Reviews</Link>
          <Link href={`/proposals/${proposal.id}/compliance`} className="aur-btn aur-btn-ghost">Compliance</Link>
          <Link href={`/proposals/${proposal.id}`} className="aur-btn aur-btn-ghost">Proposal and Export</Link>
        </div>
      </Panel>

      <SendPanel view={view} />

      <Panel title="Record submission" eyebrow="Sent another way">
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          Download the final file, send it yourself (your own email, or the agency&apos;s portal), then record it here. FORGE keeps a copy of the file that was sent and marks the proposal and the opportunity as submitted.
        </p>
        {!view.canSubmit ? (
          <p className="mt-3 font-body text-[13px] text-muted">Only an org admin, the proposal manager or the capture manager can record a submission.</p>
        ) : view.renders.length === 0 ? (
          <div className="mt-3">
            <p className="font-body text-[13px] text-muted">There is no rendered file yet. Render the PDF or the Word file in the Export panel on the proposal&apos;s page first.</p>
            <Link href={`/proposals/${proposal.id}`} className="aur-btn aur-btn-primary mt-3">Open the proposal</Link>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="aur-label">The file that was submitted</span>
              <select className="aur-input" value={renderId} onChange={(e) => setRenderId(e.target.value)} disabled={pending}>
                {view.renders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.contentType.toUpperCase()} · {when(r.renderedAt)} · {mb(r.byteSize)}
                    {r.pageCount ? ` · ${r.pageCount} pages` : ""}
                  </option>
                ))}
              </select>
              {renderId ? (
                <a href={`/api/proposals/${proposal.id}/pdf/${renderId}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-cobalt">
                  Download this file
                </a>
              ) : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="aur-label">How it was submitted</span>
              <select className="aur-input" value={method} onChange={(e) => setMethod(e.target.value as RecordMethod)} disabled={pending}>
                {RECORD_METHODS.map((m) => (
                  <option key={m} value={m}>{SUBMISSION_METHOD_LABELS[m]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="aur-label">When</span>
              <input type="datetime-local" className="aur-input" value={sentAt} onChange={(e) => setSentAt(e.target.value)} disabled={pending} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="aur-label">Sent to{method === "own_email" ? "" : " (optional)"}</span>
              <input className="aur-input" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="contracting.officer@agency.gov, specialist@agency.gov" disabled={pending} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="aur-label">Note (optional)</span>
              <textarea className="aur-input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Confirmation number, the portal used, who pressed send" disabled={pending} />
            </label>
            {needsOverride ? (
              <div className="border-t border-layer/10 pt-3">
                <p className="font-body text-[13px] text-brass">Sign-off is not complete:</p>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 font-body text-[13px] text-text">
                  {gate.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                {view.canOverride ? (
                  <label className="mt-3 flex flex-col gap-1">
                    <span className="aur-label">Reason for submitting without full sign-off</span>
                    <textarea className="aur-input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kept on the submission and the audit log" disabled={pending} />
                  </label>
                ) : (
                  <p className="mt-2 font-body text-[13px] text-muted">An org admin or the proposal manager can submit with a written reason.</p>
                )}
              </div>
            ) : null}
            <div>
              <button
                type="button"
                className="aur-btn aur-btn-primary"
                disabled={pending || blocked || !renderId || (needsOverride && reason.trim().length < OVERRIDE_REASON_MIN)}
                onClick={record}
              >
                {pending ? "Recording…" : needsOverride ? "Record submission with override" : "Record submission"}
              </button>
            </div>
          </div>
        )}
        {error ? <p role="alert" className="mt-3 font-body text-[13px] text-red">{error}</p> : null}
        {done ? <p role="status" className="mt-3 font-body text-[13px] text-green">{done}</p> : null}
      </Panel>

      <Panel title="Submissions" eyebrow={submissions.length === 0 ? "None yet" : `${submissions.length} on record`}>
        {submissions.length === 0 ? (
          <p className="font-body text-[13px] text-muted">Nothing has been submitted for this opportunity.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-layer/10">
            {submissions.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 py-3">
                <span className="font-body text-[13px] text-text">
                  {SUBMISSION_METHOD_LABELS[s.method]} · {s.sentAt ? when(s.sentAt) : (SUBMISSION_STATUS_LABELS[s.status] ?? s.status)} · {s.sentBy}
                </span>
                {s.status === "failed" ? <span role="alert" className="font-body text-[13px] text-red">Not sent: {s.error || "the mail service gave no reason"}. Nothing left FORGE; send it again above.</span> : null}
                {s.subject ? <span className="font-body text-[13px] text-text">{s.subject}</span> : null}
                {s.recipients.length > 0 ? <span className="font-mono text-[11px] text-muted">To {s.recipients.join(", ")}{s.cc.length > 0 ? ` · Cc ${s.cc.join(", ")}` : ""}</span> : null}
                {s.note ? <span className="font-body text-[13px] text-muted">{s.note}</span> : null}
                {s.overrideReason ? <span className="font-body text-[13px] text-brass">Submitted before full sign-off: {s.overrideReason}</span> : null}
                {s.files.map((f, i) => (
                  <span key={f.fileName} className="font-mono text-[11px] text-muted">
                    {f.kind === "receipt" ? "Receipt: " : ""}
                    {f.kept ? (
                      <a href={`/api/opportunities/${view.opportunityId}/submissions/${s.id}/file?i=${i}`} className="text-cobalt underline-offset-2 hover:underline">{f.fileName}</a>
                    ) : (
                      f.fileName
                    )}{" "}
                    · {mb(f.byteSize)}
                    {f.sha256 ? ` · SHA-256 ${f.sha256.slice(0, 16)}…` : ""}
                  </span>
                ))}
                {view.canSubmit && (s.status === "sent" || s.status === "recorded") ? <ReceiptUpload opportunityId={view.opportunityId} submissionId={s.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Correspondence view={view} />
    </div>
  );
}
