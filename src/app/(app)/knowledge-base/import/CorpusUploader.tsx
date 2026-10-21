"use client";

import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { useUploadQueue } from "@/components/uploads/useUploadQueue";
import { acceptFor, formatLimit } from "@/lib/upload-policy";
import { createKnowledgeArtifactFromUploadAction } from "./actions";

/** What a batch is saved with, fixed when its Upload is pressed. */
type BatchMeta = { kind: string; tags: string; outcome: string };

const ARTIFACT_KINDS: { id: string; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "proposal", label: "Old proposal" },
  { id: "rfp", label: "RFP / RFI / RFQ" },
  { id: "contract", label: "Contract" },
  { id: "cpars", label: "CPARS report" },
  { id: "debrief", label: "Debrief" },
  { id: "capability_brief", label: "Capability brief" },
  { id: "resume", label: "Resume" },
  { id: "brochure", label: "Brochure" },
  { id: "whitepaper", label: "White paper" },
  { id: "email", label: "Email" },
  { id: "note", label: "Note" },
  { id: "deck", label: "Slide deck" },
  { id: "spreadsheet", label: "Spreadsheet" },
  { id: "image", label: "Image" },
  { id: "other", label: "Other" },
];

/**
 * BL-STAB-2e — files go from the browser straight to storage (no request
 * cap; up to the deployment's per-file limit), three at a time, each with
 * progress, retry and cancel, and each is saved as a knowledge artifact as
 * soon as it is checked; its text is read in the background. Files wait in
 * the list until Upload is pressed, so a batch keeps the kind, tags and
 * outcome chosen for it.
 */
export function CorpusUploader({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const [staged, setStaged] = useState<File[]>([]);
  const [defaultKind, setDefaultKind] = useState<string>("auto");
  const [defaultTags, setDefaultTags] = useState<string>("");
  // BL-AIP-4 — outcome provenance for historical proposals / debriefs.
  const [defaultOutcome, setDefaultOutcome] = useState<string>("none");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queue = useUploadQueue<string, BatchMeta>({
    purpose: "document",
    concurrency: 3,
    maxBytes,
    claim: async ({ uploadId, meta }) => {
      const res = await createKnowledgeArtifactFromUploadAction({
        uploadId,
        ...(meta.kind !== "auto" ? { kind: meta.kind } : {}),
        tags: meta.tags,
        ...(meta.outcome !== "none" ? { outcome: meta.outcome } : {}),
      });
      return res.ok ? { ok: true, result: res.id } : { ok: false, error: res.error };
    },
  });
  // Show the new artifacts once a batch has finished.
  const doneCount = queue.items.filter((it) => it.phase === "done").length;
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !queue.busy && doneCount > 0) router.refresh();
    wasBusy.current = queue.busy;
  }, [queue.busy, doneCount, router]);

  function pickFiles() {
    inputRef.current?.click();
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.size > 0);
    if (arr.length > 0) setStaged((prev) => [...prev, ...arr]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  function uploadAll() {
    if (staged.length === 0) return;
    const meta: BatchMeta = { kind: defaultKind, tags: defaultTags.trim(), outcome: defaultOutcome };
    queue.add(staged.map((file) => ({ file, meta })));
    setStaged([]);
  }

  function clearDone() {
    for (const it of queue.items) if (it.phase === "done") queue.remove(it.id);
  }

  const failedCount = queue.items.filter((it) => it.phase === "failed").length;
  const waitingCount = staged.length + queue.items.filter((it) => it.phase === "queued").length;
  const activeCount = queue.items.filter((it) => it.phase === "uploading" || it.phase === "verifying" || it.phase === "saving").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
        <div>
          <label className="aur-label">Default kind</label>
          <select
            className="aur-input"
            value={defaultKind}
            onChange={(e) => setDefaultKind(e.target.value)}
          >
            {ARTIFACT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <div className="mt-1 font-mono text-[10px] text-muted">
            Applied to every file in this batch. AI re-classifies in 10c.
          </div>
        </div>
        <div>
          <label className="aur-label">Default tags</label>
          <input
            className="aur-input"
            placeholder="navy, c5isr, fy26 (comma-separated)"
            value={defaultTags}
            onChange={(e) => setDefaultTags(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Outcome</label>
          <select
            className="aur-input"
            value={defaultOutcome}
            onChange={(e) => setDefaultOutcome(e.target.value)}
            title="For past proposals and debriefs: how the pursuit ended. The Brain favours won content when it drafts."
          >
            <option value="none">Unknown / not a proposal</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="no_bid">No-bid</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <div className="mt-1 font-mono text-[10px] text-muted">
            Won content is boosted in Brain retrieval.
          </div>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={pickFiles}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-teal-400 bg-teal-400/5"
            : "border-layer/15 bg-layer/[0.015] hover:border-layer/30"
        }`}
      >
        <div className="font-display text-2xl font-semibold text-text">
          Drop files here
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-label text-muted">
          PDF · DOCX · XLSX · PPTX · TXT · CSV · Image &nbsp;·&nbsp; up to {formatLimit(maxBytes)} each
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            pickFiles();
          }}
          className="aur-btn aur-btn-primary mt-4"
        >
          Select files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptFor("document")}
          className="sr-only"
          onChange={onPick}
        />
      </div>

      {staged.length > 0 || queue.items.length > 0 ? (
        <div className="rounded-xl border border-layer/10 bg-layer/[0.015]">
          <div className="flex items-center justify-between border-b border-layer/10 p-3">
            <div className="font-mono text-[11px] uppercase tracking-label text-muted">
              {waitingCount} waiting · {activeCount} uploading · {doneCount} done · {failedCount} failed
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={uploadAll}
                disabled={staged.length === 0}
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {`Upload ${staged.length}`}
              </button>
              <button
                type="button"
                onClick={clearDone}
                disabled={doneCount === 0}
                className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
              >
                Clear done
              </button>
            </div>
          </div>
          {staged.length > 0 ? (
            <ul className="divide-y divide-layer/5">
              {staged.map((f, i) => (
                <li key={`${f.name}_${f.size}_${i}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 font-mono text-[11px]">
                  <div className="truncate text-text">{f.name}</div>
                  <div className="text-muted">{Math.max(1, Math.round(f.size / 1024))} KB</div>
                  <button
                    type="button"
                    className="text-muted hover:text-text"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="p-3">
            <UploadQueue items={queue.items} onRetry={queue.retry} onCancel={queue.cancel} onRemove={queue.remove} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
