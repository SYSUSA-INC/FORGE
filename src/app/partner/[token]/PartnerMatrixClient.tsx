"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CMMC_LEVELS,
  CMMI_LEVELS,
  ISO_STANDARDS,
  PARTNER_ANSWER_LABELS,
  PARTNER_ANSWER_VALUES,
  type InviteState,
  type PartnerAnswerValue,
  type PartnerAnswers,
  type PartnerCertifications,
} from "@/lib/partner-invite-logic";
import { CAPABILITY_EVIDENCE_MAX, PARTIAL_PERCENT, clampPartialPercent } from "@/lib/capability-matrix-types";
import type { PartnerMatrixView } from "@/lib/partner-invite-store";
import { savePartnerAnswersAction } from "./actions";

const KIND_LABEL: Record<string, string> = { shall: "Required", should: "Expected", may: "Desirable", standing: "Standing" };
const TONE: Record<PartnerAnswerValue, string> = {
  yes: "border-green/60 bg-green/10 text-green",
  partial: "border-brass/60 bg-brass/10 text-brass",
  no: "border-red/60 bg-red/10 text-red",
};

type Draft = Record<string, { answer: PartnerAnswerValue | null; percent: number; evidence: string }>;

export function PartnerMatrixClient({ token, view }: { token: string; view: PartnerMatrixView }) {
  const [draft, setDraft] = useState<Draft>(() => {
    const d: Draft = {};
    for (const q of view.questions) {
      const a = view.answers[q.id];
      d[q.id] = { answer: a?.answer ?? null, percent: a?.percent ?? PARTIAL_PERCENT.default, evidence: a?.evidence ?? "" };
    }
    return d;
  });
  const [certs, setCerts] = useState<PartnerCertifications>(view.certifications);
  const [state, setState] = useState<InviteState>(view.state);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const answered = useMemo(() => view.questions.filter((q) => draft[q.id]?.answer).length, [draft, view.questions]);

  function set(id: string, patch: Partial<Draft[string]>) {
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));
  }
  function payload(): PartnerAnswers {
    const out: PartnerAnswers = {};
    for (const q of view.questions) {
      const d = draft[q.id];
      if (!d?.answer) continue;
      out[q.id] = { answer: d.answer, percent: d.answer === "partial" ? clampPartialPercent(d.percent) : null, evidence: d.evidence, updatedAt: "" };
    }
    return out;
  }
  function save(submit: boolean) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await savePartnerAnswersAction({ token, answers: payload(), certifications: certs, submit });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setState(res.state);
      setNotice(submit ? `Submitted. ${view.organizationName} can see your answers now; you can still change them until ${view.expiresAt.slice(0, 10)}.` : "Saved. Come back any time before the link expires.");
    });
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text">{view.opportunityTitle}</h1>
        <p className="mt-2 font-body text-[14px] leading-[1.55] text-muted">
          {view.organizationName} is considering <span className="text-text">{view.companyName}</span> as a teaming partner and asks how it covers each capability the work needs. Answer for {view.companyName}: Yes, Partial (with the share you cover) or No, with a line of evidence each. Only {view.organizationName} sees your answers. This link expires on {view.expiresAt.slice(0, 10)}.
        </p>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-label text-subtle">
          {answered} of {view.questions.length} answered{state === "submitted" ? " · submitted" : ""}
        </p>
      </div>

      <ol className="flex flex-col divide-y divide-layer/10 rounded-lg border border-layer/10 bg-paper">
        {view.questions.map((q, i) => {
          const d = draft[q.id]!;
          return (
            <li key={q.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] text-subtle">{i + 1}.</span>
                <span className="font-body text-[14px] leading-[1.5] text-text">{q.text}</span>
                <span className="font-mono text-[10px] uppercase tracking-label text-muted">
                  {KIND_LABEL[q.kind] ?? q.kind}
                  {q.area ? ` · ${q.area}` : ""}
                </span>
              </div>
              <div role="radiogroup" aria-label={`Answer ${i + 1}`} className="flex flex-wrap items-center gap-2">
                {PARTNER_ANSWER_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={d.answer === v}
                    className={`rounded border px-2 py-1 font-mono text-[11px] uppercase tracking-widest ${d.answer === v ? TONE[v] : "border-layer/15 text-muted hover:border-layer/30"}`}
                    onClick={() => set(q.id, { answer: v })}
                  >
                    {PARTNER_ANSWER_LABELS[v]}
                  </button>
                ))}
                {d.answer === "partial" ? (
                  <label className="flex items-center gap-1 font-mono text-[11px] text-muted">
                    We cover
                    <input
                      type="number"
                      className="aur-input w-20 py-1"
                      min={PARTIAL_PERCENT.min}
                      max={PARTIAL_PERCENT.max}
                      step={PARTIAL_PERCENT.step}
                      value={d.percent}
                      onChange={(e) => set(q.id, { percent: Number(e.target.value) })}
                      onBlur={() => set(q.id, { percent: clampPartialPercent(d.percent) })}
                    />
                    %
                  </label>
                ) : null}
              </div>
              <textarea
                className="aur-input min-h-[3rem] py-1 font-body text-[13px]"
                maxLength={CAPABILITY_EVIDENCE_MAX}
                placeholder="Evidence: a contract, a product, a team, a certification…"
                value={d.evidence}
                onChange={(e) => set(q.id, { evidence: e.target.value })}
              />
            </li>
          );
        })}
      </ol>

      <section className="rounded-lg border border-layer/10 bg-paper p-4">
        <h2 className="font-mono text-[10px] uppercase tracking-label text-muted">Certifications {view.companyName} holds</h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
            <legend className="aur-label">ISO</legend>
            {ISO_STANDARDS.map((std) => (
              <label key={std} className="flex items-center gap-1 font-body text-[13px] text-text">
                <input
                  type="checkbox"
                  checked={(certs.iso ?? []).includes(std)}
                  onChange={(e) => setCerts((c) => ({ ...c, iso: e.target.checked ? [...(c.iso ?? []), std] : (c.iso ?? []).filter((s) => s !== std) }))}
                />
                {std}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 font-body text-[13px] text-text">
            <span className="aur-label">CMMI</span>
            <select className="aur-input py-1" value={certs.cmmiLevel ?? ""} onChange={(e) => setCerts((c) => ({ ...c, cmmiLevel: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">None</option>
              {CMMI_LEVELS.map((l) => (
                <option key={l} value={l}>
                  Maturity level {l}
                </option>
              ))}
            </select>
            <select className="aur-input py-1" value={certs.cmmiModel ?? ""} disabled={!certs.cmmiLevel} onChange={(e) => setCerts((c) => ({ ...c, cmmiModel: e.target.value === "DEV" || e.target.value === "SVC" ? e.target.value : null }))}>
              <option value="">Model…</option>
              <option value="DEV">DEV</option>
              <option value="SVC">SVC</option>
            </select>
          </label>
          <label className="flex items-center gap-2 font-body text-[13px] text-text">
            <span className="aur-label">CMMC</span>
            <select className="aur-input py-1" value={certs.cmmcLevel ?? ""} onChange={(e) => setCerts((c) => ({ ...c, cmmcLevel: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">None</option>
              {CMMC_LEVELS.map((l) => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="aur-label">Other (FedRAMP, SOC 2, clearances…)</span>
          <input className="aur-input mt-1" maxLength={300} value={certs.other ?? ""} onChange={(e) => setCerts((c) => ({ ...c, other: e.target.value }))} />
        </label>
      </section>

      {error ? <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2 font-mono text-[11px] text-red">{error}</div> : null}
      {notice ? <div className="rounded-md border border-green/30 bg-green/5 px-3 py-2 font-mono text-[11px] text-green">{notice}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="aur-btn" disabled={pending} onClick={() => save(false)}>
          Save draft
        </button>
        <button type="button" className="aur-btn aur-btn-primary" disabled={pending || answered === 0} onClick={() => save(true)}>
          {state === "submitted" ? "Submit again" : "Submit answers"}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-label text-subtle">No account needed · nothing here shows {view.organizationName}&rsquo;s own answers</span>
      </div>
    </div>
  );
}
