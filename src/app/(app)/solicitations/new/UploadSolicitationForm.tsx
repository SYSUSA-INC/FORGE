"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { useUploadQueue } from "@/components/uploads/useUploadQueue";
import { formatBytes } from "@/lib/upload-client-logic";
import { acceptFor, resolvePolicy } from "@/lib/upload-policy";
import { createSolicitationFromUploadAction } from "../actions";

/**
 * BL-STAB-2c — the file goes from the browser straight to storage (no
 * request-size cap), the server checks it, and it is filed as a new
 * solicitation whose parse then runs in the background.
 */
export function UploadSolicitationForm() {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queue = useUploadQueue<string>({
    purpose: "document",
    concurrency: 1,
    claim: async ({ uploadId }) => {
      const res = await createSolicitationFromUploadAction({ uploadId });
      return res.ok ? { ok: true, result: res.id } : { ok: false, error: res.error };
    },
    onItemDone: (item) => {
      if (item.phase === "done" && item.result) router.push(`/solicitations/${item.result}`);
    },
  });
  const limit = formatBytes(resolvePolicy("document").maxBytes);

  function take(files: FileList | null | undefined) {
    const file = files?.[0];
    if (!file || queue.busy) return;
    queue.clear();
    queue.add([file]);
  }

  return (
    <Panel title="Upload" eyebrow={`PDF · DOCX · XLSX · PPTX · TXT · CSV · Image · up to ${limit}`}>
      <div className="flex flex-col gap-3">
        <div
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            take(e.dataTransfer.files);
          }}
          className={`relative grid cursor-pointer place-items-center rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
            dragOver ? "border-teal/70 bg-teal/[0.06]" : "border-layer/15 bg-layer/[0.02] hover:border-layer/30"
          }`}
        >
          <div className="font-display text-2xl font-semibold text-text">{queue.busy ? "Uploading…" : "Drop a file here"}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">or click to browse</div>
          <button
            type="button"
            disabled={queue.busy}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            className="aur-btn aur-btn-primary mt-4 disabled:opacity-50"
          >
            Select file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={acceptFor("document")}
            className="sr-only"
            onChange={(e) => {
              take(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <UploadQueue items={queue.items} onRetry={queue.retry} onCancel={queue.cancel} onRemove={queue.remove} />

        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
          The file goes straight to secure storage, then text extraction and the AI parse run in the background.
        </div>
      </div>
    </Panel>
  );
}
