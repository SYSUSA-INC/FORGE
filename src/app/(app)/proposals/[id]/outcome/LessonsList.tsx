"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  LESSON_KIND_LABELS,
  LESSON_KINDS,
  LESSON_SOURCE_LABELS,
  termsFrom,
  type LessonAppliesTo,
  type LessonKind,
  type LessonSource,
  type LessonStatus,
} from "@/lib/lessons";
import { confirmLessonAction, createLessonAction, draftLessonsAction, retireLessonAction, updateLessonAction } from "./lessons-actions";

/**
 * BL-LESSONS-LOOP phase 4a — the lessons of a bid (Outcome tab) or of
 * the whole organization (Loss intelligence → Lessons). Proposed lessons
 * wait for a Capture or Admin user; confirmed ones are what the readers
 * will use (phase 4b); retired ones stay, greyed.
 */
export type LessonView = {
  id: string;
  opportunityId: string;
  proposalId: string | null;
  source: string;
  kind: string;
  text: string;
  appliesTo: LessonAppliesTo;
  evidence: string[];
  status: string;
  confirmedAt: string | null;
  createdAt: string;
  opportunityTitle: string;
  proposalTitle: string | null;
};

const ORDER: LessonStatus[] = ["proposed", "confirmed", "retired"];
const LABEL = "font-mono text-[10px] uppercase tracking-label";

export function LessonsList({
  lessons,
  canConfirm,
  proposalId,
  showBid,
  title,
}: {
  lessons: LessonView[];
  canConfirm: boolean;
  /** When set, the list belongs to this bid: Draft lessons and Add lesson appear. */
  proposalId?: string;
  /** Show the bid each lesson came from (the organization-wide page). */
  showBid?: boolean;
  title: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<LessonKind>("do");
  const counts = { proposed: 0, confirmed: 0, retired: 0 } as Record<LessonStatus, number>;
  for (const l of lessons) counts[(l.status as LessonStatus) ?? "proposed"] += 1;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        if (done) setNotice(done);
        router.refresh();
      }
    });
  }

  function draft() {
    if (!proposalId) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await draftLessonsAction({ proposalId });
      if (!res.ok) setError(res.error);
      else {
        setNotice(res.drafted === 0 ? "Nothing new to add: every lesson FORGE found is already recorded." : `${res.drafted} lesson${res.drafted === 1 ? "" : "s"} proposed. Confirm, edit or retire each; nothing reads a proposed lesson.`);
        router.refresh();
      }
    });
  }

  return (
    <Panel
      title={title}
      eyebrow={`${counts.proposed} proposed · ${counts.confirmed} confirmed${counts.retired ? ` · ${counts.retired} retired` : ""}`}
      actions={
        proposalId && canConfirm ? (
          <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={draft} title="FORGE reads the outcome, the debrief, the winner analysis, open review comments and the loss patterns.">
            {pending ? "Working…" : "Draft lessons"}
          </button>
        ) : null
      }
    >
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        One sentence each, in the imperative, with what it applies to. FORGE proposes them when an outcome is recorded or a debrief is held; a Capture or Admin user confirms, edits or retires each. Only confirmed lessons reach the drafter, the evaluation tab and the pursuit brief.
      </p>
      {error ? <p className="mb-3 font-body text-[13px] text-rose">{error}</p> : null}
      {notice ? <p className="mb-3 font-body text-[13px] text-green">{notice}</p> : null}

      {proposalId ? (
        <form
          className="mb-4 flex flex-col gap-2 md:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newText.trim().length < 8) {
              setError("Write the lesson out (at least a short sentence).");
              return;
            }
            run(() => createLessonAction({ proposalId, text: newText, kind: newKind }), canConfirm ? "Lesson recorded as confirmed." : "Lesson proposed; a Capture or Admin user confirms it.");
            setNewText("");
          }}
        >
          <select className="aur-input md:w-[120px]" value={newKind} onChange={(e) => setNewKind(e.target.value as LessonKind)} disabled={pending}>
            {LESSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {LESSON_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input className="aur-input flex-1" placeholder="Write a lesson by hand: one sentence, imperative" maxLength={300} value={newText} onChange={(e) => setNewText(e.target.value)} disabled={pending} />
          <button type="submit" className="aur-btn" disabled={pending}>
            Add lesson
          </button>
        </form>
      ) : null}

      {lessons.length === 0 ? (
        <p className="font-body text-[13px] text-muted">{proposalId ? "No lessons yet. Record the outcome, or draft them." : "No lessons recorded yet. They come from each bid's Outcome tab."}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {ORDER.filter((s) => counts[s] > 0).map((status) => (
            <div key={status}>
              <div className={`${LABEL} mb-1 ${status === "proposed" ? "text-brass" : status === "confirmed" ? "text-green" : "text-subtle"}`}>{status}</div>
              <ul className="flex flex-col divide-y divide-layer/10">
                {lessons
                  .filter((l) => l.status === status)
                  .map((l) => (
                    <LessonRow key={l.id} lesson={l} canConfirm={canConfirm} showBid={!!showBid} pending={pending} run={run} />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function LessonRow({
  lesson,
  canConfirm,
  showBid,
  pending,
  run,
}: {
  lesson: LessonView;
  canConfirm: boolean;
  showBid: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [kind, setKind] = useState<LessonKind>((lesson.kind as LessonKind) ?? "do");
  const [applies, setApplies] = useState({
    agencies: lesson.appliesTo.agencies.join(", "),
    naicsCodes: lesson.appliesTo.naicsCodes.join(", "),
    sectionKinds: lesson.appliesTo.sectionKinds.join(", "),
    capabilities: lesson.appliesTo.capabilities.join(", "),
  });
  const retired = lesson.status === "retired";
  const appliesTo = () => ({
    agencies: termsFrom(applies.agencies),
    naicsCodes: termsFrom(applies.naicsCodes),
    sectionKinds: termsFrom(applies.sectionKinds),
    capabilities: termsFrom(applies.capabilities),
  });
  const chips = [...lesson.appliesTo.agencies, ...lesson.appliesTo.naicsCodes, ...lesson.appliesTo.sectionKinds.map((k) => k.replace("_", " ")), ...lesson.appliesTo.capabilities];

  return (
    <li className={`grid grid-cols-1 gap-2 px-1 py-2.5 md:grid-cols-[1fr_auto] ${retired ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <select className="aur-input w-[120px]" value={kind} onChange={(e) => setKind(e.target.value as LessonKind)}>
                {LESSON_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LESSON_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <input className="aur-input flex-1" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              {(["agencies", "naicsCodes", "sectionKinds", "capabilities"] as const).map((f) => (
                <input
                  key={f}
                  className="aur-input"
                  placeholder={{ agencies: "Agencies, comma-separated", naicsCodes: "NAICS codes", sectionKinds: "Section kinds (pricing, technical…)", capabilities: "Capabilities" }[f]}
                  value={applies[f]}
                  onChange={(e) => setApplies({ ...applies, [f]: e.target.value })}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={`${LABEL} ${kind === "avoid" ? "text-rose" : kind === "watch" ? "text-brass" : "text-green"}`}>{LESSON_KIND_LABELS[(lesson.kind as LessonKind) ?? "do"]}</span>
            <span className="font-body text-[14px] text-text">{lesson.text}</span>
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`${LABEL} text-subtle`}>{LESSON_SOURCE_LABELS[(lesson.source as LessonSource) ?? "manual"]}</span>
          {chips.map((c) => (
            <span key={c} className="aur-tag text-muted">
              {c}
            </span>
          ))}
          {lesson.evidence.length ? <span className={`${LABEL} text-subtle`}>{lesson.evidence.length} evidence</span> : null}
          {showBid && lesson.proposalId ? (
            <Link href={`/proposals/${lesson.proposalId}/outcome`} className="aur-link font-body text-[12px]">
              from {lesson.proposalTitle ?? lesson.opportunityTitle}
            </Link>
          ) : null}
        </div>
      </div>
      {canConfirm && !retired ? (
        <div className="flex items-start gap-2">
          {editing ? (
            <>
              <button
                type="button"
                className="aur-btn aur-btn-primary"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  const body = { lessonId: lesson.id, text, kind, appliesTo: appliesTo() };
                  run(() => (lesson.status === "proposed" ? confirmLessonAction(body) : updateLessonAction(body)), lesson.status === "proposed" ? "Confirmed." : "Saved.");
                }}
              >
                {lesson.status === "proposed" ? "Confirm" : "Save"}
              </button>
              <button type="button" className="aur-btn" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {lesson.status === "proposed" ? (
                <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => run(() => confirmLessonAction({ lessonId: lesson.id }), "Confirmed.")}>
                  Confirm
                </button>
              ) : null}
              <button type="button" className="aur-btn" disabled={pending} onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className={`${LABEL} text-subtle hover:text-rose`} disabled={pending} onClick={() => run(() => retireLessonAction({ lessonId: lesson.id }), "Retired.")}>
                Retire
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
