"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadFile } from "@/lib/upload-client";
import { attachReceiptAction } from "./actions";

/**
 * BL-NAV-LIFECYCLE 6b-2 — attach a receipt to a submission on record: the
 * portal's confirmation page, the officer's acknowledgement. The browser
 * uploads the file; the action files it by upload id.
 */
export function ReceiptUpload({ opportunityId, submissionId }: { opportunityId: string; submissionId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attach(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadFile(file, { purpose: "document" });
      if (!up.ok) return setError(up.error);
      const res = await attachReceiptAction({ opportunityId, submissionId, uploadId: up.uploadId });
      if (!res.ok) return setError(res.error);
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <input ref={input} type="file" className="hidden" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt" onChange={(e) => void attach(e.target.files?.[0])} />
      <button type="button" className="font-mono text-[11px] text-cobalt underline-offset-2 hover:underline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : "Attach a receipt"}
      </button>
      {error ? <span role="alert" className="font-body text-[12px] text-red">{error}</span> : null}
    </span>
  );
}
