"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import {
  renderComplianceCrosswalkAction,
  renderProposalDocxAction,
  renderProposalDocxAsPdfAction,
  renderProposalPdfAction,
  type DocxAsPdfResult,
  type DocxRenderActionResult,
  type PdfRenderResult,
  type RecentRenderRow,
} from "./actions";
import type { PdfProviderStatus, StorageProviderStatus } from "./status-types";

type ComplianceGate = {
  blocked: boolean;
  hasMatrix: boolean;
  totalItems: number;
  completeCount: number;
  partialCount: number;
  notAddressedCount: number;
  notApplicableCount: number;
  summary: string;
};

type SuccessResult = Extract<PdfRenderResult, { ok: true }>;
type DocxSuccess = Extract<DocxRenderActionResult, { ok: true }>;
type DocxPdfSuccess = Extract<DocxAsPdfResult, { ok: true }>;

type Props = {
  proposalId: string;
  initialRenders: RecentRenderRow[];
  pdfStatus: PdfProviderStatus;
  storageStatus: StorageProviderStatus;
  exportCapability: {
    hasDocxTemplate: boolean;
    hasHtmlTemplate: boolean;
    templateName: string;
  };
  complianceGate: ComplianceGate;
  docxToPdfProvider?: "cloudconvert" | "stub";
};

export function ExportPanel({
  proposalId,
  initialRenders,
  pdfStatus,
  storageStatus,
  exportCapability,
  complianceGate,
  docxToPdfProvider,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<SuccessResult | null>(null);
  const [recentDocx, setRecentDocx] = useState<DocxSuccess | null>(null);
  const [recentDocxPdf, setRecentDocxPdf] = useState<DocxPdfSuccess | null>(null);
  const [recentCrosswalk, setRecentCrosswalk] = useState<SuccessResult | null>(null);
  const [forceExport, setForceExport] = useState(false);

  function clearAll() {
    setError(null);
    setRecent(null);
    setRecentDocx(null);
    setRecentDocxPdf(null);
    setRecentCrosswalk(null);
  }

  function generate() {
    clearAll();
    startTransition(async () => {
      // When the template is a Word file, the "Download as PDF"
      // button hits the docx-to-pdf path so the user gets the same
      // header/footer/cover/TOC fidelity in their PDF.
      if (exportCapability.hasDocxTemplate) {
        const res = await renderProposalDocxAsPdfAction(proposalId, {
          forceExport,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setRecentDocxPdf(res);
        router.refresh();
        return;
      }
      const res = await renderProposalPdfAction(proposalId, { forceExport });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecent(res);
      router.refresh();
    });
  }

  function generateDocx() {
    clearAll();
    startTransition(async () => {
      const res = await renderProposalDocxAction(proposalId, { forceExport });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecentDocx(res);
      router.refresh();
    });
  }

  function generateCrosswalk() {
    clearAll();
    startTransition(async () => {
      const res = await renderComplianceCrosswalkAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecentCrosswalk(res);
      router.refresh();
    });
  }

  // Disable the proposal export buttons when the gate blocks AND the
  // user hasn't checked Force export.
  const exportDisabled =
    pending || (complianceGate.blocked && !forceExport);

  const stubMode = pdfStatus.name === "stub" || storageStatus.name === "memory";

  return (
    <Panel
      title="Export"
      eyebrow="Generate PDF"
      actions={
        stubMode ? (
          <StubModeBanner variant="pill" />
        ) : (
          <span className="rounded border border-emerald/40 bg-emerald/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald">
            live
          </span>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {stubMode ? (
          <StubModeBanner
            envVar="BROWSERLESS_API_KEY"
            message="Clicking Generate builds the rendered HTML using the proposal's template; the download is the HTML doc, not a real PDF."
          />
        ) : (
          <p className="font-body text-[12px] leading-relaxed text-muted">
            Live mode — clicking <span className="text-text">Generate</span>{" "}
            composes the proposal + template, hands the HTML to{" "}
            {pdfStatus.name === "browserless" ? "Browserless" : pdfStatus.name},
            and stores the result via{" "}
            {storageStatus.name === "r2" ? "Cloudflare R2" : storageStatus.name}.
          </p>
        )}

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        {/* BL-FB-CM-GATE — compliance status before the user clicks generate */}
        {complianceGate.hasMatrix ? (
          <div
            className={`rounded-md border px-3 py-2 font-mono text-[11px] ${
              complianceGate.blocked
                ? "border-rose/40 bg-rose/10 text-rose"
                : "border-emerald/40 bg-emerald/10 text-emerald"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-semibold uppercase tracking-wider">
                  {complianceGate.blocked
                    ? "Compliance gate blocking export"
                    : "Compliance gate clear"}
                </div>
                <div className="mt-0.5 text-[10px] opacity-90">
                  {complianceGate.summary}
                </div>
              </div>
              <Link
                href={`/proposals/${proposalId}/compliance`}
                className="shrink-0 underline hover:no-underline"
              >
                Open matrix →
              </Link>
            </div>
            {complianceGate.blocked ? (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px]">
                <input
                  type="checkbox"
                  checked={forceExport}
                  onChange={(e) => setForceExport(e.target.checked)}
                  className="accent-rose"
                />
                Force export anyway (acknowledges the matrix has gaps)
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {exportCapability.hasDocxTemplate ? (
            <button
              type="button"
              onClick={generateDocx}
              disabled={exportDisabled}
              className="aur-btn aur-btn-primary disabled:opacity-50"
              title={`Render via Word template "${exportCapability.templateName}"`}
            >
              {pending ? "Generating…" : "Download as Word"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={exportDisabled}
            className={`aur-btn ${exportCapability.hasDocxTemplate ? "aur-btn-ghost" : "aur-btn-primary"} disabled:opacity-50`}
          >
            {pending && !exportCapability.hasDocxTemplate
              ? "Generating…"
              : exportCapability.hasDocxTemplate
                ? "Download as PDF"
                : "Generate"}
          </button>
          {complianceGate.hasMatrix ? (
            <button
              type="button"
              onClick={generateCrosswalk}
              disabled={pending}
              className="aur-btn aur-btn-ghost disabled:opacity-50"
              title="Generate the Section L/M crosswalk PDF — ship this with your proposal submission"
            >
              {pending ? "Generating…" : "Crosswalk PDF"}
            </button>
          ) : null}
        </div>

        {!exportCapability.hasDocxTemplate &&
        !exportCapability.hasHtmlTemplate ? (
          <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] text-amber-200">
            No template assigned. Pick one under{" "}
            <Link href="/settings/templates" className="underline">
              Settings → Templates
            </Link>{" "}
            for a branded output.
          </div>
        ) : null}

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

        {recentDocx ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            <div>
              Word document ready —{" "}
              {Math.max(1, Math.round(recentDocx.byteSize / 1024))} KB.
            </div>
            <a
              href={recentDocx.downloadUrl}
              className="mt-1 inline-block text-emerald underline hover:no-underline"
            >
              Download .docx →
            </a>
          </div>
        ) : null}

        {recentCrosswalk ? (
          <div className="rounded-md border border-violet-400/40 bg-violet-400/10 px-3 py-2 font-mono text-[11px] text-violet-200">
            <div>
              Crosswalk{" "}
              {recentCrosswalk.contentType === "application/pdf" ? "PDF" : "HTML"}{" "}
              ready — {Math.max(1, Math.round(recentCrosswalk.byteSize / 1024))}{" "}
              KB.
            </div>
            <a
              href={recentCrosswalk.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-violet-200 underline hover:no-underline"
            >
              Download crosswalk →
            </a>
          </div>
        ) : null}

        {recentDocxPdf ? (
          <div
            className={`rounded-md border px-3 py-2 font-mono text-[11px] ${
              recentDocxPdf.stubbed
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-emerald/40 bg-emerald/10 text-emerald"
            }`}
          >
            <div>
              {recentDocxPdf.stubbed
                ? "DOCX→PDF in stub mode — set CLOUDCONVERT_API_KEY for real PDF. Downloading .docx for now."
                : `PDF ready (${recentDocxPdf.provider}) — ${Math.max(1, Math.round(recentDocxPdf.byteSize / 1024))} KB.`}
            </div>
            <a
              href={recentDocxPdf.downloadUrl}
              className={`mt-1 inline-block underline hover:no-underline ${
                recentDocxPdf.stubbed ? "text-amber-200" : "text-emerald"
              }`}
            >
              Download {recentDocxPdf.contentType === "pdf" ? ".pdf" : ".docx"} →
            </a>
          </div>
        ) : null}

        {exportCapability.hasDocxTemplate &&
        docxToPdfProvider === "stub" &&
        !recentDocxPdf ? (
          <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[10px] text-muted">
            DOCX→PDF conversion is in stub mode. Set{" "}
            <code className="text-text">CLOUDCONVERT_API_KEY</code> on Vercel to
            get real PDFs from your Word template.
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
                      {r.contentType === "pdf"
                        ? "PDF"
                        : r.contentType === "docx"
                          ? "DOCX"
                          : "HTML"}
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
