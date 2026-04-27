"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  renderProposalPdfAction,
  type PdfRenderResult,
  type RecentRenderRow,
} from "./actions";
import type { PdfProviderStatus, StorageProviderStatus } from "./status-types";

type SuccessResult = Extract<PdfRenderResult, { ok: true }>;

type Props = {
  proposalId: string;
  initialRenders: RecentRenderRow[];
  pdfStatus: PdfProviderStatus;
  storageStatus: StorageProviderStatus;
};

export function ExportPanel({
  proposalId,
  initialRenders,
  pdfStatus,
  storageStatus,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<SuccessResult | null>(null);

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await renderProposalPdfAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecent(res);
      router.refresh();
    });
  }

  const stubMode = pdfStatus.name === "stub" || storageStatus.name === "memory";

  return (
    <Panel
      title="Export"
      eyebrow="Generate PDF"
      actions={
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
            stubMode
              ? "border border-rose/40 bg-rose/10 text-rose"
              : "border border-emerald/40 bg-emerald/10 text-emerald"
          }`}
        >
          {stubMode ? "stub" : "live"}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="font-body text-[12px] leading-relaxed text-muted">
          {stubMode ? (
            <>
              Stub mode — clicking <span className="text-text">Generate</span>{" "}
              builds the rendered HTML using the proposal's template; the
              download is the HTML doc, not a PDF. Set{" "}
              <code className="text-teal">BROWSERLESS_API_KEY</code> on Vercel
              to flip to real PDFs.
            </>
          ) : (
            <>
              Live mode — clicking <span className="text-text">Generate</span>{" "}
              composes the proposal + template, hands the HTML to{" "}
              {pdfStatus.name === "browserless" ? "Browserless" : pdfStatus.name},
              and stores the result via{" "}
              {storageStatus.name === "r2" ? "Cloudflare R2" : storageStatus.name}.
            </>
          )}
        </p>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="aur-btn aur-btn-primary"
        >
          {pending ? "Generating…" : "Generate"}
        </button>

        {recent ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            <div>
              {recent.contentType === "application/pdf" ? "PDF" : "HTML"} ready —{" "}
              {Math.max(1, Math.round(recent.byteSize / 1024))} KB.
            </div>
            <a
              href={recent.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-emerald underline hover:no-underline"
            >
              Download →
            </a>
          </div>
        ) : null}

        <div className="border-t border-white/10 pt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Recent renders
          </div>
          {initialRenders.length === 0 ? (
            <div className="mt-2 font-mono text-[11px] text-muted">
              No renders yet.
            </div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {initialRenders.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5 font-mono text-[10px] text-muted"
                >
                  <div className="min-w-0 flex-1 truncate">
                    <span className="text-text">
                      {r.contentType === "pdf" ? "PDF" : "HTML"}
                    </span>{" "}
                    · {Math.max(1, Math.round(r.byteSize / 1024))}KB ·{" "}
                    {new Date(r.renderedAt).toLocaleString()}
                    {r.authorName || r.authorEmail ? (
                      <span className="text-subtle">
                        {" "}
                        · {r.authorName ?? r.authorEmail}
                      </span>
                    ) : null}
                    {r.provider === "stub" ? (
                      <span className="text-rose"> · stub</span>
                    ) : null}
                  </div>
                  <Link
                    href={r.downloadUrl}
                    className="uppercase tracking-widest text-muted hover:text-text"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
