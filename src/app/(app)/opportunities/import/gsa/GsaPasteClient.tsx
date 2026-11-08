"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResultHead, ResultRow } from "@/components/scout/ResultRow";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { useUploadQueue } from "@/components/uploads/useUploadQueue";
import { PASTE_KEPT_CHARS, PASTE_MAX_CHARS, pasteRefusal } from "@/lib/action-body";
import { acceptFor, formatLimit } from "@/lib/upload-policy";
import {
  createOpportunityFromGsaAction,
  parseGsaTextAction,
} from "./actions";
import { GSA_MAX_ATTACHMENTS } from "./gsa-constants";
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

/**
 * BL-STAB-2d — attachments upload straight to storage as soon as they are
 * picked (each with its own progress, retry and cancel), so they are not
 * bound by a request's size; creating the opportunity then sends only
 * their ids, and the server files each one as a solicitation.
 */
export function GsaPasteClient({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [parsedOnce, setParsedOnce] = useState(false);
  const [stubbed, setStubbed] = useState(false);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{ opportunityId: string; skipped: { uploadId: string; name: string; reason: string }[] } | null>(null);
  const [parsing, startParse] = useTransition();
  const [creating, startCreate] = useTransition();
  const queue = useUploadQueue({ purpose: "document", maxBytes });
  // Files that didn't upload would be silently left out: retry or remove them first.
  const unfinished = queue.items.filter((it) => it.phase === "failed" || it.phase === "cancelled").length;

  function parse() {
    setError(null);
    // BL-STAB-2f — said here: a paste too large to send would fail with no explanation.
    const refusal = pasteRefusal(rawText, PASTE_MAX_CHARS, "Trim it to the email body (upload a full RFP as a solicitation instead).");
    if (refusal) return setError(refusal);
    startParse(async () => {
      let res: Awaited<ReturnType<typeof parseGsaTextAction>>;
      try {
        res = await parseGsaTextAction(rawText);
      } catch {
        setError("FORGE didn't answer. Try Extract again.");
        return;
      }
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
    const taken = queue.items.map((it) => it.file);
    const add: File[] = [];
    let over = 0;
    for (const f of Array.from(picked)) {
      // Skip duplicates by name+size — common when the user picks
      // files twice in a row by mistake.
      if ([...taken, ...add].some((existing) => existing.name === f.name && existing.size === f.size)) continue;
      if (taken.length + add.length >= GSA_MAX_ATTACHMENTS) over += 1;
      else add.push(f);
    }
    setNotice(over > 0 ? `${over} file${over === 1 ? "" : "s"} not added: at most ${GSA_MAX_ATTACHMENTS} attachments here. Once the opportunity is created, add the others as documents on one of its solicitations.` : null);
    queue.add(add.map((file) => ({ file, meta: undefined })));
  }

  function create() {
    setError(null);
    if (!fields.title.trim()) {
      setError("Title is required. Edit the field above before creating.");
      return;
    }
    startCreate(async () => {
      let res: Awaited<ReturnType<typeof createOpportunityFromGsaAction>>;
      try {
        res = await createOpportunityFromGsaAction({
          // The opportunity keeps this much of the email; the rest isn't sent.
          text: rawText.slice(0, PASTE_KEPT_CHARS),
          title: fields.title,
          noticeType: fields.noticeType,
          solicitationNumber: fields.solicitationNumber,
          buyingAgency: fields.buyingAgency,
          office: fields.office,
          vehicle: fields.vehicle,
          naicsCode: fields.naicsCode,
          setAside: fields.setAside,
          responseDueDate: fields.responseDueDate ?? "",
          placeOfPerformance: fields.placeOfPerformance,
          scopeSummary: fields.scopeSummary,
          notes: fields.notes,
          uploadIds: queue.readyUploadIds,
        });
      } catch {
        // It may have been created before the answer was lost: look before trying again.
        setError("FORGE didn't answer. Check Opportunities for this one before creating it again.");
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // BL-SCOUT-ONEPAGE — added from the Scout page: the row says so, with any attachment not filed.
      setCreated({ opportunityId: res.opportunityId, skipped: res.attachmentsSkipped });
      router.refresh();
    });
  }

  const days = fields.responseDueDate ? Math.ceil((new Date(fields.responseDueDate).getTime() - Date.now()) / 86_400_000) : null;
  const typeLabel = NOTICE_TYPES.find((t) => t.value === fields.noticeType)?.label ?? "";

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Paste a forwarded GSA email"
        eyebrow="With its attachments"
        actions={
          <button type="button" className="aur-btn aur-btn-primary disabled:opacity-60" onClick={parse} disabled={parsing || rawText.trim().length === 0}>
            {parsing ? "Extracting…" : "Extract with AI"}
          </button>
        }
      >
        <textarea
          className="aur-input min-h-[160px] w-full resize-y font-mono text-[12px] leading-relaxed"
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
        {error ? <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
        <div className="mt-4 border-t border-layer/10 pt-3">
          <div className="aur-label mb-1">Attachments · {queue.items.length} of {GSA_MAX_ATTACHMENTS} max</div>
        <div className="flex flex-col gap-2">
          <p className="font-body text-[12px] text-muted">
            Optional. If the email came with the RFP / RFQ as a PDF, drop it
            here. Each file uploads straight to secure storage, then becomes a
            Solicitation linked to the new opportunity, parsed in the
            background. Up to {GSA_MAX_ATTACHMENTS} files, {formatLimit(maxBytes)} each.
          </p>
          <input
            type="file"
            multiple
            accept={acceptFor("document")}
            disabled={queue.items.length >= GSA_MAX_ATTACHMENTS || creating || created !== null}
            onChange={(e) => {
              onFilesPicked(e.target.files);
              // Allow re-adding the same file after removing it.
              e.target.value = "";
            }}
            className="aur-input file:mr-3 file:rounded file:border-0 file:bg-layer/10 file:px-3 file:py-1 file:text-[12px] file:text-text"
          />
          {notice ? <div className="font-mono text-[11px] text-muted">{notice}</div> : null}
          <UploadQueue
            items={queue.items}
            onRetry={queue.retry}
            onCancel={queue.cancel}
            onRemove={queue.remove}
            // Once Create is pressed the list is what is being filed: no more changes.
            locked={creating || created !== null}
            detail={(it) => {
              if (!created || !it.uploadId) return "";
              return created.skipped.some((s) => s.uploadId === it.uploadId) ? "· not filed" : "· filed";
            }}
          />
        </div>
        </div>
      </Panel>

      {parsedOnce ? (
        <Panel title="Pasted" eyebrow="Check the fields, then add it">
          <ResultHead />
          <ul>
            <ResultRow
              key={created ? created.opportunityId : "pasted"}
              defaultOpen={!created || created.skipped.length > 0}
              call={{ label: "Pasted", tone: "none", title: "Read from the email you pasted; the AI reviews the scout's finds, not pastes" }}
              title={fields.title.trim() || "Untitled notice"}
              meta={[fields.buyingAgency, typeLabel, fields.vehicle, fields.solicitationNumber, fields.naicsCode ? `NAICS ${fields.naicsCode}` : "", fields.setAside].filter(Boolean).join(" · ")}
              source="GSA email"
              due={days === null ? null : days < 0 ? `${-days}d ago` : `${days}d`}
              dueSoon={days !== null && days < 5}
              fit={null}
              actions={
                created ? (
                  <Link href={`/opportunities/${created.opportunityId}`} className="font-mono text-[11px] text-cobalt hover:underline">
                    Open →
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="aur-btn aur-btn-primary disabled:opacity-60"
                    disabled={creating || fields.title.trim() === "" || queue.busy || unfinished > 0}
                    title={queue.busy ? "Wait for the attachments to finish uploading." : unfinished > 0 ? "Retry or remove the attachments that didn't upload." : undefined}
                    onClick={create}
                  >
                    {creating ? "Adding…" : queue.busy ? "Uploading…" : "Add to pipeline"}
                  </button>
                )
              }
              details={
                created ? (
                  created.skipped.length > 0 ? (
                    <div className="flex flex-col gap-1 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 font-mono text-[11px] text-text">
                      <span>
                        Added. {created.skipped.length} attachment{created.skipped.length === 1 ? " wasn't" : "s weren't"} filed with it:
                      </span>
                      <ul className="flex flex-col gap-0.5">
                        {created.skipped.map((s, i) => (
                          <li key={`${s.name}_${i}`}>
                            {s.name}: <span className="text-muted">{s.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="font-body text-[12px] text-muted">Added to the pipeline{queue.readyUploadIds.length > 0 ? " with its attachments, which are being read" : ""}.</p>
                  )
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
                )
              }
            />
          </ul>
        </Panel>
      ) : null}
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
      <span className="font-mono text-[10px] uppercase tracking-label text-muted">
        {label}
        {required ? <span className="ml-1 text-rose">*</span> : null}
      </span>
      {children}
    </label>
  );
}
