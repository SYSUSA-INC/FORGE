"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  CAPABILITY_PWIN_MIN_ANSWERED,
  CAPABILITY_PWIN_MIN_ANSWERED_SHARE,
  CAPABILITY_TEAMING_THRESHOLD,
  capabilityPwinFeature,
  computeCapabilityCoverage,
} from "@/lib/capability-coverage";
import {
  CAPABILITY_ANSWER_LABELS,
  CAPABILITY_ANSWER_VALUES,
  answeredCount,
  type CapabilityAnswer,
  type CapabilityAnswerValue,
  type CapabilityQuestion,
  type CapabilitySuggestion,
} from "@/lib/capability-matrix-types";
import { pendingSuggestions } from "@/lib/capability-suggestions";
import {
  answerCapabilityQuestionAction,
  buildCapabilityQuestionsAction,
  dismissCapabilitySuggestionAction,
  removeCapabilityQuestionAction,
  suggestCapabilityAnswersAction,
  updateCapabilityQuestionAction,
} from "../capability-matrix-actions";

/**
 * BL-CAP-MATRIX phase A — review and answer the capability questions.
 * Every change saves at once through a server action; the page re-renders
 * from the stored row, so what you see is what is saved.
 */
export type CapabilityMatrixView = {
  questions: CapabilityQuestion[];
  answers: Record<string, CapabilityAnswer>;
  /** Phase C — FORGE's suggestions for unanswered questions; a person confirms each. */
  suggestions: Record<string, CapabilitySuggestion>;
  parseVersion: string;
  builtAt: string | null;
};

export function CapabilityMatrixPanel({
  opportunityId,
  matrix,
  currentParseVersion,
  hasRequirements,
  partners,
}: {
  opportunityId: string;
  matrix: CapabilityMatrixView | null;
  currentParseVersion: string;
  hasRequirements: boolean;
  partners: { id: string; name: string; relationship: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const total = matrix?.questions.length ?? 0;
  const answered = matrix ? answeredCount(matrix.questions, matrix.answers) : 0;
  const coverage = matrix ? computeCapabilityCoverage(matrix.questions, matrix.answers) : null;
  const pwinActive = coverage ? capabilityPwinFeature(coverage) !== null : false;
  const stale = !!matrix && matrix.parseVersion !== currentParseVersion;
  const suggested = matrix ? pendingSuggestions(matrix.questions, matrix.answers, matrix.suggestions) : 0;

  const groups = useMemo(() => {
    const out: { area: string; questions: CapabilityQuestion[] }[] = [];
    for (const q of matrix?.questions ?? []) {
      let g = out.find((x) => x.area === q.area);
      if (!g) {
        g = { area: q.area, questions: [] };
        out.push(g);
      }
      g.questions.push(q);
    }
    return out;
  }, [matrix]);

  function build() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await buildCapabilityQuestionsAction({ opportunityId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `${res.questions} questions drafted${res.carried > 0 ? `; ${res.carried} earlier answers kept` : ""}.`,
      );
      router.refresh();
    });
  }

  function suggest() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await suggestCapabilityAnswersAction({ opportunityId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const parts = [
        res.fromMatrix > 0 ? `${res.fromMatrix} from the solicitation's matrix` : "",
        res.fromPrior > 0 ? `${res.fromPrior} from earlier questionnaires` : "",
        res.fromAi > 0 ? `${res.fromAi} from past performance and the knowledge base` : "",
      ].filter(Boolean);
      setNotice(
        res.suggested === 0
          ? `Nothing to suggest${res.aiSkipped ? ` (${res.aiSkipped})` : ""}; answer the questions yourself.`
          : `${res.suggested} answer${res.suggested === 1 ? "" : "s"} suggested (${parts.join("; ")}). Confirm or change each one; none counts until you do.`,
      );
      router.refresh();
    });
  }

  return (
    <Panel
      title="Capability matrix"
      eyebrow={matrix ? `${answered} of ${total} answered${suggested > 0 ? ` · ${suggested} suggested` : ""}` : "Questionnaire"}
      actions={
        <div className="flex items-center gap-2">
          {matrix && answered < total ? (
            <button
              type="button"
              className="aur-btn"
              disabled={pending}
              onClick={suggest}
              title="FORGE pre-fills the unanswered questions from the solicitation's scored matrix, earlier questionnaires, past performance and the knowledge base. You confirm each one."
            >
              {pending ? "Working…" : "Suggest answers"}
            </button>
          ) : null}
          <button
            type="button"
            className="aur-btn aur-btn-primary"
            disabled={pending || !hasRequirements}
            onClick={build}
            title={
              hasRequirements
                ? "FORGE drafts the questions from the parsed solicitation's requirements."
                : "Parse a solicitation on this opportunity first."
            }
          >
            {pending ? "Drafting…" : matrix ? "Rebuild questions" : "Build questionnaire"}
          </button>
        </div>
      }
    >
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        FORGE drafts the questions from the solicitation&apos;s requirements and Section M, plus the standing
        questions every bid gets. Review them, drop or reword any, and answer each one honestly: the answers
        are what the coverage score, the partner decision and PWin read. <strong className="font-medium text-text">Suggest answers</strong> pre-fills
        what FORGE can show evidence for; a suggestion counts only once you confirm it.
      </p>
      {stale ? (
        <p className="mb-3 font-body text-[13px] text-brass">
          The solicitation was re-parsed since these questions were drafted. Rebuild to refresh them; answers
          to questions that did not change are kept.
        </p>
      ) : null}
      {error ? <p className="mb-3 font-body text-[13px] text-rose">{error}</p> : null}
      {notice ? <p className="mb-3 font-body text-[13px] text-green">{notice}</p> : null}

      {matrix && coverage ? (
        <div className="mb-4 grid grid-cols-2 gap-3 border-t border-layer/10 pt-3 md:grid-cols-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Coverage</div>
            <div className="font-display text-2xl tabular-nums text-text">
              {coverage.coverage === null ? "—" : `${Math.round(coverage.coverage * 100)}%`}
            </div>
            <div className="font-mono text-[10px] text-subtle">
              {coverage.shallCoverage === null ? "no shall answers yet" : `${Math.round(coverage.shallCoverage * 100)}% of shall`}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Partner</div>
            <div className={`font-display text-2xl ${coverage.partnerNeeded ? "text-brass" : "text-text"}`}>
              {coverage.coverage === null ? "—" : coverage.partnerNeeded ? "Needed" : "Not needed"}
            </div>
            <div className="font-mono text-[10px] text-subtle">
              {coverage.partnerNeeded
                ? `${coverage.shallGapsOpen} shall gap${coverage.shallGapsOpen === 1 ? "" : "s"} open · ${coverage.partnerCovered} covered`
                : `flagged under ${Math.round(CAPABILITY_TEAMING_THRESHOLD * 100)}% of shall`}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Gaps</div>
            <div className="font-display text-2xl tabular-nums text-text">{coverage.gaps.length}</div>
            <div className="font-mono text-[10px] text-subtle">answered as a gap</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">PWin</div>
            <div className={`font-display text-2xl ${pwinActive ? "text-text" : "text-muted"}`}>
              {pwinActive ? "Counting" : "Not yet"}
            </div>
            <div className="font-mono text-[10px] text-subtle">
              {pwinActive
                ? "capability coverage is a PWin factor"
                : `answer ${CAPABILITY_PWIN_MIN_ANSWERED}+ and ${Math.round(CAPABILITY_PWIN_MIN_ANSWERED_SHARE * 100)}% of the questions`}
            </div>
          </div>
          {coverage.gaps.length > 0 ? (
            <ul className="col-span-2 flex flex-col divide-y divide-layer/10 md:col-span-4">
              {coverage.gaps.map((g) => (
                <li key={g.questionId} className="flex flex-wrap items-center gap-2 py-1.5 font-body text-[13px] text-text">
                  <span className="min-w-0 flex-1">{g.text}</span>
                  {g.refs.map((r) => (
                    <span key={r} className="aur-tag text-muted">{r}</span>
                  ))}
                  <span className={`font-mono text-[10px] uppercase tracking-label ${g.partnerNamed ? "text-green" : "text-brass"}`}>
                    {g.value === "gap_none" ? "no plan" : g.partnerNamed ? "partner named" : "partner needed"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!matrix ? (
        <p className="font-body text-[13px] text-muted">
          {hasRequirements
            ? "No questionnaire yet."
            : "No parsed solicitation on this opportunity yet, so there is nothing to draft questions from."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.area}>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-label text-muted">{g.area}</div>
              <ul className="flex flex-col divide-y divide-layer/10">
                {g.questions.map((q) => (
                  <QuestionRow
                    key={q.id}
                    opportunityId={opportunityId}
                    question={q}
                    answer={matrix.answers[q.id] ?? null}
                    suggestion={matrix.answers[q.id] ? null : (matrix.suggestions[q.id] ?? null)}
                    partners={partners}
                    onError={setError}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function QuestionRow({
  opportunityId,
  question,
  answer,
  suggestion,
  partners,
  onError,
}: {
  opportunityId: string;
  question: CapabilityQuestion;
  answer: CapabilityAnswer | null;
  suggestion: CapabilitySuggestion | null;
  partners: { id: string; name: string; relationship: string }[];
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<CapabilityAnswerValue | "">(answer?.value ?? "");
  const [evidence, setEvidence] = useState(answer?.evidence ?? "");
  const [partner, setPartner] = useState<string>(answer?.partnerCompanyId ?? "");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.text);

  function save(next: { value?: CapabilityAnswerValue | ""; evidence?: string; partner?: string }) {
    const v = next.value ?? value;
    if (!v) return;
    onError(null);
    startTransition(async () => {
      const res = await answerCapabilityQuestionAction({
        opportunityId,
        questionId: question.id,
        value: v,
        evidence: next.evidence ?? evidence,
        partnerCompanyId: (next.partner ?? partner) || null,
      });
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  }

  function confirmSuggestion() {
    if (!suggestion) return;
    onError(null);
    setValue(suggestion.value);
    setEvidence(suggestion.evidence);
    startTransition(async () => {
      const res = await answerCapabilityQuestionAction({
        opportunityId,
        questionId: question.id,
        value: suggestion.value,
        evidence: suggestion.evidence,
        partnerCompanyId: null,
        fromSuggestion: true,
      });
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  }

  function dismissSuggestion() {
    onError(null);
    startTransition(async () => {
      const res = await dismissCapabilitySuggestionAction({ opportunityId, questionId: question.id });
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  }

  function saveText() {
    setEditing(false);
    if (text.trim() === question.text) return;
    startTransition(async () => {
      const res = await updateCapabilityQuestionAction({ opportunityId, questionId: question.id, text });
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await removeCapabilityQuestionAction({ opportunityId, questionId: question.id });
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="grid grid-cols-1 gap-2 px-1 py-3 md:grid-cols-[1fr_220px]">
      <div className="min-w-0">
        {editing ? (
          <input
            className="aur-input w-full"
            value={text}
            maxLength={400}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveText();
              if (e.key === "Escape") {
                setText(question.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="text-left font-body text-[14px] text-text hover:text-cobalt"
            onClick={() => setEditing(true)}
            title="Click to reword"
          >
            {question.text}
          </button>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {question.kind !== "standing" ? (
            <span className="font-mono text-[10px] uppercase tracking-label text-subtle">{question.kind}</span>
          ) : null}
          {question.refs.map((r) => (
            <span key={r} className="aur-tag text-muted">
              {r}
            </span>
          ))}
          <button type="button" className="font-mono text-[10px] uppercase tracking-label text-subtle hover:text-rose" onClick={remove} disabled={pending}>
            Remove
          </button>
        </div>
        {suggestion ? (
          <div className="mt-2 border-l-2 border-cobalt/40 pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-label text-cobalt">Suggested</span>
              <span className="font-body text-[13px] text-text">{CAPABILITY_ANSWER_LABELS[suggestion.value]}</span>
              <button type="button" className="aur-btn aur-btn-ghost" onClick={confirmSuggestion} disabled={pending}>
                Confirm
              </button>
              <button
                type="button"
                className="font-mono text-[10px] uppercase tracking-label text-subtle hover:text-rose"
                onClick={dismissSuggestion}
                disabled={pending}
              >
                Dismiss
              </button>
            </div>
            <p className="mt-1 font-body text-[12px] leading-[1.5] text-muted">{suggestion.reason}</p>
            {suggestion.evidence ? (
              <p className="mt-0.5 font-body text-[12px] leading-[1.5] text-text">{suggestion.evidence}</p>
            ) : null}
            {suggestion.sources.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestion.sources.map((src) => (
                  <span key={`${src.kind}:${src.ref}`} className="aur-tag text-muted" title={src.kind.replace("_", " ")}>
                    {src.kind === "matrix" ? `${src.ref}: ${src.label}` : src.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <input
          className="aur-input mt-2 w-full"
          placeholder="Evidence: a past performance, a knowledge entry, or a note"
          value={evidence}
          maxLength={1000}
          onChange={(e) => setEvidence(e.target.value)}
          onBlur={() => save({ evidence })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <select
          className="aur-input"
          value={value}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value as CapabilityAnswerValue | "";
            setValue(v);
            save({ value: v });
          }}
        >
          <option value="">— choose —</option>
          {CAPABILITY_ANSWER_VALUES.map((v) => (
            <option key={v} value={v}>
              {CAPABILITY_ANSWER_LABELS[v]}
            </option>
          ))}
        </select>
        {value === "gap_partner" && partners.length === 0 ? (
          <a href="/companies/new" className="font-body text-[13px] text-accent hover:underline">
            Add a teaming partner or subcontractor in Companies →
          </a>
        ) : null}
        {value === "gap_partner" && partners.length > 0 ? (
          <select
            className="aur-input"
            value={partner}
            disabled={pending}
            onChange={(e) => {
              setPartner(e.target.value);
              save({ partner: e.target.value });
            }}
          >
            <option value="">Partner: not named yet</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.relationship.replace("_", " ")})
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </li>
  );
}
