"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { OVERRIDE_REASON_MIN, SEND_MAX_FILES, sendSize, submissionFileName } from "@/lib/deliver-logic";
import type { DeliverView } from "@/lib/deliver-store";
import { sendSubmissionAction } from "./actions";

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const split = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

/**
 * BL-NAV-LIFECYCLE 6b (FORGE II S-3) — Send from FORGE: the message and
 * the chosen renders go to the contracting officer from the opportunity's
 * own address. A confirm step names the recipients and the files before
 * anything leaves.
 */
export function SendPanel({ view }: { view: DeliverView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [ccSender, setCcSender] = useState(true);
  const [subject, setSubject] = useState(view.send.defaultSubject);
  const [body, setBody] = useState("Please find our proposal attached. Kindly confirm receipt.");
  const [names, setNames] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const { proposal, gate, send } = view;
  if (!proposal || !gate) return null;

  const chosen = view.renders.filter((r) => names[r.id] !== undefined);
  const total = chosen.reduce((n, r) => n + r.byteSize, 0);
  const size = sendSize(total);
  const needsOverride = !gate.clear;
  const ready =
    split(to).length > 0 &&
    subject.trim() !== "" &&
    body.trim() !== "" &&
    chosen.length > 0 &&
    chosen.length <= SEND_MAX_FILES &&
    size !== "refuse" &&
    (!needsOverride || (view.canOverride && reason.trim().length >= OVERRIDE_REASON_MIN));

  function toggle(id: string, contentType: string) {
    setNames((prev) => {
      const next = { ...prev };
      if (next[id] === undefined) next[id] = submissionFileName(proposal!.title, contentType);
      else delete next[id];
      return next;
    });
  }

  function sendNow() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await sendSubmissionAction({
        opportunityId: view.opportunityId,
        to,
        cc,
        ccSender,
        subject,
        body,
        files: chosen.map((r) => ({ renderId: r.id, fileName: names[r.id] ?? "" })),
        overrideReason: needsOverride ? reason : undefined,
      });
      setConfirming(false);
      if (!res.ok) return setError(res.error);
      setDone("Sending. The submission below shows Sent, or the reason it was not, in a moment.");
      setNames({});
      setReason("");
      router.refresh();
    });
  }

  return (
    <Panel title="Send from FORGE" eyebrow={view.dueDate ? `Due ${view.dueDate}` : "Submit by email"}>
      <p className="font-body text-[13px] leading-[1.5] text-muted">
        FORGE emails the files to the contracting officer from this opportunity&apos;s own address, so the reply comes back here. It is sent once, a copy of each file is kept, and the proposal and the opportunity are marked as submitted.
      </p>
      {!view.canSubmit ? (
        <p className="mt-3 font-body text-[13px] text-muted">Only an org admin, the proposal manager or the capture manager can send a submission.</p>
      ) : !send.configured ? (
        <p className="mt-3 font-body text-[13px] text-muted">Sending from FORGE is not set up on this site. Send the file yourself and use Record submission below.</p>
      ) : view.renders.length === 0 ? (
        <div className="mt-3">
          <p className="font-body text-[13px] text-muted">There is no rendered file yet. Render the PDF or the Word file in the Export panel on the proposal&apos;s page first.</p>
          <Link href={`/proposals/${proposal.id}`} className="aur-btn aur-btn-primary mt-3">Open the proposal</Link>
        </div>
      ) : confirming ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-layer/10 pt-3">
          <p className="font-body text-[13px] text-text">Send this submission now? It cannot be recalled.</p>
          <dl className="flex flex-col gap-1 font-mono text-[11px] text-muted">
            <div>To: <span className="text-text">{split(to).join(", ")}</span></div>
            {split(cc).length > 0 || (ccSender && send.senderEmail) ? (
              <div>Cc: <span className="text-text">{[...split(cc), ccSender ? send.senderEmail : ""].filter(Boolean).join(", ")}</span></div>
            ) : null}
            <div>Subject: <span className="text-text">{subject}</span></div>
            {chosen.map((r) => (
              <div key={r.id}>File: <span className="text-text">{names[r.id]}</span> · {mb(r.byteSize)}</div>
            ))}
            <div>Total: {mb(total)}</div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={sendNow}>
              {pending ? "Sending…" : needsOverride ? "Send now with override" : "Send now"}
            </button>
            <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="aur-label">To</span>
              <input className="aur-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="contracting.officer@agency.gov" />
            </label>
            {send.suggestions.length > 0 ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
                <span>Contracting officers in Customers:</span>
                {send.suggestions.map((s) => (
                  <button key={s.email} type="button" className="text-cobalt underline-offset-2 hover:underline" onClick={() => setTo((t) => (split(t).includes(s.email) ? t : [t.trim(), s.email].filter(Boolean).join(", ")))}>
                    {s.name} ({s.email})
                  </button>
                ))}
              </div>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="aur-label">Cc (optional)</span>
              <input className="aur-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="contract.specialist@agency.gov" />
            </label>
            {send.senderEmail ? (
              <label className="flex items-center gap-2 font-body text-[13px] text-text">
                <input type="checkbox" checked={ccSender} onChange={(e) => setCcSender(e.target.checked)} />
                Copy me ({send.senderEmail})
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="aur-label">Subject</span>
              <input className="aur-input" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="aur-label">Message (plain text)</span>
              <textarea className="aur-input" rows={5} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="aur-label">Files to attach</legend>
              {view.renders.map((r) => (
                <div key={r.id} className="flex flex-col gap-1 border-t border-layer/10 pt-2">
                  <label className="flex items-center gap-2 font-body text-[13px] text-text">
                    <input type="checkbox" checked={names[r.id] !== undefined} onChange={() => toggle(r.id, r.contentType)} />
                    {r.contentType.toUpperCase()} · {when(r.renderedAt)} · {mb(r.byteSize)}
                    {r.pageCount ? ` · ${r.pageCount} pages` : ""}
                  </label>
                  {names[r.id] !== undefined ? (
                    <input className="aur-input" aria-label="File name" maxLength={110} value={names[r.id]} onChange={(e) => setNames((prev) => ({ ...prev, [r.id]: e.target.value }))} />
                  ) : null}
                </div>
              ))}
              <p className={`font-mono text-[11px] ${size === "ok" ? "text-muted" : size === "warn" ? "text-brass" : "text-red"}`}>
                Total {mb(total)}
                {size === "warn" ? ". Above 20 MB: many agency mail systems refuse large messages. Check the RFP’s limit." : ""}
                {size === "refuse" ? ". Above 35 MB FORGE does not send: send the files yourself and use Record submission." : ""}
              </p>
            </fieldset>
            {needsOverride ? (
              <div className="border-t border-layer/10 pt-3">
                <p className="font-body text-[13px] text-brass">Sign-off is not complete ({gate.blockers.length} open; see Sign-off above).</p>
                {view.canOverride ? (
                  <label className="mt-2 flex flex-col gap-1">
                    <span className="aur-label">Reason for submitting without full sign-off</span>
                    <textarea className="aur-input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Kept on the submission and the audit log" />
                  </label>
                ) : (
                  <p className="mt-2 font-body text-[13px] text-muted">An org admin or the proposal manager can submit with a written reason.</p>
                )}
              </div>
            ) : null}
            <div>
              <button type="button" className="aur-btn aur-btn-primary" disabled={!ready} onClick={() => { setError(null); setDone(null); setConfirming(true); }}>
                Review and send
              </button>
            </div>
          </div>
          <aside className="flex flex-col gap-2 border-t border-layer/10 pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <span className="aur-label">The RFP&apos;s submission rules</span>
            <p className="font-mono text-[11px] text-muted">Due {view.dueDate ?? "date not set"}</p>
            {send.rules.length === 0 ? (
              <p className="font-body text-[13px] text-muted">No submission rules were read from Section L. Check the solicitation for the address, the size limit and the file naming.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {send.rules.map((r, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <span className="font-body text-[13px] text-text">{r.rule}</span>
                    {r.quote ? <q className="font-body text-[12px] leading-[1.5] text-muted">{r.quote}</q> : null}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
      {error ? <p role="alert" className="mt-3 font-body text-[13px] text-red">{error}</p> : null}
      {done ? <p role="status" className="mt-3 font-body text-[13px] text-green">{done}</p> : null}
    </Panel>
  );
}
