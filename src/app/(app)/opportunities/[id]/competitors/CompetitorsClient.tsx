"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCompetitorAction,
  removeCompetitorAction,
  updateCompetitorAction,
} from "../evaluation-actions";

type CompetitorRow = {
  id: string;
  name: string;
  isIncumbent: boolean;
  pastPerformance: string;
  strengths: string;
  weaknesses: string;
  notes: string;
};

export function CompetitorsClient({
  opportunityId,
  competitors,
  incumbentFromOverview,
}: {
  opportunityId: string;
  competitors: CompetitorRow[];
  incumbentFromOverview: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AddForm
        opportunityId={opportunityId}
        suggestedIncumbent={incumbentFromOverview}
      />
      {competitors.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/10 px-3 py-3 font-mono text-[11px] text-muted">
          No competitors added yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {competitors.map((c) => (
            <CompetitorCard
              key={c.id}
              opportunityId={opportunityId}
              competitor={c}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddForm({
  opportunityId,
  suggestedIncumbent,
}: {
  opportunityId: string;
  suggestedIncumbent: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [isIncumbent, setIsIncumbent] = useState(false);
  const [pastPerformance, setPastPerformance] = useState("");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addCompetitorAction({
        opportunityId,
        name,
        isIncumbent,
        pastPerformance,
        strengths,
        weaknesses,
        notes,
      });
      if (!res.ok) return setError(res.error);
      setName("");
      setIsIncumbent(false);
      setPastPerformance("");
      setStrengths("");
      setWeaknesses("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 md:grid-cols-2"
      onSubmit={onSubmit}
    >
      <div>
        <label className="aur-label">Competitor name</label>
        <input
          className="aur-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedIncumbent || "e.g., Booz Allen"}
          required
        />
      </div>
      <div className="flex items-end">
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <input
            type="checkbox"
            className="accent-teal-400"
            checked={isIncumbent}
            onChange={(e) => setIsIncumbent(e.target.checked)}
          />
          <span className="font-mono text-[12px] text-text">Is incumbent</span>
        </label>
      </div>
      <div>
        <label className="aur-label">Past performance</label>
        <input
          className="aur-input"
          value={pastPerformance}
          onChange={(e) => setPastPerformance(e.target.value)}
          placeholder="Similar contracts, CPAR ratings, references"
        />
      </div>
      <div>
        <label className="aur-label">Notes</label>
        <input
          className="aur-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div>
        <label className="aur-label">Strengths</label>
        <textarea
          className="aur-input min-h-[70px] resize-y"
          value={strengths}
          onChange={(e) => setStrengths(e.target.value)}
        />
      </div>
      <div>
        <label className="aur-label">Weaknesses</label>
        <textarea
          className="aur-input min-h-[70px] resize-y"
          value={weaknesses}
          onChange={(e) => setWeaknesses(e.target.value)}
        />
      </div>

      {error ? (
        <div className="md:col-span-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add competitor"}
        </button>
      </div>
    </form>
  );
}

function CompetitorCard({
  opportunityId,
  competitor,
}: {
  opportunityId: string;
  competitor: CompetitorRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(competitor.name);
  const [isIncumbent, setIsIncumbent] = useState(competitor.isIncumbent);
  const [pastPerformance, setPastPerformance] = useState(
    competitor.pastPerformance,
  );
  const [strengths, setStrengths] = useState(competitor.strengths);
  const [weaknesses, setWeaknesses] = useState(competitor.weaknesses);
  const [notes, setNotes] = useState(competitor.notes);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCompetitorAction(competitor.id, opportunityId, {
        name,
        isIncumbent,
        pastPerformance,
        strengths,
        weaknesses,
        notes,
      });
      if (!res.ok) return setError(res.error);
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Remove competitor "${competitor.name}"?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await removeCompetitorAction(competitor.id, opportunityId);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-[14px] font-semibold text-text">
            {competitor.name}
            {competitor.isIncumbent ? (
              <span className="ml-2 rounded bg-gold/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-gold">
                Incumbent
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px]"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="aur-btn aur-btn-danger text-[11px]"
              disabled={pending}
              onClick={remove}
            >
              Remove
            </button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          {competitor.pastPerformance ? (
            <Field label="Past performance" value={competitor.pastPerformance} />
          ) : null}
          {competitor.notes ? (
            <Field label="Notes" value={competitor.notes} />
          ) : null}
          {competitor.strengths ? (
            <Field label="Strengths" value={competitor.strengths} />
          ) : null}
          {competitor.weaknesses ? (
            <Field label="Weaknesses" value={competitor.weaknesses} />
          ) : null}
        </div>
        {error ? (
          <div className="mt-2 font-mono text-[11px] text-rose">{error}</div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-teal-400/40 bg-white/[0.02] p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="aur-label">Name</label>
          <input
            className="aur-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
            <input
              type="checkbox"
              className="accent-teal-400"
              checked={isIncumbent}
              onChange={(e) => setIsIncumbent(e.target.checked)}
            />
            <span className="font-mono text-[12px] text-text">Is incumbent</span>
          </label>
        </div>
        <div>
          <label className="aur-label">Past performance</label>
          <input
            className="aur-input"
            value={pastPerformance}
            onChange={(e) => setPastPerformance(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Notes</label>
          <input
            className="aur-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Strengths</label>
          <textarea
            className="aur-input min-h-[70px] resize-y"
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
          />
        </div>
        <div>
          <label className="aur-label">Weaknesses</label>
          <textarea
            className="aur-input min-h-[70px] resize-y"
            value={weaknesses}
            onChange={(e) => setWeaknesses(e.target.value)}
          />
        </div>
      </div>
      {error ? (
        <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="aur-btn aur-btn-primary text-[11px]"
          disabled={pending || !name.trim()}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[11px]"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap font-mono text-[12px] text-text">
        {value}
      </div>
    </div>
  );
}
