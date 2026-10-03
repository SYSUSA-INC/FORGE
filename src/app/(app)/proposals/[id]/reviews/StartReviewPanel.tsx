"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ReviewChecklistItem, ReviewColor } from "@/db/schema";
import { CHECKLIST_LIMITS, REVIEW_CHECKLIST_TEMPLATES, slugKey } from "@/lib/review-workflow-logic";
import { startReviewAction } from "./actions";

type ColorDef = { key: ReviewColor; label: string; color: string; description: string };
type Reviewer = { id: string; name: string | null; email: string; role: string };
type SectionRow = { id: string; title: string; ordering: number };

/**
 * Start a colour-team round: colour, due date, the lead's instructions,
 * reviewers each scoped to any number of sections (none = the whole
 * proposal), and the checklist the round will run against — the
 * colour's template, trimmed or extended here (BL-FB-X-COLOR-TEAM).
 */
export function StartReviewPanel({
  proposalId,
  colors,
  reviewers,
  sections = [],
  carryCandidates = [],
}: {
  proposalId: string;
  colors: ColorDef[];
  reviewers: Reviewer[];
  sections?: SectionRow[];
  /** Slice 2 — earlier rounds with open comments the new round can take over. */
  carryCandidates?: { reviewId: string; label: string }[];
}) {
  const router = useRouter();
  const [color, setColor] = useState<ReviewColor>("pink");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [carryFrom, setCarryFrom] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sectionAssignments, setSectionAssignments] = useState<Record<string, string[]>>({});
  const [checklist, setChecklist] = useState<ReviewChecklistItem[]>(REVIEW_CHECKLIST_TEMPLATES.pink);
  const [newItem, setNewItem] = useState("");
  const [showChecklist, setShowChecklist] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSection(uid: string, sectionId: string) {
    setSectionAssignments((prev) => {
      const cur = prev[uid] ?? [];
      return { ...prev, [uid]: cur.includes(sectionId) ? cur.filter((s) => s !== sectionId) : [...cur, sectionId] };
    });
  }

  function pickColor(next: ReviewColor) {
    setColor(next);
    setChecklist(REVIEW_CHECKLIST_TEMPLATES[next]);
  }

  function addItem() {
    const label = newItem.trim();
    if (!label || checklist.length >= CHECKLIST_LIMITS.maxItems) return;
    setChecklist((prev) => [...prev, { key: slugKey(label, prev.length + 1), label }]);
    setNewItem("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const sectionMap: Record<string, string[]> = {};
      for (const uid of selected) sectionMap[uid] = sectionAssignments[uid] ?? [];
      const res = await startReviewAction({
        proposalId,
        color,
        dueDate: dueDate || null,
        reviewerUserIds: Array.from(selected),
        sectionAssignments: sectionMap,
        instructions,
        checklist,
        carryFromReviewId: carryFrom || null,
      });
      if (!res.ok) return setError(res.error);
      setSelected(new Set());
      setSectionAssignments({});
      setDueDate("");
      setInstructions("");
      setCarryFrom("");
      router.push(`/proposals/${proposalId}/reviews/${res.reviewId}`);
    });
  }

  const colorDef = colors.find((c) => c.key === color);

  return (
    <Panel title="Start review" eyebrow="New color-team cycle">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Color team</label>
          <select className="aur-input" value={color} onChange={(e) => pickColor(e.target.value as ReviewColor)}>
            {colors.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {colorDef ? <div className="mt-1 font-mono text-[10px] text-muted">{colorDef.description}</div> : null}
        </div>
        <div>
          <label className="aur-label">Due date (optional)</label>
          <input className="aur-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="aur-label">Instructions to reviewers (optional)</label>
          <textarea
            className="aur-input text-[12px]"
            rows={2}
            maxLength={CHECKLIST_LIMITS.maxInstructionsChars}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What this round should concentrate on — e.g. score Factor 2 as the evaluator would; ignore formatting."
          />
        </div>
        {carryCandidates.length > 0 ? (
          <div>
            <label className="aur-label">Carry open comments from</label>
            <select className="aur-input text-[12px]" value={carryFrom} onChange={(e) => setCarryFrom(e.target.value)}>
              <option value="">Start clean</option>
              {carryCandidates.map((c) => (
                <option key={c.reviewId} value={c.reviewId}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="mt-1 font-mono text-[10px] text-muted">The earlier round's open comments reopen on this one and close there.</div>
          </div>
        ) : null}
        <div>
          <label className="aur-label">Reviewers</label>
          {reviewers.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">No org members to assign.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {reviewers.map((r) => {
                const isSelected = selected.has(r.id);
                const scope = sectionAssignments[r.id] ?? [];
                return (
                  <li key={r.id}>
                    <div className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-1.5">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" className="accent-teal-400" checked={isSelected} onChange={() => toggle(r.id)} />
                        <span className="min-w-0 truncate font-mono text-[12px] text-text">{r.name ?? r.email}</span>
                        <span className="ml-auto rounded bg-layer/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">{r.role}</span>
                      </label>
                      {isSelected && sections.length > 0 ? (
                        <div className="mt-2">
                          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                            Sections · {scope.length === 0 ? "whole proposal" : `${scope.length} of ${sections.length}`}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {sections.map((s) => {
                              const on = scope.includes(s.id);
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => toggleSection(r.id, s.id)}
                                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${on ? "border-teal-400/40 bg-teal-400/10 text-text" : "border-layer/10 text-muted hover:text-text"}`}
                                  title={s.title}
                                >
                                  §{s.ordering}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <button type="button" onClick={() => setShowChecklist((v) => !v)} className="aur-label flex w-full items-center justify-between text-left">
            <span>Checklist · {checklist.length} line{checklist.length === 1 ? "" : "s"}</span>
            <span className="font-mono text-[10px] text-muted">{showChecklist ? "Hide" : "Edit"}</span>
          </button>
          {showChecklist ? (
            <div className="mt-1 flex flex-col gap-1 rounded-md border border-layer/10 bg-layer/[0.02] p-2">
              {checklist.map((item) => (
                <div key={item.key} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 font-body text-[11px] text-text">{item.label}</span>
                  <button
                    type="button"
                    onClick={() => setChecklist((prev) => prev.filter((i) => i.key !== item.key))}
                    className="font-mono text-[10px] uppercase tracking-widest text-subtle hover:text-rose-300"
                    aria-label={`Remove ${item.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="mt-1 flex gap-2">
                <input
                  className="aur-input flex-1 text-[11px]"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addItem();
                    }
                  }}
                  maxLength={CHECKLIST_LIMITS.maxLabelChars}
                  placeholder="Add a line…"
                />
                <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={addItem} disabled={!newItem.trim() || checklist.length >= CHECKLIST_LIMITS.maxItems}>
                  Add
                </button>
                <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={() => setChecklist(REVIEW_CHECKLIST_TEMPLATES[color])}>
                  Reset
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
        <button type="submit" disabled={pending || selected.size === 0} className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60">
          {pending ? "Starting…" : `Start ${colorDef?.label ?? "review"}`}
        </button>
      </form>
    </Panel>
  );
}
