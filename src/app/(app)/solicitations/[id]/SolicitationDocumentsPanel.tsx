"use client";

import { useRef, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  addSolicitationDocumentAction,
  deleteSolicitationDocumentAction,
  mergeSolicitationDocumentsAction,
  reparseSolicitationDocumentAction,
  type SolicitationDocumentRow,
} from "./document-actions";

const DOC_TYPE_LABELS: Record<string, string> = {
  rfp: "RFP",
  pws: "PWS",
  sow: "SOW",
  cdrl: "CDRL",
  j_attachment: "J-Attach",
  amendment: "Amendment",
  other: "Other",
};

const PARSE_STATUS_COLORS: Record<string, string> = {
  uploaded: "#9BC9D9",
  parsing: "#A78BFA",
  parsed: "#10B981",
  failed: "#EF4444",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  solicitationId: string;
  initial: SolicitationDocumentRow[];
};

export function SolicitationDocumentsPanel({ solicitationId, initial }: Props) {
  const [docs, setDocs] = useState<SolicitationDocumentRow[]>(initial);
  const [uploading, startUpload] = useTransition();
  const [merging, startMerge] = useTransition();
  const [fileError, setFileError] = useState<string | null>(null);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);

  function upload() {
    setFileError(null);
    setMergeMsg(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setFileError("Pick a file first."); return; }
    const form = new FormData();
    form.set("file", file);
    form.set("documentType", typeRef.current?.value ?? "other");

    startUpload(async () => {
      const res = await addSolicitationDocumentAction(solicitationId, form);
      if (!res.ok) { setFileError(res.error); return; }
      // Optimistically insert a "parsing" row while the async parse runs.
      setDocs((prev) => [
        ...prev,
        {
          id: res.id,
          solicitationId,
          documentType: (typeRef.current?.value ?? "other") as SolicitationDocumentRow["documentType"],
          fileName: file.name,
          fileSize: file.size,
          parseStatus: "parsing",
          parseError: "",
          requirementCount: 0,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

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
      {/* Upload form */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">
              Document type
            </label>
            <select
              ref={typeRef}
              className="aur-input font-mono text-[11px]"
              defaultValue="other"
            >
              <option value="pws">PWS — Performance Work Statement</option>
              <option value="sow">SOW — Statement of Work</option>
              <option value="cdrl">CDRL — Contract Data Requirements List</option>
              <option value="j_attachment">J-Attachment</option>
              <option value="amendment">Amendment</option>
              <option value="rfp">RFP (additional volume)</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <label className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">
              File
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"
              className="aur-input font-mono text-[11px] file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-0.5 file:font-mono file:text-[11px] file:text-text"
            />
          </div>
          <button
            type="button"
            onClick={upload}
            disabled={uploading}
            className="aur-btn aur-btn-primary text-[11px] disabled:opacity-40 shrink-0"
          >
            {uploading ? "Uploading…" : "Add document"}
          </button>
        </div>
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
            const statusColor = PARSE_STATUS_COLORS[doc.parseStatus] ?? "#9BC9D9";
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                {/* Type badge */}
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: "#9BC9D9",
                    backgroundColor: "#9BC9D91A",
                    border: "1px solid #9BC9D940",
                  }}
                >
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
                </div>

                {/* Status badge */}
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: statusColor,
                    backgroundColor: `${statusColor}1A`,
                    border: `1px solid ${statusColor}40`,
                  }}
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
