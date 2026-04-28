"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  createOpportunityFromEbuyAction,
  parseEbuyTextAction,
} from "./actions";
import type { EbuyExtractionResult } from "@/lib/ai-prompts";

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

  function set<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function parse() {
    setError(null);
    startParsing(async () => {
      const res = await parseEbuyTextAction(rawText);
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
      const res = await createOpportunityFromEbuyAction({
        ...fields,
        rawText,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/opportunities/${res.opportunityId}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
      <Panel
        title="Paste eBuy RFQ"
        eyebrow="Step 1 of 2"
        actions={
          <Link
            href="/opportunities/import"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            Back to SAM.gov import
          </Link>
        }
      >
        <p className="mb-3 font-mono text-[11px] text-muted">
          eBuy RFQs aren&rsquo;t indexed by SAM.gov. Open the RFQ in eBuy,
          select all, paste below — or paste the body of the eBuy notification
          email. The AI will extract the title, RFQ number, vehicle, due date,
          NAICS, set-aside, scope, and CLINs.
        </p>
        <textarea
          className="aur-input min-h-[280px] font-mono text-[12px] leading-relaxed"
          placeholder="Paste RFQ text here…"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          disabled={parsing || creating}
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            onClick={parse}
            disabled={parsing || rawText.trim().length === 0}
          >
            {parsing ? "Extracting…" : "Extract with AI"}
          </button>
          <span className="font-mono text-[10px] text-muted">
            {rawText.length.toLocaleString()} chars
          </span>
        </div>
        {stubbed ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-200">
            AI is in stub mode (provider: {provider}). Set
            <code className="mx-1 rounded bg-black/20 px-1">ANTHROPIC_API_KEY</code>
            on Vercel for live extraction. You can still fill the fields by
            hand and create the opportunity.
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
            disabled={!parsedOnce || creating || fields.title.trim() === ""}
            onClick={create}
          >
            {creating ? "Creating…" : "Create opportunity"}
          </button>
        }
      >
        {!parsedOnce ? (
          <div className="font-mono text-[11px] text-muted">
            Paste an RFQ on the left and click <strong>Extract with AI</strong>
            {" "}to populate these fields. You can edit before creating.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Title"
              value={fields.title}
              onChange={(v) => set("title", v)}
              span={2}
            />
            <Field
              label="RFQ number"
              value={fields.rfqNumber}
              onChange={(v) => set("rfqNumber", v)}
            />
            <Field
              label="Vehicle"
              value={fields.vehicle}
              onChange={(v) => set("vehicle", v)}
              placeholder="MAS / OASIS+ / Polaris…"
            />
            <Field
              label="Buying agency"
              value={fields.buyingAgency}
              onChange={(v) => set("buyingAgency", v)}
              span={2}
              placeholder="e.g., Department of Veterans Affairs"
            />
            <Field
              label="NAICS code"
              value={fields.naicsCode}
              onChange={(v) => set("naicsCode", v)}
            />
            <Field
              label="Set-aside"
              value={fields.setAside}
              onChange={(v) => set("setAside", v)}
            />
            <Field
              label="Response due (YYYY-MM-DD)"
              value={fields.responseDueDate ?? ""}
              onChange={(v) => set("responseDueDate", v || null)}
            />
            <Field
              label="Place of performance"
              value={fields.placeOfPerformance}
              onChange={(v) => set("placeOfPerformance", v)}
            />
            <TextArea
              label="Scope summary"
              value={fields.scopeSummary}
              onChange={(v) => set("scopeSummary", v)}
              span={2}
              rows={4}
            />
            <TextArea
              label="CLINs / line items"
              value={fields.clinSummary}
              onChange={(v) => set("clinSummary", v)}
              span={2}
              rows={3}
            />
            <TextArea
              label="Notes (page caps, eval, PoP)"
              value={fields.notes}
              onChange={(v) => set("notes", v)}
              span={2}
              rows={2}
            />
          </div>
        )}
      </Panel>
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
