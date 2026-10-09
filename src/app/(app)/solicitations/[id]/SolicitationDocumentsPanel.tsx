"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { useUploadQueue } from "@/components/uploads/useUploadQueue";
import { COMPANION_DOCUMENT_TYPES, documentTypeFromName, type CompanionDocumentType } from "@/lib/document-type-name";
import { acceptFor, validateUploadRequest } from "@/lib/upload-policy";
import {
  addSolicitationDocumentFromUploadAction,
  deleteSolicitationDocumentAction,
  mergeSolicitationDocumentsAction,
  reparseSolicitationDocumentAction,
  type SolicitationDocumentRow,
} from "./document-actions";

const DOC_TYPE_LABELS: Record<CompanionDocumentType, string> = {
  rfp: "RFP",
  pws: "PWS",
  sow: "SOW",
  cdrl: "CDRL",
  j_attachment: "J-Attach",
  amendment: "Amendment",
  other: "Other",
};

const DOC_TYPE_OPTIONS: Record<CompanionDocumentType, string> = {
  pws: "PWS — Performance Work Statement",
  sow: "SOW — Statement of Work",
  cdrl: "CDRL — Contract Data Requirements List",
  j_attachment: "J-Attachment",
  amendment: "Amendment",
  rfp: "RFP (additional volume)",
  other: "Other",
};

const PARSE_STATUS_CLASS: Record<string, string> = {
  uploaded: "text-muted bg-layer/5 border-layer/15",
  parsing: "text-violet bg-violet/10 border-violet/30",
  parsed: "text-emerald bg-emerald/10 border-emerald/30",
  failed: "text-rose bg-rose/10 border-rose/30",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file picked but not yet uploaded, with the type it will be filed as. */
type Staged = { key: number; file: File; documentType: CompanionDocumentType; error: string | null };

type Props = {
  solicitationId: string;
  initial: SolicitationDocumentRow[];
  /** The server's per-file limit for documents. */
  maxBytes: number;
};

export function SolicitationDocumentsPanel({ solicitationId, initial, maxBytes }: Props) {
  const router = useRouter();
  const [docs, setDocs] = useState<SolicitationDocumentRow[]>(initial);
  // Adopt the server's list after a refresh (statuses move on as parses finish).
  useEffect(() => setDocs(initial), [initial]);
  const [merging, startMerge] = useTransition();
  const [fileError, setFileError] = useState<string | null>(null);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  // BL-STAB-2d / BL-STAB-6 — each document goes straight to storage (no
  // size cap), two at a time, then is filed with the type it was staged with.
  const queue = useUploadQueue<string, { documentType: CompanionDocumentType }>({
    purpose: "document",
    concurrency: 2,
    maxBytes,
    claim: async ({ uploadId, meta }) => {
      const res = await addSolicitationDocumentFromUploadAction(solicitationId, { uploadId, documentType: meta.documentType });
      return res.ok ? { ok: true, result: res.id } : { ok: false, error: res.error };
    },
    onItemDone: (item) => {
      if (item.phase !== "done" || !item.result) return;
      const id = item.result;
      setDocs((prev) =>
        prev.some((d) => d.id === id)
          ? prev
          : [
              ...prev,
              {
                id,
                solicitationId,
                documentType: item.meta.documentType,
                fileName: item.file.name,
                fileSize: item.file.size,
                parseStatus: "parsing",
                parseError: "",
                coverageWarnings: null,
                lm: null,
                requirementCount: 0,
                sortOrder: 0,
                createdAt: new Date().toISOString(),
              },
            ],
      );
      router.refresh();
    },
  });

  function stage(files: FileList | null) {
    setFileError(null);
    setMergeMsg(null);
    const picked = Array.from(files ?? []).map<Staged>((file) => {
      const check = validateUploadRequest({ purpose: "document", fileName: file.name, size: file.size, maxBytes });
      return { key: nextKey.current++, file, documentType: documentTypeFromName(file.name), error: check.ok ? null : check.error };
    });
    setStaged((list) => [...list, ...picked]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function upload() {
    const ready = staged.filter((s) => !s.error);
    if (ready.length === 0) {
      setFileError(staged.length ? "None of the picked files can be uploaded." : "Pick one or more files first.");
      return;
    }
    setFileError(null);
    queue.add(ready.map((s) => ({ file: s.file, meta: { documentType: s.documentType } })));
    setStaged((list) => list.filter((s) => s.error));
  }
  const readyCount = staged.filter((s) => !s.error).length;

  function deleteDoc(id: string) {
    if (!window.confirm("Delete this companion document? Its requirements will be removed from the merged set.")) return;
    setDeletingId(id);
    deleteSolicitationDocumentAction(id)
      .then((res) => {
        if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
      })
      .catch(() => {})
      .finally(() => setDeletingId(null));
  }

  function reparse(id: string) {
    setReparsingId(id);
    reparseSolicitationDocumentAction(id)
      .then((res) => {
        if (res.ok) {
          setDocs((prev) =>
            prev.map((d) => (d.id === id ? { ...d, parseStatus: "parsing" } : d)),
          );
        }
      })
      .catch(() => {})
      .finally(() => setReparsingId(null));
  }

  function merge() {
    setMergeMsg(null);
    startMerge(async () => {
      const res = await mergeSolicitationDocumentsAction(solicitationId);
      if (res.ok) setMergeMsg(`Merged — ${res.mergedCount} requirements on parent.`);
      else setMergeMsg(`Merge failed: ${res.error}`);
    });
  }

  const hasAnyParsed = docs.some((d) => d.parseStatus === "parsed");
  const allDone = docs.every((d) => d.parseStatus === "parsed" || d.parseStatus === "failed");

  return (
    <Panel
      title="Companion documents"
      eyebrow={`${docs.length} attached`}
    >
      {/* Upload: pick one or more files; each gets a type, editable before upload. */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">
              Files (several at once)
            </label>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={acceptFor("document")}
              onChange={(e) => stage(e.target.files)}
              className="aur-input font-mono text-[11px] file:mr-2 file:rounded file:border-0 file:bg-layer/10 file:px-2 file:py-0.5 file:font-mono file:text-[11px] file:text-text"
            />
          </div>
          <button
            type="button"
            onClick={upload}
            disabled={readyCount === 0}
            className="aur-btn aur-btn-primary shrink-0 text-[11px] disabled:opacity-40"
          >
            {readyCount > 1 ? `Add ${readyCount} documents` : "Add document"}
            {queue.busy ? " · uploading…" : ""}
          </button>
        </div>
        {staged.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {staged.map((st) => (
              <li
                key={st.key}
                className={`grid items-center gap-2 rounded-md border px-3 py-2 sm:grid-cols-[1fr_16rem_auto] ${st.error ? "border-rose/40 bg-rose/[0.05]" : "border-layer/15 bg-layer/[0.02]"}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-text" title={st.file.name}>
                    {st.file.name}
                  </div>
                  {st.error ? <div className="font-mono text-[11px] text-rose">{st.error}</div> : null}
                </div>
                <select
                  aria-label={`Document type for ${st.file.name}`}
                  value={st.documentType}
                  disabled={Boolean(st.error)}
                  onChange={(e) => {
                    const documentType = e.target.value as CompanionDocumentType;
                    setStaged((list) => list.map((x) => (x.key === st.key ? { ...x, documentType } : x)));
                  }}
                  className="aur-input font-mono text-[11px]"
                >
                  {COMPANION_DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOC_TYPE_OPTIONS[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="aur-btn aur-btn-ghost text-[10px]"
                  onClick={() => setStaged((list) => list.filter((x) => x.key !== st.key))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <UploadQueue
          items={queue.items}
          onRetry={queue.retry}
          onCancel={queue.cancel}
          onRemove={queue.remove}
          detail={(it) => DOC_TYPE_LABELS[it.meta.documentType]}
        />
        {fileError && (
          <p className="font-mono text-[11px] text-rose">{fileError}</p>
        )}
      </div>

      {/* Document list */}
      {docs.length === 0 ? (
        <p className="font-body text-[13px] text-muted">
          No companion documents yet. Attach a PWS, SOW, CDRL, or J-attachment to include its requirements in the merged set.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((doc) => {
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2"
              >
                {/* Type badge */}
                <span className="shrink-0 rounded border border-layer/15 bg-layer/[0.04] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                  {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                </span>

                {/* File name + size */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-text">
                    {doc.fileName}
                  </p>
                  <p className="font-mono text-[10px] text-subtle">
                    {formatBytes(doc.fileSize)}
                    {doc.parseStatus === "parsed"
                      ? ` · ${doc.requirementCount} reqs`
                      : ""}
                  </p>
                  {doc.parseStatus === "failed" && doc.parseError ? (
                    <p className="font-mono text-[10px] text-rose">{doc.parseError}</p>
                  ) : null}
                </div>

                {/* Status badge */}
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${PARSE_STATUS_CLASS[doc.parseStatus] ?? PARSE_STATUS_CLASS.uploaded}`}
                >
                  {doc.parseStatus}
                </span>

                {/* Actions */}
                {doc.parseStatus === "failed" && (
                  <button
                    type="button"
                    onClick={() => reparse(doc.id)}
                    disabled={reparsingId === doc.id}
                    className="shrink-0 font-mono text-[10px] text-teal underline disabled:opacity-40"
                  >
                    {reparsingId === doc.id ? "…" : "Reparse"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteDoc(doc.id)}
                  disabled={deletingId === doc.id}
                  className="shrink-0 font-mono text-[10px] text-rose underline disabled:opacity-40"
                >
                  {deletingId === doc.id ? "…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Merge button — only when there's something to merge */}
      {hasAnyParsed && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={merge}
            disabled={merging || !allDone}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
            title={!allDone ? "Wait for all documents to finish parsing" : undefined}
          >
            {merging ? "Merging…" : "Recompute merged requirements"}
          </button>
          {mergeMsg && (
            <span className="font-mono text-[11px] text-teal">{mergeMsg}</span>
          )}
          {!allDone && (
            <span className="font-mono text-[10px] text-muted">
              Parsing in progress…
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
