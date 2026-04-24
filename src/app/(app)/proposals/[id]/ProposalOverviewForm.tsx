"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProposalAction } from "../actions";

type TeamMember = { id: string; name: string | null; email: string };

export function ProposalOverviewForm({
  proposalId,
  initial,
  team,
}: {
  proposalId: string;
  initial: {
    title: string;
    notes: string;
    proposalManagerUserId: string | null;
    captureManagerUserId: string | null;
    pricingLeadUserId: string | null;
  };
  team: TeamMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [pm, setPm] = useState(initial.proposalManagerUserId ?? "");
  const [cm, setCm] = useState(initial.captureManagerUserId ?? "");
  const [pl, setPl] = useState(initial.pricingLeadUserId ?? "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await updateProposalAction(proposalId, {
        title,
        notes,
        proposalManagerUserId: pm || null,
        captureManagerUserId: cm || null,
        pricingLeadUserId: pl || null,
      });
      if (!res.ok) return setError(res.error);
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Title</label>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TeamField label="Proposal manager" value={pm} onChange={setPm} options={team} />
        <TeamField label="Capture manager" value={cm} onChange={setCm} options={team} />
        <TeamField label="Pricing lead" value={pl} onChange={setPl} options={team} />
      </div>

      <div>
        <label className="aur-label">Working notes</label>
        <textarea
          className="aur-input min-h-[140px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal strategy notes, win themes, open questions…"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          Saved.
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function TeamField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: TeamMember[];
}) {
  return (
    <div>
      <label className="aur-label">{label}</label>
      <select
        className="aur-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name ?? o.email}
          </option>
        ))}
      </select>
    </div>
  );
}
