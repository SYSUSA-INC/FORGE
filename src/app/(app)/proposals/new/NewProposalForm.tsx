"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProposalAction } from "../actions";

type OppOption = {
  id: string;
  title: string;
  agency: string;
  solicitationNumber: string;
};

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

export function NewProposalForm({
  opportunities,
  teamCandidates,
  currentUserId,
  defaultOpportunityId,
}: {
  opportunities: OppOption[];
  teamCandidates: TeamMember[];
  currentUserId: string;
  defaultOpportunityId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [opportunityId, setOpportunityId] = useState(
    defaultOpportunityId ?? opportunities[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [proposalManagerUserId, setProposalManagerUserId] =
    useState<string>(currentUserId);
  const [captureManagerUserId, setCaptureManagerUserId] = useState<string>("");
  const [pricingLeadUserId, setPricingLeadUserId] = useState<string>("");

  const selectedOpp = useMemo(
    () => opportunities.find((o) => o.id === opportunityId) ?? null,
    [opportunities, opportunityId],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createProposalAction({
        opportunityId,
        title: title || undefined,
        proposalManagerUserId: proposalManagerUserId || null,
        captureManagerUserId: captureManagerUserId || null,
        pricingLeadUserId: pricingLeadUserId || null,
      });
      if (!res.ok) return setError(res.error);
      router.push(`/proposals/${res.id}`);
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Opportunity</label>
        <select
          className="aur-input"
          value={opportunityId}
          onChange={(e) => setOpportunityId(e.target.value)}
          required
        >
          {opportunities.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
              {o.solicitationNumber ? ` · ${o.solicitationNumber}` : ""}
              {o.agency ? ` · ${o.agency}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="aur-label">Proposal title</label>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            selectedOpp
              ? `${selectedOpp.title} (defaults to opportunity title)`
              : ""
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TeamField
          label="Proposal manager"
          value={proposalManagerUserId}
          onChange={setProposalManagerUserId}
          options={teamCandidates}
        />
        <TeamField
          label="Capture manager"
          value={captureManagerUserId}
          onChange={setCaptureManagerUserId}
          options={teamCandidates}
        />
        <TeamField
          label="Pricing lead"
          value={pricingLeadUserId}
          onChange={setPricingLeadUserId}
          options={teamCandidates}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !opportunityId}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create proposal"}
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
