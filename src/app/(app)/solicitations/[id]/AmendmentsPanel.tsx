"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { uploadSolicitationAction } from "../actions";
import type { AmendmentListRow } from "../actions";

const STATUS_COLOR: Record<string, string> = {
  uploaded: "#9BC9D9",
  parsing: "#A78BFA",
  parsed: "#10B981",
  failed: "#EF4444",
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  parsing: "Parsing",
  parsed: "Parsed",
  failed: "Failed",
};

type ParentInfo = {
  id: string;
  amendmentNumber: string;
  title: string;
};

export function AmendmentsPanel({
  solicitationId,
  parentSolicitation,
  amendments,
}: {
  solicitationId: string;
  parentSolicitation: ParentInfo | null;
  amendments: AmendmentListRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [amendmentNumber, setAmendmentNumber] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function submitUpload() {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("parentSolicitationId", solicitationId);
    fd.append("amendmentNumber", amendmentNumber.trim());
    startTransition(async () => {
      const res = await uploadSolicitationAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFile(null);
      setAmendmentNumber("");
      setOpen(false);
      router.refresh();
    });
  }

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
            Upload an amendment (e.g. Amendment 0001 from SAM.gov). FORGE
            parses it independently, then runs a diff so you can see exactly
            what changed: requirements added / removed / modified, due date
            slips, page-limit edits.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.txt,.md,text/plain,text/markdown,image/jpeg,image/jpg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="aur-input text-[12px]"
            />
            <input
              type="text"
              placeholder='Amendment # (e.g. "0001")'
              value={amendmentNumber}
              onChange={(e) => setAmendmentNumber(e.target.value)}
              className="aur-input text-[12px] sm:w-40"
            />
          </div>
          {error ? (
            <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={submitUpload}
              disabled={pending || !file}
              className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50"
            >
              {pending ? "Uploading + parsing…" : "Upload amendment"}
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
            const statusColor = STATUS_COLOR[a.parseStatus] ?? "#9BC9D9";
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
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
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: statusColor,
                    backgroundColor: `${statusColor}1A`,
                    border: `1px solid ${statusColor}50`,
                  }}
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
