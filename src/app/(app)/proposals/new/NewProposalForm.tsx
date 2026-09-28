"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProposalAction } from "../actions";

type OppOption = {
  id: string;
  title: string;
  agency: string;
  solicitationNumber: string;
  /** BL-AIP-5b — a parsed solicitation with instructions to offerors exists. */
  hasSectionL?: boolean;
};

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type TemplateOption = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
};

export function NewProposalForm({
  opportunities,
  teamCandidates,
  templates,
  currentUserId,
  defaultOpportunityId,
}: {
  opportunities: OppOption[];
  teamCandidates: TeamMember[];
  templates: TemplateOption[];
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
  const defaultTemplate = templates.find((t) => t.isDefault) ?? templates[0];
  const [templateId, setTemplateId] = useState<string>(defaultTemplate?.id ?? "");
  const [proposalManagerUserId, setProposalManagerUserId] =
    useState<string>(currentUserId);
  const [captureManagerUserId, setCaptureManagerUserId] = useState<string>("");
  const [pricingLeadUserId, setPricingLeadUserId] = useState<string>("");
  // BL-AIP-5b — on by default whenever the opportunity has instructions;
  // the user can keep the template instead.
  const [bootstrap, setBootstrap] = useState(true);

  const selectedOpp = useMemo(
    () => opportunities.find((o) => o.id === opportunityId) ?? null,
    [opportunities, opportunityId],
  );
  const canBootstrap = !!selectedOpp?.hasSectionL;
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createProposalAction({
        opportunityId,
        title: title || undefined,
        templateId: templateId || null,
        proposalManagerUserId: proposalManagerUserId || null,
        captureManagerUserId: captureManagerUserId || null,
        pricingLeadUserId: pricingLeadUserId || null,
        bootstrapFromSolicitation: canBootstrap && bootstrap,
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
        <label className="aur-label">
          Template{" "}
          {templates.length === 0 ? (
            <span className="text-subtle">
              (no templates yet — using built-in defaults)
            </span>
          ) : null}
        </label>
        {templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-layer/10 bg-layer/[0.02] px-3 py-2 font-mono text-[11px] text-muted">
            New proposal will use the built-in 6-section default. An admin
            can create org templates in Settings → Templates.
          </div>
        ) : (
          <>
            <select
              className="aur-input"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? " · default" : ""}
                </option>
              ))}
            </select>
            {selectedTemplate?.description ? (
              <div className="mt-1 font-mono text-[10px] text-muted">
                {selectedTemplate.description}
              </div>
            ) : null}
          </>
        )}
      </div>

      {canBootstrap ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={bootstrap}
            onChange={(e) => setBootstrap(e.target.checked)}
          />
          <span className="font-mono text-[11px] text-text">
            Build the outline from the solicitation&apos;s Section L
            <span className="block text-muted">
              Sections in the instructed order with their page caps and a brief
              each, the due date, and 1–3 proposed win themes from Section M.
              Replaces the template&apos;s section list; one AI request.
            </span>
          </span>
        </label>
      ) : null}

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
          {pending
            ? canBootstrap && bootstrap
              ? "Creating… reading Section L"
              : "Creating…"
            : "Create proposal"}
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
