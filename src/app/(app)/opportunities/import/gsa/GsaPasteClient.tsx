"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import {
  createOpportunityFromGsaAction,
  parseGsaTextAction,
} from "./actions";
import type { GsaExtractionResult } from "@/lib/ai-prompts";

type Fields = GsaExtractionResult;

const EMPTY: Fields = {
  title: "",
  noticeType: "other",
  solicitationNumber: "",
  buyingAgency: "",
  office: "",
  vehicle: "",
  naicsCode: "",
  setAside: "",
  responseDueDate: null,
  placeOfPerformance: "",
  scopeSummary: "",
  notes: "",
};

const NOTICE_TYPES: { value: string; label: string }[] = [
  { value: "rfp", label: "RFP" },
  { value: "rfq", label: "RFQ" },
  { value: "rfi", label: "RFI" },
  { value: "sources_sought", label: "Sources Sought" },
  { value: "task_order", label: "Task Order" },
  { value: "other", label: "Other" },
];

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function GsaPasteClient() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [parsedOnce, setParsedOnce] = useState(false);
  const [stubbed, setStubbed] = useState(false);
  const [provider, setProvider] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [parsing, startParse] = useTransition();
  const [creating, startCreate] = useTransition();

  function parse() {
    setError(null);
    startParse(async () => {
      const res = await parseGsaTextAction(rawText);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFields({
        ...res.data,
        responseDueDate: res.data.responseDueDate ?? null,
      });
      setParsedOnce(true);
      setStubbed(res.stubbed);
      setProvider(res.provider);
    });
  }

  function setField<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function onFilesPicked(picked: FileList | null) {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= MAX_ATTACHMENTS) break;
      // Skip duplicates by name+size — common when the user picks
      // files twice in a row by mistake.
      if (next.some((existing) => existing.name === f.name && existing.size === f.size)) {
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function create() {
    setError(null);
    if (!fields.title.trim()) {
      setError("Title is required. Edit the field above before creating.");
      return;
    }
    startCreate(async () => {
      const fd = new FormData();
      fd.set("text", rawText);
      fd.set("title", fields.title);
      fd.set("noticeType", fields.noticeType);
      fd.set("solicitationNumber", fields.solicitationNumber);
      fd.set("buyingAgency", fields.buyingAgency);
      fd.set("office", fields.office);
      fd.set("vehicle", fields.vehicle);
      fd.set("naicsCode", fields.naicsCode);
      fd.set("setAside", fields.setAside);
      fd.set("responseDueDate", fields.responseDueDate ?? "");
      fd.set("placeOfPerformance", fields.placeOfPerformance);
      fd.set("scopeSummary", fields.scopeSummary);
      fd.set("notes", fields.notes);
      for (const f of files) fd.append("files", f);

      const res = await createOpportunityFromGsaAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // If some attachments were skipped, surface that on the dest
      // page via a query flag the opportunity detail can read.
      const skipParam =
        res.attachmentsSkipped.length > 0
          ? `?attachmentsSkipped=${res.attachmentsSkipped.length}`
          : "";
      router.push(`/opportunities/${res.opportunityId}${skipParam}`);
    });
  }

  const totalAttachmentBytes = files.reduce((s, f) => s + f.size, 0);
  const totalAttachmentTooLarge = totalAttachmentBytes > MAX_ATTACHMENT_BYTES * MAX_ATTACHMENTS;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Panel
        title="Forwarded GSA email"
        eyebrow="Step 1 of 2"
        actions={
          <button
            type="button"
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            onClick={parse}
            disabled={parsing || rawText.trim().length === 0}
          >
            {parsing ? "Extracting…" : "Extract with AI"}
          </button>
        }
      >
        <textarea
          className="aur-input min-h-[260px] w-full resize-y font-mono text-[12px] leading-relaxed"
          placeholder={`Paste the full forwarded email body here.\n\nExamples we handle:\n- GSA eBuy RFQ notification or copy of the RFQ body\n- GSA Schedule sub-CO opportunity forward\n- OASIS+ / Polaris / Alliant 2 task order announcement\n- Sources sought or RFI emails`}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted">
          <span>{rawText.length.toLocaleString()} chars</span>
          {provider ? <span>provider: {provider}</span> : null}
        </div>

        {stubbed ? (
          <div className="mt-3">
            <StubModeBanner
              envVar="ANTHROPIC_API_KEY"
              message={`AI extraction is using the stub provider (${provider}). Field detection is heuristic, not model-driven. You can still fill the fields by hand and create the opportunity.`}
            />
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Review & confirm"
        eyebrow="Step 2 of 2"
        actions={
          <button
            type="button"
            className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
            disabled={
              !parsedOnce ||
              creating ||
              fields.title.trim() === "" ||
              totalAttachmentTooLarge
            }
            onClick={create}
          >
            {creating ? "Creating…" : "Create opportunity"}
          </button>
        }
      >
        {!parsedOnce ? (
          <div className="font-mono text-[11px] text-muted">
            Paste the email body and click <strong>Extract with AI</strong> to
            populate these fields. You can edit anything before creating.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <Field label="Title" required>
              <input
                className="aur-input"
                value={fields.title}
                onChange={(e) => setField("title", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Notice type">
                <select
                  className="aur-input"
                  value={fields.noticeType}
                  onChange={(e) => setField("noticeType", e.target.value)}
                >
                  {NOTICE_TYPES.map((nt) => (
                    <option key={nt.value} value={nt.value}>
                      {nt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Solicitation #">
                <input
                  className="aur-input"
                  value={fields.solicitationNumber}
                  onChange={(e) =>
                    setField("solicitationNumber", e.target.value)
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Buying agency">
                <input
                  className="aur-input"
                  value={fields.buyingAgency}
                  onChange={(e) => setField("buyingAgency", e.target.value)}
                />
              </Field>
              <Field label="Office">
                <input
                  className="aur-input"
                  value={fields.office}
                  onChange={(e) => setField("office", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vehicle">
                <input
                  className="aur-input"
                  value={fields.vehicle}
                  onChange={(e) => setField("vehicle", e.target.value)}
                  placeholder="MAS, Polaris, OASIS+…"
                />
              </Field>
              <Field label="NAICS">
                <input
                  className="aur-input"
                  value={fields.naicsCode}
                  onChange={(e) => setField("naicsCode", e.target.value)}
                />
              </Field>
              <Field label="Set-aside">
                <input
                  className="aur-input"
                  value={fields.setAside}
                  onChange={(e) => setField("setAside", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Response due">
                <input
                  type="date"
                  className="aur-input"
                  value={fields.responseDueDate ?? ""}
                  onChange={(e) =>
                    setField("responseDueDate", e.target.value || null)
                  }
                />
              </Field>
              <Field label="Place of performance">
                <input
                  className="aur-input"
                  value={fields.placeOfPerformance}
                  onChange={(e) =>
                    setField("placeOfPerformance", e.target.value)
                  }
                />
              </Field>
            </div>
            <Field label="Scope summary">
              <textarea
                className="aur-input min-h-[100px] resize-y"
                value={fields.scopeSummary}
                onChange={(e) => setField("scopeSummary", e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <textarea
                className="aur-input min-h-[60px] resize-y"
                value={fields.notes}
                onChange={(e) => setField("notes", e.target.value)}
              />
            </Field>
          </div>
        )}
      </Panel>

      {/* Attachments span the full width — they're optional and may
          run to several rows once files are picked. */}
      <Panel
        title="Attachments"
        eyebrow={`${files.length} of ${MAX_ATTACHMENTS} max`}
        className="xl:col-span-2"
      >
        <div className="flex flex-col gap-2">
          <p className="font-body text-[12px] text-muted">
            Optional. If the email came with the RFP / RFQ as a PDF, drop it
            here. Each attached file becomes a Solicitation linked to the new
            opportunity, parsed in the background. Up to {MAX_ATTACHMENTS} files,{" "}
            {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each.
          </p>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,image/*"
            disabled={files.length >= MAX_ATTACHMENTS}
            onChange={(e) => {
              onFilesPicked(e.target.files);
              // Allow re-adding the same file after removing it.
              e.target.value = "";
            }}
            className="aur-input file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-[12px] file:text-text"
          />
          {files.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}_${f.size}_${i}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[11px]"
                >
                  <div className="min-w-0 flex-1 truncate text-text">
                    {f.name}
                  </div>
                  <span className="shrink-0 text-muted">
                    {(f.size / 1024).toFixed(0)} kB
                    {f.size > MAX_ATTACHMENT_BYTES ? (
                      <span className="ml-2 text-rose">
                        too large
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-muted hover:text-text"
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
  );
}
