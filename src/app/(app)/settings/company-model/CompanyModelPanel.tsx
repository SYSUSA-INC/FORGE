"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  CAPABILITY_STRENGTHS,
  COMPANY_MODEL_LIMITS,
  companyModelChanges,
  keywordsNotSearched,
  linesToList,
  type CompanyModelBody,
} from "@/lib/company-model";
import { changedSections } from "@/lib/company-model-staleness";
import { adoptCompanyModelKeywordsAction, approveCompanyModelAction, buildCompanyModelAction, discardCompanyModelDraftAction, saveCompanyModelDraftAction } from "./actions";

export type CompanyModelView = {
  draft: CompanyModelBody | null;
  draftGeneratedAt: string | null;
  draftEdited: boolean;
  draftRegistrationOnly: boolean;
  approved: CompanyModelBody | null;
  approvedVersion: number;
  approvedAt: string | null;
  staleReasons: string[];
};

type Basis = { knowledge: number; pastPerformance: number; bids: number; answers: number };

const LABEL = "font-mono text-[10px] uppercase tracking-label text-muted";

export function CompanyModelPanel({
  model,
  canEdit,
  evidenceLabels,
  basis,
  searchKeywords,
}: {
  model: CompanyModelView | null;
  canEdit: boolean;
  evidenceLabels: Record<string, string>;
  basis: Basis;
  /** Settings → scout keywords, to show which of the model's keywords are not searched yet. */
  searchKeywords: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompanyModelBody | null>(model?.draft ?? null);
  const approved = model?.approved ?? null;
  const changes = draft ? companyModelChanges(approved, draft) : 0;
  const missingKeywords = approved ? keywordsNotSearched(approved, searchKeywords) : [];

  function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setNotice(label);
        router.refresh();
      }
    });
  }

  function build() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await buildCompanyModelAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        res.registrationOnly
          ? "Drafted from the registration alone: add past performance, knowledge entries or a questionnaire and rebuild for a grounded model."
          : `Drafted ${res.capabilities} capabilities from the evidence. Correct anything, then approve.`,
      );
      router.refresh();
    });
  }

  const basisLine = `${basis.knowledge} knowledge entries · ${basis.pastPerformance} past performances · ${basis.bids} decided bids · ${basis.answers} confirmed answers`;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={draft ? "Draft" : "Approved model"}
        eyebrow={
          draft
            ? `${model?.draftEdited ? "Edited" : "Drafted by FORGE"}${model?.draftGeneratedAt ? ` · ${new Date(model.draftGeneratedAt).toLocaleDateString()}` : ""} · ${changes} of 8 sections differ from the approved model`
            : approved
              ? `Version ${model?.approvedVersion}${model?.approvedAt ? ` · approved ${new Date(model.approvedAt).toLocaleDateString()}` : ""}`
              : "No model yet"
        }
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              {draft ? (
                <>
                  <button type="button" className="aur-btn" disabled={pending} onClick={() => run("Draft discarded.", discardCompanyModelDraftAction)}>
                    Discard
                  </button>
                  <button type="button" className="aur-btn" disabled={pending} onClick={() => run("Draft saved.", () => saveCompanyModelDraftAction({ body: draft }))}>
                    Save draft
                  </button>
                  <button
                    type="button"
                    className="aur-btn aur-btn-primary"
                    disabled={pending}
                    onClick={() =>
                      run("Approved. The scout, the questionnaire's suggested answers, the drafter and the pursuit brief read this version from here on.", async () => {
                        const res = await approveCompanyModelAction({ body: draft });
                        if (res.ok) setDraft(null);
                        return res;
                      })
                    }
                  >
                    Approve
                  </button>
                </>
              ) : (
                <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={build} title={`Reads: ${basisLine}`}>
                  {pending ? "Building…" : approved ? "Rebuild from the evidence" : "Build the model"}
                </button>
              )}
            </div>
          ) : null
        }
      >
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          {draft
            ? "FORGE wrote this from the evidence it has; a \"proven\" capability keeps the evidence it cited. Correct anything, then Approve: nothing reads the model until an admin approves it."
            : `A build reads ${basisLine}. ${canEdit ? "Admins approve each version." : "An admin builds and approves the model."}`}
        </p>
        {model?.staleReasons.length ? (
          <p className="mb-3 font-body text-[13px] text-brass">Changed since approval: {model.staleReasons.join("; ")}.</p>
        ) : null}
        {error ? <p className="mb-3 font-body text-[13px] text-rose">{error}</p> : null}
        {notice ? <p className="mb-3 font-body text-[13px] text-green">{notice}</p> : null}

        {draft ? (
          <DraftEditor draft={draft} approved={approved} onChange={setDraft} evidenceLabels={evidenceLabels} disabled={pending || !canEdit} />
        ) : approved ? (
          <ModelView body={approved} evidenceLabels={evidenceLabels} />
        ) : (
          <p className="font-body text-[13px] text-muted">
            {canEdit ? "Click Build the model to have FORGE draft it from the evidence." : "No approved model yet."}
          </p>
        )}
      </Panel>

      {approved && missingKeywords.length > 0 ? (
        <Panel
          title="Keywords the scout does not search yet"
          eyebrow={`${missingKeywords.length} from the approved model`}
          actions={
            canEdit ? (
              <button type="button" className="aur-btn" disabled={pending} onClick={() => run("Keywords added to Settings → Search keywords; the next scout run uses them.", adoptCompanyModelKeywordsAction)}>
                Add to scout keywords
              </button>
            ) : null
          }
        >
          <p className="font-body text-[13px] leading-[1.5] text-muted">
            The model proposes these; nothing searches them until an admin adds them: {missingKeywords.join(" · ")}.
          </p>
        </Panel>
      ) : null}

      {draft && approved ? (
        <Panel title="Approved model" eyebrow={`Version ${model?.approvedVersion} · what readers use until the draft is approved`}>
          <ModelView body={approved} evidenceLabels={evidenceLabels} />
        </Panel>
      ) : null}
    </div>
  );
}

function ModelView({ body, evidenceLabels }: { body: CompanyModelBody; evidenceLabels: Record<string, string> }) {
  const list = (title: string, items: string[]) =>
    items.length ? (
      <div>
        <div className={LABEL}>{title}</div>
        <ul className="mt-1 flex flex-col gap-0.5 font-body text-[13px] text-text">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <div className={LABEL}>Summary</div>
        <p className="mt-1 whitespace-pre-line font-body text-[14px] leading-[1.6] text-text">{body.summary || "—"}</p>
      </div>
      {body.capabilities.length ? (
        <div className="md:col-span-2">
          <div className={LABEL}>Capabilities</div>
          <ul className="mt-1 flex flex-col divide-y divide-layer/10">
            {body.capabilities.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2 py-1.5 font-body text-[13px]">
                <span className="font-medium text-text">{c.name}</span>
                <span className={`font-mono text-[10px] uppercase tracking-label ${c.strength === "proven" ? "text-green" : c.strength === "partial" ? "text-brass" : "text-muted"}`}>{c.strength}</span>
                <span className="min-w-0 flex-1 text-muted">{c.description}</span>
                {c.evidence.map((e) => (
                  <span key={e} className="aur-tag text-muted" title={e}>
                    {evidenceLabels[e] ?? e}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {list("NAICS work", body.naicsWork.map((n) => `${n.code}: ${n.whatWeDo}`))}
      {list("Customers", body.customers.map((c) => `${c.agency}: ${c.work}${c.outcomes ? ` (${c.outcomes})` : ""}`))}
      {list("Differentiators", body.differentiators)}
      {list("Gaps", body.gaps)}
      {list("Partners", body.partners.map((p) => `${p.name}: ${p.covers}`))}
      {list("Keywords", body.keywords.length ? [body.keywords.join(" · ")] : [])}
    </div>
  );
}

function DraftEditor({
  draft,
  approved,
  onChange,
  evidenceLabels,
  disabled,
}: {
  draft: CompanyModelBody;
  approved: CompanyModelBody | null;
  onChange: (b: CompanyModelBody) => void;
  evidenceLabels: Record<string, string>;
  disabled: boolean;
}) {
  const L = COMPANY_MODEL_LIMITS;
  const set = <K extends keyof CompanyModelBody>(key: K, value: CompanyModelBody[K]) => onChange({ ...draft, [key]: value });
  // Phase 1b — a rebuild reads as a diff: each section that differs from
  // the approved model is marked, and the approved one sits below.
  const changed = approved ? changedSections(approved, draft) : new Set<keyof CompanyModelBody>();
  const mark = (key: keyof CompanyModelBody) => (changed.has(key) ? <span className="ml-2 text-brass">changed</span> : null);
  const lines = (title: string, key: "differentiators" | "gaps" | "keywords", max: number, hint: string) => (
    <div>
      <div className={LABEL}>
        {title}
        {mark(key)}
      </div>
      <textarea
        className="aur-input mt-1 w-full"
        rows={4}
        disabled={disabled}
        placeholder={hint}
        defaultValue={draft[key].join("\n")}
        onBlur={(e) => set(key, linesToList(e.target.value, max))}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <div className={LABEL}>
          Summary
          {mark("summary")}
        </div>
        <textarea className="aur-input mt-1 w-full" rows={5} maxLength={L.summary} disabled={disabled} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />
      </div>
      <div className="md:col-span-2">
        <div className="flex items-center justify-between">
          <div className={LABEL}>
            Capabilities
            {mark("capabilities")}
          </div>
          <button
            type="button"
            className="aur-link font-mono text-[10px] uppercase tracking-label"
            disabled={disabled || draft.capabilities.length >= L.capabilities}
            onClick={() => set("capabilities", [...draft.capabilities, { name: "", description: "", strength: "unproven", evidence: [] }])}
          >
            Add
          </button>
        </div>
        <ul className="mt-1 flex flex-col divide-y divide-layer/10">
          {draft.capabilities.map((c, i) => (
            <li key={i} className="grid grid-cols-1 gap-2 py-2 md:grid-cols-[200px_120px_1fr_auto]">
              <input className="aur-input" placeholder="Capability" maxLength={L.short} disabled={disabled} value={c.name} onChange={(e) => set("capabilities", draft.capabilities.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <select className="aur-input" disabled={disabled} value={c.strength} onChange={(e) => set("capabilities", draft.capabilities.map((x, j) => (j === i ? { ...x, strength: e.target.value as (typeof CAPABILITY_STRENGTHS)[number] } : x)))}>
                {CAPABILITY_STRENGTHS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input className="aur-input" placeholder="What, for whom, at what scale" maxLength={L.line} disabled={disabled} value={c.description} onChange={(e) => set("capabilities", draft.capabilities.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <button type="button" className="font-mono text-[10px] uppercase tracking-label text-subtle hover:text-rose" disabled={disabled} onClick={() => set("capabilities", draft.capabilities.filter((_, j) => j !== i))}>
                Remove
              </button>
              {c.evidence.length ? (
                <div className="flex flex-wrap gap-1 md:col-span-4">
                  {c.evidence.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="aur-tag text-muted hover:text-rose"
                      title={`${e} — click to drop`}
                      disabled={disabled}
                      onClick={() => set("capabilities", draft.capabilities.map((x, j) => (j === i ? { ...x, evidence: x.evidence.filter((y) => y !== e) } : x)))}
                    >
                      {evidenceLabels[e] ?? e}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <PairEditor
        title="NAICS work"
        changed={changed.has("naicsWork")}
        rows={draft.naicsWork.map((n) => [n.code, n.whatWeDo])}
        placeholders={["Code", "What we actually do under it"]}
        max={L.naicsWork}
        disabled={disabled}
        onChange={(rows) => set("naicsWork", rows.map(([code, whatWeDo]) => ({ code, whatWeDo })))}
      />
      <PairEditor
        title="Customers"
        changed={changed.has("customers")}
        rows={draft.customers.map((c) => [c.agency, c.work, c.outcomes])}
        placeholders={["Agency", "Work", "Outcomes"]}
        max={L.customers}
        disabled={disabled}
        onChange={(rows) => set("customers", rows.map(([agency, work, outcomes]) => ({ agency, work, outcomes: outcomes ?? "" })))}
      />
      {lines("Differentiators", "differentiators", L.differentiators, "One per line")}
      {lines("Gaps", "gaps", L.gaps, "One per line: what lost bids and gap answers keep pointing at")}
      <PairEditor
        title="Partners"
        changed={changed.has("partners")}
        rows={draft.partners.map((p) => [p.name, p.covers])}
        placeholders={["Company", "What it covers"]}
        max={L.partners}
        disabled={disabled}
        onChange={(rows) => set("partners", rows.map(([name, covers]) => ({ name, covers })))}
      />
      {lines("Keywords", "keywords", L.keywords, "One per line; once approved, an admin can add them to Settings → scout keywords")}
    </div>
  );
}

/** Rows of two or three short fields: NAICS work, customers, partners. */
function PairEditor({
  title,
  changed,
  rows,
  placeholders,
  max,
  disabled,
  onChange,
}: {
  title: string;
  changed: boolean;
  rows: string[][];
  placeholders: string[];
  max: number;
  disabled: boolean;
  onChange: (rows: string[][]) => void;
}) {
  const cols = placeholders.length;
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className={LABEL}>
          {title}
          {changed ? <span className="ml-2 text-brass">changed</span> : null}
        </div>
        <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-label" disabled={disabled || rows.length >= max} onClick={() => onChange([...rows, Array(cols).fill("")])}>
          Add
        </button>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-1">
            {placeholders.map((ph, j) => (
              <input
                key={j}
                className={`aur-input min-w-0 ${j === 0 ? "w-[30%]" : "flex-1"}`}
                placeholder={ph}
                maxLength={j === 0 ? COMPANY_MODEL_LIMITS.short : COMPANY_MODEL_LIMITS.line}
                disabled={disabled}
                value={r[j] ?? ""}
                onChange={(e) => onChange(rows.map((x, k) => (k === i ? x.map((v, l) => (l === j ? e.target.value : v)) : x)))}
              />
            ))}
            <button type="button" className="font-mono text-[10px] uppercase tracking-label text-subtle hover:text-rose" disabled={disabled} onClick={() => onChange(rows.filter((_, k) => k !== i))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
