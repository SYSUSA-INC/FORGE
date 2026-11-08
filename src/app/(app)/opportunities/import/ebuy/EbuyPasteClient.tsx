"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResultHead, ResultRow } from "@/components/scout/ResultRow";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import {
  createOpportunityFromEbuyAction,
  parseEbuyTextAction,
} from "./actions";
import type { EbuyExtractionResult } from "@/lib/ai-prompts";
import { PASTE_KEPT_CHARS, PASTE_MAX_CHARS, pasteRefusal } from "@/lib/action-body";

type FormFields = EbuyExtractionResult;

const EMPTY: FormFields = {
  title: "",
  rfqNumber: "",
  buyingAgency: "",
  vehicle: "",
  naicsCode: "",
  setAside: "",
  responseDueDate: null,
  placeOfPerformance: "",
  scopeSummary: "",
  clinSummary: "",
  notes: "",
};

export function EbuyPasteClient() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [fields, setFields] = useState<FormFields>(EMPTY);
  const [parsedOnce, setParsedOnce] = useState(false);
  const [stubbed, setStubbed] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [parsing, startParsing] = useTransition();
  const [creating, startCreating] = useTransition();
  // BL-SCOUT-ONEPAGE — added from the Scout page: the row says so and links to it.
  const [added, setAdded] = useState<string | null>(null);

  function set<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function parse() {
    setError(null);
    // BL-STAB-2f — said here: a paste too large to send would fail with no explanation.
    const refusal = pasteRefusal(rawText, PASTE_MAX_CHARS, "Trim it to the RFQ body (upload a full RFP as a solicitation instead).");
    if (refusal) return setError(refusal);
    startParsing(async () => {
      let res: Awaited<ReturnType<typeof parseEbuyTextAction>>;
      try {
        res = await parseEbuyTextAction(rawText);
      } catch {
        setError("FORGE didn't answer. Try Extract again.");
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFields(res.data);
      setParsedOnce(true);
      setStubbed(res.stubbed);
      setProvider(res.provider);
    });
  }

  function create() {
    setError(null);
    startCreating(async () => {
      let res: Awaited<ReturnType<typeof createOpportunityFromEbuyAction>>;
      try {
        res = await createOpportunityFromEbuyAction({
          ...fields,
          // The opportunity keeps this much of the RFQ; the rest isn't sent.
          rawText: rawText.slice(0, PASTE_KEPT_CHARS),
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
      setAdded(res.opportunityId);
      router.refresh();
    });
  }

  function another() {
    setRawText("");
    setFields(EMPTY);
    setParsedOnce(false);
    setAdded(null);
    setError(null);
  }

  const days = fields.responseDueDate ? Math.ceil((new Date(fields.responseDueDate).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Paste an eBuy RFQ" eyebrow="eBuy has no public API">
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          Open the RFQ in eBuy, select all and paste it below, or paste the body of the eBuy notification email. The AI extracts the title, RFQ number, vehicle, due date, NAICS, set-aside, scope and CLINs into a row below, where you check them and add it to the pipeline.
        </p>
        <textarea
          className="aur-input min-h-[160px] font-mono text-[12px] leading-relaxed"
          placeholder="Paste RFQ text here…"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          disabled={parsing || creating}
        />
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60" onClick={parse} disabled={parsing || rawText.trim().length === 0}>
            {parsing ? "Extracting…" : "Extract with AI"}
          </button>
          <span className="font-mono text-[10px] text-muted">{rawText.length.toLocaleString()} chars</span>
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
      </Panel>

      {parsedOnce ? (
        <Panel title="Pasted" eyebrow="Check the fields, then add it">
          <ResultHead />
          <ul>
            <ResultRow
              key={added ?? "pasted"}
              defaultOpen={!added}
              call={{ label: "Pasted", tone: "none", title: "Read from the RFQ you pasted; the AI reviews the scout's finds, not pastes" }}
              title={fields.title.trim() || "Untitled RFQ"}
              meta={[fields.buyingAgency, fields.vehicle, fields.rfqNumber, fields.naicsCode ? `NAICS ${fields.naicsCode}` : "", fields.setAside].filter(Boolean).join(" · ")}
              source="GSA eBuy"
              due={days === null ? null : days < 0 ? `${-days}d ago` : `${days}d`}
              dueSoon={days !== null && days < 5}
              fit={null}
              actions={
                added ? (
                  <span className="flex items-center gap-3">
                    <Link href={`/opportunities/${added}`} className="font-mono text-[11px] text-cobalt hover:underline">
                      Open →
                    </Link>
                    <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={another}>
                      Paste another
                    </button>
                  </span>
                ) : (
                  <button type="button" className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60" disabled={creating || fields.title.trim() === ""} onClick={create}>
                    {creating ? "Adding…" : "Add to pipeline"}
                  </button>
                )
              }
              details={
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Title" value={fields.title} onChange={(v) => set("title", v)} span={2} />
                  <Field label="RFQ number" value={fields.rfqNumber} onChange={(v) => set("rfqNumber", v)} />
                  <Field label="Vehicle" value={fields.vehicle} onChange={(v) => set("vehicle", v)} placeholder="MAS / OASIS+ / Polaris…" />
                  <Field label="Buying agency" value={fields.buyingAgency} onChange={(v) => set("buyingAgency", v)} span={2} placeholder="e.g., Department of Veterans Affairs" />
                  <Field label="NAICS code" value={fields.naicsCode} onChange={(v) => set("naicsCode", v)} />
                  <Field label="Set-aside" value={fields.setAside} onChange={(v) => set("setAside", v)} />
                  <Field label="Response due (YYYY-MM-DD)" value={fields.responseDueDate ?? ""} onChange={(v) => set("responseDueDate", v || null)} />
                  <Field label="Place of performance" value={fields.placeOfPerformance} onChange={(v) => set("placeOfPerformance", v)} />
                  <TextArea label="Scope summary" value={fields.scopeSummary} onChange={(v) => set("scopeSummary", v)} span={2} rows={4} />
                  <TextArea label="CLINs / line items" value={fields.clinSummary} onChange={(v) => set("clinSummary", v)} span={2} rows={3} />
                  <TextArea label="Notes (page caps, eval, PoP)" value={fields.notes} onChange={(v) => set("notes", v)} span={2} rows={2} />
                </div>
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
  value,
  onChange,
  placeholder,
  span = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? "md:col-span-2" : ""}>
      <label className="aur-label">{label}</label>
      <input
        className="aur-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  span = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  span?: 1 | 2;
}) {
  return (
    <div className={span === 2 ? "md:col-span-2" : ""}>
      <label className="aur-label">{label}</label>
      <textarea
        className="aur-input font-mono text-[12px] leading-relaxed"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
      />
    </div>
  );
}
