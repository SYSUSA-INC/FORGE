"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGoldDocFromNoticeAction, createGoldDocFromTextAction } from "./actions";

/** BL-AIX Phase 1e — add a public RFP to the gold set by notice ID, or by pasting its text. */
export function AddGoldDocForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"notice" | "paste">("notice");
  const [noticeId, setNoticeId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res =
        mode === "notice"
          ? await createGoldDocFromNoticeAction(noticeId)
          : await createGoldDocFromTextAction({ title, text, noticeId: noticeId || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/admin/gold-set/${res.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(["notice", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`aur-btn text-[11px] ${mode === m ? "aur-btn-primary" : "aur-btn-ghost"}`}
          >
            {m === "notice" ? "SAM.gov notice ID" : "Paste text"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="aur-label">Notice ID{mode === "paste" ? " (optional)" : ""}</span>
        <input className="aur-input" value={noticeId} onChange={(e) => setNoticeId(e.target.value)} placeholder="e.g. 3f1c0e6a2b8d4c7e9a1b2c3d4e5f6a7b" />
      </label>
      {mode === "notice" ? (
        <p className="font-mono text-[11px] text-muted">
          FORGE downloads the notice and up to 15 attachments (25 MB each) from SAM.gov and extracts their text. Scanned
          attachments come back empty and are flagged so you can paste their text on the document page. Takes up to a few minutes.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="aur-label">Title</span>
            <input className="aur-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="aur-label">Solicitation text</span>
            <textarea className="aur-input min-h-[160px] font-mono text-[11px]" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </>
      )}
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={pending} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60">
          {pending ? (mode === "notice" ? "Downloading…" : "Saving…") : "Add to gold set"}
        </button>
      </div>
    </div>
  );
}
