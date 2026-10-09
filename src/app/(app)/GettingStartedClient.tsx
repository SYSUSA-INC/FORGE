"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { OnboardingState } from "@/lib/onboarding";
import {
  PROPOSAL_LIMITS,
  socioLabels,
  type OnboardingProfile,
  type OnboardingProposal,
} from "@/lib/onboarding-logic";
import type { ScoutRunSummary } from "@/lib/scout-logic";
import {
  applyOnboardingProposalAction,
  applySamGovOnboardingAction,
  proposeOnboardingAction,
} from "./getting-started-actions";

/**
 * BL-AIP-7d part ii — the Getting-started panel. Step 1 pulls the
 * SAM.gov registration by UEI; step 2 asks the AI for a starting setup
 * (capability statement, scout keywords, extra NAICS, target agencies),
 * every part of which the admin edits before saving; saving writes the
 * scout profile and a knowledge entry and can run the scout once.
 */
export function GettingStartedClient({ state }: { state: OnboardingState }) {
  const router = useRouter();
  const [profile, setProfile] = useState<OnboardingProfile>(state.profile);
  const [sbaDescriptions, setSbaDescriptions] = useState<string[]>([]);
  const [uei, setUei] = useState("");
  const [busy, setBusy] = useState<"sam" | "propose" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<OnboardingProposal | null>(null);
  const [meta, setMeta] = useState<{ stubbed: boolean; fallback: boolean; model: string } | null>(null);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [runScout, setRunScout] = useState(state.samConfigured);
  const [saved, setSaved] = useState<{
    entryId: string | null;
    keywords: string[];
    extraNaics: string[];
    scout: ScoutRunSummary | null;
  } | null>(null);

  const hasNaics = Boolean(profile.primaryNaics.trim()) || profile.naicsList.some((n) => n.trim());
  const setAsides = socioLabels(profile.socioEconomic);

  async function pullSam() {
    setBusy("sam");
    setError(null);
    try {
      const res = await applySamGovOnboardingAction(uei);
      if (!res.ok) setError(res.error);
      else {
        setProfile(res.profile);
        setSbaDescriptions(res.profile.sbaDescriptions ?? []);
        setUei("");
      }
    } finally {
      setBusy(null);
    }
  }

  async function propose() {
    setBusy("propose");
    setError(null);
    try {
      const res = await proposeOnboardingAction({ sbaDescriptions });
      if (!res.ok) setError(res.error);
      else {
        setProposal(res.proposal);
        setMeta({ stubbed: res.stubbed, fallback: res.fallback, model: res.model });
      }
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await applyOnboardingProposalAction(proposal, runScout);
      if (!res.ok) setError(res.error);
      else setSaved({ entryId: res.entryId, keywords: res.keywords, extraNaics: res.extraNaics, scout: res.scout });
    } finally {
      setBusy(null);
    }
  }

  function addKeyword() {
    const k = keywordDraft.trim();
    if (!k || !proposal) return;
    if (!proposal.scoutKeywords.some((x) => x.toLowerCase() === k.toLowerCase())) {
      setProposal({ ...proposal, scoutKeywords: [...proposal.scoutKeywords, k].slice(0, PROPOSAL_LIMITS.keywords) });
    }
    setKeywordDraft("");
  }

  return (
    <section className="mb-6">
      <Panel
        title="Getting started"
        eyebrow="Set up FORGE from your SAM.gov registration"
        accent="violet"
        actions={
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-subtle md:inline">
            Admins only · goes away once complete
          </span>
        }
      >
        {error ? <p className="mb-3 font-mono text-[11px] text-rose-300">{error}</p> : null}

        <ol className="grid gap-4 lg:grid-cols-2">
          {/* Step 1 — the registration */}
          <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-4">
            <StepHeader n={1} title="Your SAM.gov registration" done={Boolean(profile.uei.trim())} />
            {profile.uei ? (
              <div className="mt-2 space-y-1 font-body text-[13px] text-text">
                <div className="font-display text-[15px] font-semibold">{profile.name}</div>
                <div className="font-mono text-[11px] text-muted">
                  UEI {profile.uei}
                  {profile.cageCode ? ` · CAGE ${profile.cageCode}` : ""}
                  {profile.state ? ` · ${profile.state}` : ""}
                </div>
                <div className="font-mono text-[11px] text-muted">
                  {hasNaics
                    ? `NAICS ${[profile.primaryNaics, ...profile.naicsList.filter((n) => n !== profile.primaryNaics)].filter(Boolean).join(", ")}`
                    : "No NAICS on the registration — add them under Settings."}
                </div>
                {setAsides.length ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {setAsides.map((s) => (
                      <span key={s} className="aur-chip">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : null}
                <Link href="/settings" className="inline-block pt-1 font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
                  Edit in Settings →
                </Link>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="font-body text-[13px] leading-relaxed text-muted">
                  Enter your Unique Entity ID and FORGE fills in the company profile — name, address, NAICS codes and set-asides — from SAM.gov.
                </p>
                <div className="flex gap-2">
                  <input
                    value={uei}
                    onChange={(e) => setUei(e.target.value.toUpperCase())}
                    placeholder="12-character UEI"
                    maxLength={12}
                    disabled={busy !== null || !state.samConfigured}
                    className="aur-input max-w-[16rem] uppercase"
                    aria-label="Unique Entity ID"
                  />
                  <button
                    type="button"
                    onClick={pullSam}
                    disabled={busy !== null || !state.samConfigured || uei.trim().length !== 12}
                    className="aur-btn aur-btn-primary disabled:opacity-50"
                  >
                    {busy === "sam" ? "Pulling…" : "Pull from SAM.gov"}
                  </button>
                </div>
                {!state.samConfigured ? (
                  <p className="font-mono text-[11px] text-amber-200">
                    SAM.gov lookups need a SAM.gov API key. Add your company&apos;s key under{" "}
                    <Link href="/settings/integrations" className="underline">
                      Settings → Integrations
                    </Link>
                    , or fill the profile by hand under{" "}
                    <Link href="/settings" className="underline">
                      Settings
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
            )}
          </li>

          {/* Step 2 — the starting setup */}
          <li className="rounded-lg border border-layer/10 bg-layer/[0.02] p-4">
            <StepHeader n={2} title="A starting setup, proposed by the AI" done={saved !== null} />
            {saved ? (
              <SavedSummary saved={saved} onDone={() => router.refresh()} />
            ) : proposal ? (
              <div className="mt-2 space-y-3">
                {meta ? (
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                    {meta.fallback
                      ? meta.stubbed
                        ? "AI in stub mode · built from the registration only"
                        : "Built from the registration only (the model's answer was unusable)"
                      : `Proposed by ${meta.model || "the model"} · edit anything before saving`}
                  </p>
                ) : null}

                <label className="block">
                  <span className="aur-label">Capability statement (draft)</span>
                  <textarea
                    value={proposal.capabilityStatement}
                    onChange={(e) => setProposal({ ...proposal, capabilityStatement: e.target.value })}
                    rows={6}
                    maxLength={PROPOSAL_LIMITS.statementChars}
                    className="aur-input font-body leading-relaxed"
                  />
                  <span className="mt-1 block font-mono text-[10px] text-subtle">
                    Saved as a knowledge entry the Brain can cite. Bracketed placeholders mark facts only you can supply.
                  </span>
                </label>

                <ChipRow
                  label="Scout keywords"
                  items={proposal.scoutKeywords}
                  onRemove={(k) => setProposal({ ...proposal, scoutKeywords: proposal.scoutKeywords.filter((x) => x !== k) })}
                >
                  {proposal.scoutKeywords.length < PROPOSAL_LIMITS.keywords ? (
                    <input
                      value={keywordDraft}
                      onChange={(e) => setKeywordDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addKeyword();
                        }
                      }}
                      onBlur={addKeyword}
                      placeholder="Add a keyword ↵"
                      maxLength={PROPOSAL_LIMITS.keywordChars}
                      className="aur-input h-7 max-w-[12rem] px-2 py-0 text-[11px]"
                      aria-label="Add a scout keyword"
                    />
                  ) : null}
                </ChipRow>

                {proposal.extraNaics.length ? (
                  <ChipRow
                    label="Extra NAICS to watch"
                    items={proposal.extraNaics}
                    onRemove={(n) => setProposal({ ...proposal, extraNaics: proposal.extraNaics.filter((x) => x !== n) })}
                  />
                ) : null}

                {proposal.targetAgencies.length ? (
                  <div>
                    <span className="aur-label">Target agencies</span>
                    <ul className="space-y-1">
                      {proposal.targetAgencies.map((a) => (
                        <li key={a.name} className="flex items-start gap-2 rounded-md border border-layer/10 bg-layer/[0.03] px-3 py-1.5">
                          <span className="min-w-0 flex-1">
                            <span className="block font-body text-[13px] text-text">{a.name}</span>
                            {a.why ? <span className="block font-mono text-[10px] text-muted">{a.why}</span> : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => setProposal({ ...proposal, targetAgencies: proposal.targetAgencies.filter((x) => x.name !== a.name) })}
                            className="font-mono text-[10px] text-muted hover:text-rose-300"
                            aria-label={`Remove ${a.name}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    <span className="mt-1 block font-mono text-[10px] text-subtle">Kept with the capability statement for the Brain and the briefs.</span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button type="button" onClick={apply} disabled={busy !== null} className="aur-btn aur-btn-primary disabled:opacity-50">
                    {busy === "apply" ? (runScout ? "Saving and running the scout…" : "Saving…") : "Save to FORGE"}
                  </button>
                  <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
                    <input
                      type="checkbox"
                      checked={runScout}
                      onChange={(e) => setRunScout(e.target.checked)}
                      disabled={!state.samConfigured || busy !== null}
                    />
                    Run the scout now
                  </label>
                  <button type="button" onClick={propose} disabled={busy !== null} className="aur-btn-ghost px-0">
                    Propose again
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="font-body text-[13px] leading-relaxed text-muted">
                  From the registration alone, the AI drafts a capability statement, picks scout keywords and extra NAICS to watch, and names the agencies that buy this kind of work. You edit everything before it is saved.
                </p>
                <button
                  type="button"
                  onClick={propose}
                  disabled={busy !== null || !hasNaics}
                  className="aur-btn aur-btn-primary disabled:opacity-50"
                >
                  {busy === "propose" ? "Thinking…" : "Propose a starting setup"}
                </button>
                {!hasNaics ? (
                  <p className="font-mono text-[11px] text-subtle">Needs at least one NAICS code — finish step 1 first.</p>
                ) : state.aiStub ? (
                  <p className="font-mono text-[11px] text-amber-200">AI is in stub mode: the proposal will be built from the registration only.</p>
                ) : null}
              </div>
            )}
          </li>
        </ol>
      </Panel>
    </section>
  );
}

function ChipRow({
  label,
  items,
  onRemove,
  children,
}: {
  label: string;
  items: string[];
  onRemove: (item: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <span className="aur-label">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onRemove(item)}
            className="aur-chip hover:border-rose-300/40 hover:text-rose-300"
            title="Remove"
          >
            {item} ×
          </button>
        ))}
        {children}
      </div>
    </div>
  );
}

function StepHeader({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border font-mono text-xs ${
          done ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-violet/40 bg-violet/10 text-text"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span className="min-w-0 flex-1 font-display text-[13px] font-semibold text-text">{title}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">{done ? "Done" : "Open"}</span>
    </div>
  );
}

function SavedSummary({
  saved,
  onDone,
}: {
  saved: { entryId: string | null; keywords: string[]; extraNaics: string[]; scout: ScoutRunSummary | null };
  onDone: () => void;
}) {
  return (
    <div className="mt-2 space-y-2 font-body text-[13px] text-text">
      <ul className="space-y-1">
        {saved.entryId ? (
          <li>
            Capability statement saved as a knowledge entry —{" "}
            <Link href={`/knowledge-base/${saved.entryId}`} className="text-teal underline">
              open it
            </Link>
            .
          </li>
        ) : null}
        {saved.keywords.length ? (
          <li>
            Scout profile: {saved.keywords.length} keyword{saved.keywords.length === 1 ? "" : "s"}
            {saved.extraNaics.length ? ` and ${saved.extraNaics.length} extra NAICS` : ""} —{" "}
            <Link href="/opportunities/scout" className="text-teal underline">
              open the Scout
            </Link>
            .
          </li>
        ) : null}
        {saved.scout ? (
          <li className="font-mono text-[11px] text-muted">
            First scout run: {saved.scout.found} found · {saved.scout.created} new · {saved.scout.triaged} triaged
            {saved.scout.note ? ` · ${saved.scout.note}` : ""}
          </li>
        ) : null}
      </ul>
      <button type="button" onClick={onDone} className="aur-btn">
        Done
      </button>
    </div>
  );
}
