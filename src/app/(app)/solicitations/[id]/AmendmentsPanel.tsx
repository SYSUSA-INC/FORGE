"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { useUploadQueue } from "@/components/uploads/useUploadQueue";
import { amendmentNumberFromName } from "@/lib/amendment-name";
import { acceptFor, validateUploadRequest } from "@/lib/upload-policy";
import { createSolicitationFromUploadAction } from "../actions";
import type { AmendmentListRow } from "../actions";

const STATUS_CLASS: Record<string, string> = {
  uploaded: "text-teal bg-teal/10 border-teal/30",
  parsing: "text-violet bg-violet/10 border-violet/30",
  parsed: "text-emerald bg-emerald/10 border-emerald/30",
  failed: "text-rose bg-rose/10 border-rose/30",
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  parsing: "Parsing",
  parsed: "Parsed",
  failed: "Failed",
};

/** A file picked but not yet uploaded, with the number it will be filed under. */
type Staged = { key: number; file: File; number: string; error: string | null };

type ParentInfo = {
  id: string;
  amendmentNumber: string;
  title: string;
};

export function AmendmentsPanel({
  solicitationId,
  parentSolicitation,
  amendments,
  maxBytes,
}: {
  solicitationId: string;
  parentSolicitation: ParentInfo | null;
  amendments: AmendmentListRow[];
  /** The server's per-file limit for documents. */
  maxBytes: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextKey = useRef(0);

  // BL-STAB-2c / BL-STAB-4 — each amendment goes straight to storage (no
  // size cap), two at a time, then is filed under this solicitation with
  // the number it was staged with.
  const queue = useUploadQueue<string, { number: string }>({
    purpose: "document",
    concurrency: 2,
    maxBytes,
    claim: async ({ uploadId, meta }) => {
      const res = await createSolicitationFromUploadAction({
        uploadId,
        parentSolicitationId: solicitationId,
        amendmentNumber: meta.number,
      });
      return res.ok ? { ok: true, result: res.id } : { ok: false, error: res.error };
    },
    onItemDone: (item) => {
      if (item.phase === "done") router.refresh();
    },
  });

  function stage(files: FileList | null) {
    const picked = Array.from(files ?? []).map<Staged>((file) => {
      const check = validateUploadRequest({ purpose: "document", fileName: file.name, size: file.size, maxBytes });
      return { key: nextKey.current++, file, number: amendmentNumberFromName(file.name), error: check.ok ? null : check.error };
    });
    setStaged((list) => [...list, ...picked]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function submitUpload() {
    const ready = staged.filter((s) => !s.error);
    if (ready.length === 0) {
      setError(staged.length ? "None of the picked files can be uploaded." : "Pick one or more files first.");
      return;
    }
    setError(null);
    queue.add(ready.map((s) => ({ file: s.file, meta: { number: s.number.trim().slice(0, 64) } })));
    setStaged((list) => list.filter((s) => s.error));
  }
  const pending = queue.busy;
  const readyCount = staged.filter((s) => !s.error).length;

  return (
    <Panel
      title="Amendments"
      eyebrow={
        parentSolicitation
          ? "This solicitation is itself an amendment"
          : `${amendments.length} child amendment${amendments.length === 1 ? "" : "s"}`
      }
      actions={
        parentSolicitation ? null : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            {open ? "Cancel" : "Add amendment"}
          </button>
        )
      }
    >
      {parentSolicitation ? (
        <div className="rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2 font-mono text-[11px]">
          <span className="text-amber-300">
            Amendment of:
          </span>{" "}
          <Link
            href={`/solicitations/${parentSolicitation.id}`}
            className="text-text underline"
          >
            {parentSolicitation.title || "Base solicitation"}
          </Link>
          <Link
            href={`/solicitations/${solicitationId}/diff`}
            className="ml-auto float-right text-teal underline"
          >
            View diff vs base →
          </Link>
        </div>
      ) : null}

      {open && !parentSolicitation ? (
        <div className="mb-3 rounded-md border border-teal/30 bg-teal/[0.04] p-3">
          <p className="font-body text-[12px] text-muted">
            Upload one or more amendments (e.g. Amendment 0001 from SAM.gov).
            Each number is read from its file name where it says one; check
            or type it before uploading. FORGE parses each amendment, then
            runs a diff so you can see exactly what changed: requirements
            added / removed / modified, due date slips, page-limit edits.
          </p>
          <div className="mt-3">
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={acceptFor("document")}
              onChange={(e) => stage(e.target.files)}
              className="aur-input text-[12px]"
            />
          </div>
          {staged.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {staged.map((s) => (
                <li key={s.key} className={`grid items-center gap-2 rounded-md border px-3 py-2 sm:grid-cols-[1fr_10rem_auto] ${s.error ? "border-rose/40 bg-rose/[0.05]" : "border-layer/15 bg-layer/[0.02]"}`}>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px] text-text" title={s.file.name}>
                      {s.file.name}
                    </div>
                    {s.error ? <div className="font-mono text-[11px] text-rose">{s.error}</div> : null}
                  </div>
                  <input
                    type="text"
                    aria-label={`Amendment number for ${s.file.name}`}
                    placeholder='Amendment # ("0001")'
                    value={s.number}
                    disabled={Boolean(s.error)}
                    onChange={(e) => {
                      const number = e.target.value;
                      setStaged((list) => list.map((x) => (x.key === s.key ? { ...x, number } : x)));
                    }}
                    className="aur-input text-[12px]"
                  />
                  <button
                    type="button"
                    className="aur-btn aur-btn-ghost text-[10px]"
                    onClick={() => setStaged((list) => list.filter((x) => x.key !== s.key))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          <div className="mt-2">
            <UploadQueue
              items={queue.items}
              onRetry={queue.retry}
              onCancel={queue.cancel}
              onRemove={queue.remove}
              detail={(it) => (it.meta.number ? `Amendment ${it.meta.number}` : "no number")}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={submitUpload}
              disabled={readyCount === 0}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50"
            >
              {readyCount > 1 ? `Upload ${readyCount} amendments` : "Upload amendment"}
              {pending ? " · uploading…" : ""}
            </button>
          </div>
        </div>
      ) : null}

      {amendments.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          {parentSolicitation
            ? "(no other amendments)"
            : "No amendments yet. Click “Add amendment” when a new mod drops."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {amendments.map((a) => {
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[12px] text-text">
                    {a.amendmentNumber
                      ? `Amendment ${a.amendmentNumber}`
                      : a.title || a.fileName}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted">
                    {a.fileName}
                    {a.responseDueDate
                      ? ` · due ${a.responseDueDate}`
                      : ""}
                    {" · "}uploaded {a.createdAt.slice(0, 10)}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${STATUS_CLASS[a.parseStatus] ?? STATUS_CLASS.uploaded}`}
                >
                  {STATUS_LABEL[a.parseStatus] ?? a.parseStatus}
                </span>
                {a.parseStatus === "parsed" ? (
                  <Link
                    href={`/solicitations/${a.id}/diff`}
                    className="shrink-0 font-mono text-[10px] text-teal underline"
                  >
                    Diff →
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
