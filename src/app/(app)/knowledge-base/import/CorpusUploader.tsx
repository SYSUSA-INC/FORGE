"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  uploadKnowledgeArtifactAction,
  type ArtifactUploadResult,
} from "./actions";

type QueueItem = {
  id: string; // local-only id for UI
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
  artifactId?: string;
};

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

const ACCEPT_ATTR =
  "application/pdf,.pdf," +
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  ".txt,.md,text/plain,text/markdown," +
  ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif";

export function CorpusUploader() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [defaultKind, setDefaultKind] = useState<string>("auto");
  const [defaultTags, setDefaultTags] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pickFiles() {
    inputRef.current?.click();
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.size > 0);
    if (arr.length === 0) return;
    setQueue((prev) => [
      ...prev,
      ...arr.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "queued" as const,
      })),
    ]);
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
    const queued = queue.filter((q) => q.status === "queued");
    if (queued.length === 0) return;

    startTransition(async () => {
      // Sequentially upload to keep memory + connection load reasonable.
      for (const item of queued) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "uploading" } : q,
          ),
        );

        const fd = new FormData();
        fd.append("file", item.file);
        if (defaultKind && defaultKind !== "auto") {
          fd.append("kind", defaultKind);
        }
        if (defaultTags.trim()) fd.append("tags", defaultTags.trim());

        let res: ArtifactUploadResult;
        try {
          res = await uploadKnowledgeArtifactAction(fd);
        } catch (err) {
          res = {
            ok: false,
            error: err instanceof Error ? err.message : "Upload failed",
          };
        }

        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? res.ok
                ? { ...q, status: "done", artifactId: res.id }
                : { ...q, status: "failed", error: res.error }
              : q,
          ),
        );
      }
      router.refresh();
    });
  }

  function clearDone() {
    setQueue((prev) => prev.filter((q) => q.status !== "done"));
  }

  const queuedCount = queue.filter((q) => q.status === "queued").length;
  const uploadingCount = queue.filter((q) => q.status === "uploading").length;
  const doneCount = queue.filter((q) => q.status === "done").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
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
            : "border-white/15 bg-white/[0.015] hover:border-white/30"
        }`}
      >
        <div className="font-display text-2xl font-semibold text-text">
          Drop files here
        </div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          PDF · DOCX · XLSX · PPTX · TXT · Image &nbsp;·&nbsp; up to 50 MB each
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
          accept={ACCEPT_ATTR}
          className="sr-only"
          onChange={onPick}
        />
      </div>

      {queue.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.015]">
          <div className="flex items-center justify-between border-b border-white/10 p-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
              Queue · {queuedCount} pending · {uploadingCount} uploading ·{" "}
              {doneCount} done · {failedCount} failed
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={uploadAll}
                disabled={pending || queuedCount === 0}
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {pending ? "Uploading…" : `Upload ${queuedCount}`}
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
          <ul className="divide-y divide-white/5">
            {queue.map((q) => (
              <li
                key={q.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 font-mono text-[11px]"
              >
                <div className="truncate text-text">{q.file.name}</div>
                <div className="text-muted">
                  {Math.max(1, Math.round(q.file.size / 1024))} KB
                </div>
                <StatusPill status={q.status} error={q.error} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({
  status,
  error,
}: {
  status: QueueItem["status"];
  error?: string;
}) {
  const tone =
    status === "done"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "uploading"
        ? "bg-amber-500/15 text-amber-200"
        : status === "failed"
          ? "bg-rose-500/15 text-rose-300"
          : "bg-white/5 text-muted";
  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest ${tone}`}
      title={error}
    >
      {status === "failed" && error ? error.slice(0, 40) : status}
    </span>
  );
}
