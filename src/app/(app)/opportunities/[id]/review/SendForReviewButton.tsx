"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listOrgReviewerCandidatesAction,
  sendOpportunityReviewRequestAction,
} from "./actions";

type Reviewer = { id: string; name: string; email: string };

export function SendForReviewButton({
  opportunityId,
  className,
  size = "md",
}: {
  opportunityId: string;
  className?: string;
  size?: "md" | "sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className={
          className ??
          (size === "sm"
            ? "aur-btn aur-btn-ghost text-[11px]"
            : "aur-btn aur-btn-ghost")
        }
        title="Send to a teammate or external reviewer for a Bid / No-bid call"
      >
        Send for review
      </button>
      {open ? (
        <SendForReviewModal
          opportunityId={opportunityId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SendForReviewModal({
  opportunityId,
  onClose,
}: {
  opportunityId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"team" | "external">("team");
  const [team, setTeam] = useState<Reviewer[] | null>(null);
  const [reviewerUserId, setReviewerUserId] = useState<string>("");
  const [extEmail, setExtEmail] = useState("");
  const [extName, setExtName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listOrgReviewerCandidatesAction()
      .then((rows) => {
        if (cancelled) return;
        setTeam(rows);
        if (rows.length > 0) setReviewerUserId(rows[0].id);
      })
      .catch(() => {
        if (cancelled) return;
        setTeam([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function submit() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await sendOpportunityReviewRequestAction({
        opportunityId,
        reviewerUserId: tab === "team" ? reviewerUserId || undefined : undefined,
        reviewerEmail: tab === "external" ? extEmail.trim() : undefined,
        reviewerName: tab === "external" ? extName.trim() : undefined,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(
        res.emailSent
          ? "Sent. The reviewer will get an email with a magic link."
          : "Saved, but the email failed to send. Confirm RESEND_API_KEY on Vercel.",
      );
      setNote("");
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#0c1424] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold text-text">
            Send for review
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-full border border-white/10 p-0.5 text-[11px]">
          {(["team", "external"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 font-mono uppercase tracking-widest transition-colors ${
                tab === t
                  ? "bg-teal-400/15 text-teal"
                  : "text-muted hover:text-text"
              }`}
            >
              {t === "team" ? "Teammate" : "External email"}
            </button>
          ))}
        </div>

        {tab === "team" ? (
          <div className="mb-3">
            <label className="aur-label">Reviewer</label>
            {team === null ? (
              <div className="font-mono text-[11px] text-muted">Loading…</div>
            ) : team.length === 0 ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[11px] text-amber-200">
                No teammates yet. Invite users in Settings, or send to an
                external email instead.
              </div>
            ) : (
              <select
                className="aur-input"
                value={reviewerUserId}
                onChange={(e) => setReviewerUserId(e.target.value)}
              >
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ? `${m.name} · ${m.email}` : m.email}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3">
              <label className="aur-label">Reviewer email</label>
              <input
                className="aur-input"
                type="email"
                value={extEmail}
                onChange={(e) => setExtEmail(e.target.value)}
                placeholder="reviewer@example.com"
              />
            </div>
            <div className="mb-3">
              <label className="aur-label">Reviewer name (optional)</label>
              <input
                className="aur-input"
                value={extName}
                onChange={(e) => setExtName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="mb-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[10px] text-muted">
              External reviewers get a magic link that works without a FORGE
              login. Link expires in 14 days.
            </div>
          </>
        )}

        <div className="mb-3">
          <label className="aur-label">Note (optional)</label>
          <textarea
            className="aur-input min-h-[80px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you want them to look at — incumbent fit, technical risk, set-aside…"
          />
        </div>

        {error ? (
          <div className="mb-3 rounded border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mb-3 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {success}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="aur-btn aur-btn-ghost text-[11px]"
            disabled={pending}
          >
            {success ? "Close" : "Cancel"}
          </button>
          {success ? null : (
            <button
              type="button"
              onClick={submit}
              disabled={
                pending ||
                (tab === "team"
                  ? !reviewerUserId
                  : !extEmail.includes("@"))
              }
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
