"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { replySubject } from "@/lib/correspondence-logic";
import { SEND_MAX_FILES, sendSize } from "@/lib/deliver-logic";
import { uploadFile } from "@/lib/upload-client";
import { sendReplyAction } from "./actions";

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

/**
 * BL-NAV-LIFECYCLE 6d-1 (FORGE II S-4, Answering) — answer a filed
 * message from FORGE: to its sender, from the opportunity's own address,
 * in the same thread. Files are uploaded by the browser and sent by
 * upload id. An answer is correspondence, not a submission: no sign-off
 * is asked and no stage moves.
 */
export function ReplyForm({ opportunityId, emailId, to, subject: original, senderEmail, onClose }: { opportunityId: string; emailId: string; to: string; subject: string; senderEmail: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cc, setCc] = useState("");
  const [ccSender, setCcSender] = useState(true);
  const [subject, setSubject] = useState(replySubject(original));
  const [body, setBody] = useState("");
  const [extras, setExtras] = useState<{ uploadId: string; fileName: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const size = sendSize(extras.reduce((n, x) => n + x.size, 0));
  const ready = body.trim() !== "" && !uploading && size !== "refuse" && extras.length <= SEND_MAX_FILES;

  async function add(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const up = await uploadFile(file, { purpose: "document" });
      if (!up.ok) return setError(up.error);
      setExtras((prev) => [...prev, { uploadId: up.uploadId, fileName: up.upload.fileName, size: up.upload.size }]);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function send() {
    setError(null);
    start(async () => {
      const res = await sendReplyAction({ opportunityId, emailId, cc, ccSender, subject, body, uploads: extras.map((x) => ({ uploadId: x.uploadId, fileName: x.fileName })) });
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-3 border-l border-layer/10 pl-3">
      <span className="font-mono text-[11px] text-muted">
        To <span className="text-text">{to}</span>, from this opportunity&apos;s own address. It cannot be recalled.
      </span>
      <label className="flex flex-col gap-1">
        <span className="aur-label">Cc (optional)</span>
        <input className="aur-input" value={cc} onChange={(e) => setCc(e.target.value)} />
      </label>
      {senderEmail ? (
        <label className="flex items-center gap-2 font-body text-[13px] text-text">
          <input type="checkbox" checked={ccSender} onChange={(e) => setCcSender(e.target.checked)} />
          Copy me ({senderEmail})
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="aur-label">Subject</span>
        <input className="aur-input" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="aur-label">Answer (plain text)</span>
        <textarea className="aur-input" rows={5} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {extras.map((x) => (
        <span key={x.uploadId} className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-muted">
          <span className="text-text">{x.fileName}</span> · {mb(x.size)}
          <button type="button" className="text-cobalt underline-offset-2 hover:underline" onClick={() => setExtras((prev) => prev.filter((p) => p.uploadId !== x.uploadId))}>Remove</button>
        </span>
      ))}
      <div>
        <input ref={fileInput} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt" onChange={(e) => void add(e.target.files?.[0])} />
        <button type="button" className="font-mono text-[11px] text-cobalt underline-offset-2 hover:underline" disabled={uploading || extras.length >= SEND_MAX_FILES} onClick={() => fileInput.current?.click()}>
          {uploading ? "Uploading…" : "Attach a file"}
        </button>
        {size === "refuse" ? <span className="ml-2 font-mono text-[11px] text-red">Above 35 MB FORGE does not send.</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="aur-btn aur-btn-primary" disabled={!ready || pending} onClick={send}>
          {pending ? "Sending…" : "Send reply"}
        </button>
        <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={onClose}>Cancel</button>
      </div>
      {error ? <p role="alert" className="font-body text-[13px] text-red">{error}</p> : null}
    </div>
  );
}
