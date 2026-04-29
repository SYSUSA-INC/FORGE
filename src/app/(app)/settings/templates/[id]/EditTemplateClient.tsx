"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type {
  ProposalSectionKind,
  ProposalTemplateKind,
  TemplateSectionSeed,
} from "@/db/schema";
import { SECTION_KIND_LABELS } from "@/lib/proposal-types";
import { KNOWN_TEMPLATE_VARIABLES } from "@/lib/docx-template";
import {
  clearTemplateDocxAction,
  setDefaultTemplateAction,
  setTemplateKindAction,
  updateTemplateAction,
  uploadTemplateDocxAction,
} from "../actions";

const SECTION_KINDS: ProposalSectionKind[] = [
  "executive_summary",
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
];

type Initial = {
  name: string;
  description: string;
  kind: ProposalTemplateKind;
  coverHtml: string;
  headerHtml: string;
  footerHtml: string;
  pageCss: string;
  docxFileName: string;
  docxFileSize: number;
  docxUploadedAt: string | null;
  variablesDetected: string[];
  sectionSeed: TemplateSectionSeed[];
  brandPrimary: string;
  brandAccent: string;
  fontDisplay: string;
  fontBody: string;
  logoUrl: string;
  isDefault: boolean;
  archivedAt: string | null;
};

export function EditTemplateClient({
  id,
  initial,
}: {
  id: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [brandPrimary, setBrandPrimary] = useState(initial.brandPrimary);
  const [brandAccent, setBrandAccent] = useState(initial.brandAccent);
  const [fontDisplay, setFontDisplay] = useState(initial.fontDisplay);
  const [fontBody, setFontBody] = useState(initial.fontBody);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [coverHtml, setCoverHtml] = useState(initial.coverHtml);
  const [headerHtml, setHeaderHtml] = useState(initial.headerHtml);
  const [footerHtml, setFooterHtml] = useState(initial.footerHtml);
  const [pageCss, setPageCss] = useState(initial.pageCss);
  const [seed, setSeed] = useState<TemplateSectionSeed[]>(initial.sectionSeed);

  const [kind, setKind] = useState<ProposalTemplateKind>(initial.kind);
  const [docxFileName, setDocxFileName] = useState(initial.docxFileName);
  const [docxFileSize, setDocxFileSize] = useState(initial.docxFileSize);
  const [docxUploadedAt, setDocxUploadedAt] = useState<string | null>(
    initial.docxUploadedAt,
  );
  const [variablesDetected, setVariablesDetected] = useState<string[]>(
    initial.variablesDetected,
  );
  const [docxWarnings, setDocxWarnings] = useState<string[]>([]);
  const [uploading, startUploading] = useTransition();
  const [docxError, setDocxError] = useState<string | null>(null);
  const [docxNotice, setDocxNotice] = useState<string | null>(null);

  function handleDocxFile(file: File | null | undefined) {
    if (!file) return;
    setDocxError(null);
    setDocxNotice(null);
    setDocxWarnings([]);
    const fd = new FormData();
    fd.append("file", file);
    startUploading(async () => {
      const res = await uploadTemplateDocxAction(id, fd);
      if (!res.ok) {
        setDocxError(res.error);
        return;
      }
      setKind("docx");
      setDocxFileName(res.fileName);
      setDocxFileSize(res.fileSize);
      setDocxUploadedAt(new Date().toISOString());
      setVariablesDetected(res.variables);
      setDocxWarnings(res.warnings);
      setDocxNotice(
        res.variables.length > 0
          ? `Uploaded — found ${res.variables.length} placeholder${res.variables.length === 1 ? "" : "s"}.`
          : "Uploaded. No placeholders detected — see warnings below.",
      );
    });
  }

  async function clearDocx() {
    if (
      !window.confirm(
        "Remove the uploaded Word template? You can upload another after.",
      )
    ) {
      return;
    }
    setDocxError(null);
    setDocxNotice(null);
    setDocxWarnings([]);
    startUploading(async () => {
      await clearTemplateDocxAction(id);
      setDocxFileName("");
      setDocxFileSize(0);
      setDocxUploadedAt(null);
      setVariablesDetected([]);
      setDocxNotice("Removed.");
    });
  }

  async function switchKind(next: ProposalTemplateKind) {
    setDocxError(null);
    setDocxNotice(null);
    startUploading(async () => {
      const res = await setTemplateKindAction(id, next);
      if (!("ok" in res) || res.ok !== true) {
        setDocxError("error" in res ? res.error : "Could not switch mode.");
        return;
      }
      setKind(next);
      setDocxNotice(
        next === "docx"
          ? "Switched to Word template mode."
          : "Switched to legacy HTML/CSS mode.",
      );
    });
  }

  function updateSeedItem(idx: number, patch: Partial<TemplateSectionSeed>) {
    setSeed((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }
  function moveSeedItem(idx: number, dir: -1 | 1) {
    setSeed((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target]!, copy[idx]!];
      return copy.map((s, i) => ({ ...s, ordering: i + 1 }));
    });
  }
  function removeSeedItem(idx: number) {
    setSeed((prev) =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, ordering: i + 1 })),
    );
  }
  function addSeedItem() {
    setSeed((prev) => [
      ...prev,
      {
        kind: "technical",
        title: "New section",
        ordering: prev.length + 1,
        pageLimit: null,
      },
    ]);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await updateTemplateAction(id, {
        name,
        description,
        brandPrimary,
        brandAccent,
        fontDisplay,
        fontBody,
        logoUrl,
        coverHtml,
        headerHtml,
        footerHtml,
        pageCss,
        sectionSeed: seed,
      });
      if (!res.ok) return setError(res.error);
      setNotice("Saved.");
      router.refresh();
    });
  }

  function makeDefault() {
    startTransition(async () => {
      const res = await setDefaultTemplateAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <form className="grid gap-4 xl:grid-cols-[1.6fr_1fr]" onSubmit={save}>
      <div className="flex flex-col gap-4">
        <Panel
          title="Identity"
          eyebrow="Authors see this on /proposals/new"
          actions={
            initial.isDefault ? (
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest"
                style={{
                  color: brandPrimary,
                  backgroundColor: `${brandPrimary}1A`,
                  border: `1px solid ${brandPrimary}50`,
                }}
              >
                Default
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={makeDefault}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Set as default
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-name">
                Name
              </label>
              <input
                id="t-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="aur-input"
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="t-logo">
                Logo URL
              </label>
              <input
                id="t-logo"
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="aur-input"
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="aur-label" htmlFor="t-desc">
              Description
            </label>
            <textarea
              id="t-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="aur-input min-h-[60px] resize-y"
            />
          </div>
        </Panel>

        <Panel title="Section seed" eyebrow="Default sections seeded for new proposals">
          <ul className="flex flex-col gap-2">
            {seed.map((s, i) => (
              <li
                key={i}
                className="flex flex-wrap items-end gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                  §{s.ordering}
                </span>
                <div className="min-w-[140px] flex-1">
                  <label className="aur-label">Kind</label>
                  <select
                    className="aur-input text-[12px]"
                    value={s.kind}
                    onChange={(e) =>
                      updateSeedItem(i, {
                        kind: e.target.value as ProposalSectionKind,
                      })
                    }
                  >
                    {SECTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {SECTION_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[200px] flex-[2]">
                  <label className="aur-label">Title</label>
                  <input
                    type="text"
                    className="aur-input text-[12px]"
                    value={s.title}
                    onChange={(e) =>
                      updateSeedItem(i, { title: e.target.value })
                    }
                  />
                </div>
                <div className="w-20">
                  <label className="aur-label">Page cap</label>
                  <input
                    type="number"
                    min={0}
                    className="aur-input text-[12px]"
                    value={s.pageLimit ?? ""}
                    onChange={(e) =>
                      updateSeedItem(i, {
                        pageLimit:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex items-end gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => moveSeedItem(i, -1)}
                    className="rounded px-2 py-1 hover:bg-white/[0.05] hover:text-text disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => moveSeedItem(i, 1)}
                    className="rounded px-2 py-1 hover:bg-white/[0.05] hover:text-text disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeSeedItem(i)}
                    className="rounded px-2 py-1 hover:bg-rose/10 hover:text-rose disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <button
              type="button"
              onClick={addSeedItem}
              disabled={pending}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              + Add section
            </button>
          </div>
        </Panel>

        <Panel
          title="Template source"
          eyebrow={kind === "docx" ? "Word template" : "Legacy HTML / CSS"}
          actions={
            <div className="inline-flex rounded-full border border-white/10 p-0.5 text-[10px]">
              {(["docx", "html"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchKind(k)}
                  disabled={uploading || k === kind}
                  className={`rounded-full px-2.5 py-0.5 font-mono uppercase tracking-widest transition-colors disabled:opacity-100 ${
                    kind === k
                      ? "bg-teal-400/15 text-teal"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {k === "docx" ? "Word" : "HTML/CSS (legacy)"}
                </button>
              ))}
            </div>
          }
        >
          {kind === "docx" ? (
            <DocxPanel
              docxFileName={docxFileName}
              docxFileSize={docxFileSize}
              docxUploadedAt={docxUploadedAt}
              variablesDetected={variablesDetected}
              docxWarnings={docxWarnings}
              uploading={uploading}
              error={docxError}
              notice={docxNotice}
              onFile={handleDocxFile}
              onClear={clearDocx}
            />
          ) : (
            <details className="flex flex-col gap-3" open>
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                Legacy HTML/CSS panels — kept for templates created before
                Word-template support
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <label className="aur-label" htmlFor="t-cover">
                    Cover HTML
                  </label>
                  <textarea
                    id="t-cover"
                    rows={6}
                    value={coverHtml}
                    onChange={(e) => setCoverHtml(e.target.value)}
                    className="aur-input min-h-[120px] resize-y font-mono text-[12px]"
                  />
                  <p className="mt-1 font-mono text-[10px] text-subtle">
                    Variables: <code>{`{{organizationName}}`}</code>, <code>{`{{proposalTitle}}`}</code>, <code>{`{{solicitationNumber}}`}</code>, <code>{`{{agency}}`}</code>, <code>{`{{submittedDate}}`}</code>, <code>{`{{logoUrl}}`}</code>.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="aur-label" htmlFor="t-header">
                      Page header HTML
                    </label>
                    <textarea
                      id="t-header"
                      rows={3}
                      value={headerHtml}
                      onChange={(e) => setHeaderHtml(e.target.value)}
                      className="aur-input min-h-[80px] resize-y font-mono text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="aur-label" htmlFor="t-footer">
                      Page footer HTML
                    </label>
                    <textarea
                      id="t-footer"
                      rows={3}
                      value={footerHtml}
                      onChange={(e) => setFooterHtml(e.target.value)}
                      className="aur-input min-h-[80px] resize-y font-mono text-[12px]"
                    />
                  </div>
                </div>
                <div>
                  <label className="aur-label" htmlFor="t-css">
                    Page CSS
                  </label>
                  <textarea
                    id="t-css"
                    rows={10}
                    value={pageCss}
                    onChange={(e) => setPageCss(e.target.value)}
                    className="aur-input min-h-[200px] resize-y font-mono text-[12px]"
                  />
                </div>
              </div>
            </details>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Branding">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-brand-primary">
                Primary
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="t-brand-primary"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
                <input
                  type="text"
                  className="aur-input flex-1 font-mono text-[12px]"
                  value={brandPrimary}
                  onChange={(e) => setBrandPrimary(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="aur-label" htmlFor="t-brand-accent">
                Accent
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="t-brand-accent"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                  value={brandAccent}
                  onChange={(e) => setBrandAccent(e.target.value)}
                />
                <input
                  type="text"
                  className="aur-input flex-1 font-mono text-[12px]"
                  value={brandAccent}
                  onChange={(e) => setBrandAccent(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label" htmlFor="t-font-display">
                Display font
              </label>
              <input
                id="t-font-display"
                type="text"
                className="aur-input"
                value={fontDisplay}
                onChange={(e) => setFontDisplay(e.target.value)}
              />
            </div>
            <div>
              <label className="aur-label" htmlFor="t-font-body">
                Body font
              </label>
              <input
                id="t-font-body"
                type="text"
                className="aur-input"
                value={fontBody}
                onChange={(e) => setFontBody(e.target.value)}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Preview" eyebrow="Static placeholder" dense>
          <div
            className="rounded-md border p-4"
            style={{
              borderColor: `${brandPrimary}40`,
              background: `${brandPrimary}06`,
            }}
          >
            <div
              className="mb-2 font-mono text-[10px] uppercase tracking-widest"
              style={{ color: brandPrimary }}
            >
              {fontDisplay}
            </div>
            <div
              className="font-display text-[18px] font-semibold"
              style={{ color: brandPrimary, fontFamily: fontDisplay }}
            >
              {name || "Untitled template"}
            </div>
            <p
              className="mt-2 font-body text-[12px] leading-relaxed text-muted"
              style={{ fontFamily: fontBody }}
            >
              {description || "Description shows here for the team picking this template on /proposals/new."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {seed.map((s, i) => (
                <span
                  key={i}
                  className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                  style={{
                    color: brandAccent,
                    backgroundColor: `${brandAccent}14`,
                    border: `1px solid ${brandAccent}40`,
                  }}
                >
                  §{s.ordering} {s.title}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {notice}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/settings/templates"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            Back
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="aur-btn aur-btn-primary"
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </form>
  );
}


function DocxPanel({
  docxFileName,
  docxFileSize,
  docxUploadedAt,
  variablesDetected,
  docxWarnings,
  uploading,
  error,
  notice,
  onFile,
  onClear,
}: {
  docxFileName: string;
  docxFileSize: number;
  docxUploadedAt: string | null;
  variablesDetected: string[];
  docxWarnings: string[];
  uploading: boolean;
  error: string | null;
  notice: string | null;
  onFile: (f: File | null | undefined) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const known = new Set(KNOWN_TEMPLATE_VARIABLES.map((v) => v.key));
  const recognized: string[] = [];
  const unrecognized: string[] = [];
  for (const v of variablesDetected) {
    const trimmed = v.replace(/^[#\/^]/, "");
    if (known.has(trimmed)) recognized.push(v);
    else unrecognized.push(v);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={`grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-teal-400 bg-teal-400/5"
            : "border-white/15 bg-white/[0.015] hover:border-white/30"
        }`}
      >
        {docxFileName ? (
          <>
            <div className="font-display text-lg font-semibold text-text">
              {docxFileName}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              {Math.max(1, Math.round(docxFileSize / 1024))} KB · uploaded{" "}
              {docxUploadedAt
                ? new Date(docxUploadedAt).toLocaleDateString()
                : ""}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                disabled={uploading}
                className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
              >
                Replace file
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                disabled={uploading}
                className="aur-btn aur-btn-ghost text-[11px] text-rose-300 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-2xl font-semibold text-text">
              Drop a Word template here
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              .docx · 25 MB cap · header / footer / cover / TOC / graphics
              all preserved
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              disabled={uploading}
              className="aur-btn aur-btn-primary mt-4 disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Select Word file"}
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      {variablesDetected.length > 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.015] p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Detected placeholders
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                FORGE will fill ({recognized.length})
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {recognized.length === 0 ? (
                  <span className="font-mono text-[10px] text-muted">
                    None recognized.
                  </span>
                ) : (
                  recognized.map((v) => (
                    <code
                      key={v}
                      className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
                    >
                      {v}
                    </code>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-amber-200">
                You'll fill manually ({unrecognized.length})
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {unrecognized.length === 0 ? (
                  <span className="font-mono text-[10px] text-muted">
                    None — all detected variables are recognized.
                  </span>
                ) : (
                  unrecognized.map((v) => (
                    <code
                      key={v}
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200"
                      title="Not a known FORGE variable — leave a placeholder note in the doc, or rename to a known key."
                    >
                      {v}
                    </code>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {docxWarnings.length > 0 ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] text-amber-200">
          <div className="mb-1 font-semibold uppercase tracking-widest">
            Warnings
          </div>
          <ul className="list-disc pl-4">
            {docxWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="rounded-lg border border-white/10 bg-white/[0.015] p-3">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Available placeholders ({KNOWN_TEMPLATE_VARIABLES.length}) — drop
          these into your Word template using <code>&#123;variableName&#125;</code>
        </summary>
        <ul className="mt-3 grid grid-cols-1 gap-1 md:grid-cols-2">
          {KNOWN_TEMPLATE_VARIABLES.map((v) => (
            <li
              key={v.key}
              className="flex items-center justify-between gap-2 rounded border border-white/5 bg-white/[0.01] px-2 py-1 font-mono text-[10px]"
            >
              <code className="text-text">&#123;{v.key}&#125;</code>
              <span className="text-muted">{v.description}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-[10px] text-muted">
          Loop pattern for proposal sections:{" "}
          <code>&#123;#sections&#125;&#123;title&#125; &#123;body&#125;&#123;/sections&#125;</code>
          {" "}— each section in the proposal will repeat this block.
        </p>
        <p className="mt-2 font-mono text-[10px] text-muted">
          For rich Word formatting (headings, bold, lists from the editor),
          use{" "}
          <code>&#123;#sections&#125;&#123;title&#125; &#123;@bodyXml&#125;&#123;/sections&#125;</code>
          {" "}instead of <code>&#123;body&#125;</code>. The <code>@</code>{" "}
          prefix injects raw OOXML; without it, formatting is stripped to
          plain text.
        </p>
      </details>

      <div className="rounded-md border border-white/10 bg-white/[0.015] px-3 py-2 font-mono text-[10px] text-muted">
        Note: rendering will run on download in Phase 12b. For now, the
        upload + variable detection ensures the template is well-formed.
      </div>
    </div>
  );
}
