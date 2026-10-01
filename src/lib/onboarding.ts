/**
 * BL-AIP-7d part ii — AI-assisted onboarding from a UEI, server side:
 * the setup state, the SAM.gov pull (shared with Settings → Sync), the
 * `onboarding_assist` proposal (registration-only fallback without a
 * model) and the apply step (scout profile merge, capability knowledge
 * entry, optional first scout run). Every read and write carries
 * organizationId. Server-only; callers own auth (org admin for writes).
 */
import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeEntries, organizations } from "@/db/schema";
import { completeStructuredForTenant, getAIProviderStatus } from "@/lib/ai";
import {
  buildOnboardingAssistPrompt,
  ONBOARDING_ASSIST_PROMPT_VERSION,
  onboardingAssistSchema,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { embedKnowledgeEntry } from "@/lib/knowledge-entry-embed";
import { scoreKnowledgeEntry } from "@/lib/knowledge-quality";
import { log } from "@/lib/log";
import {
  agenciesToMetadata,
  CAPABILITY_ENTRY_TAGS,
  CAPABILITY_ENTRY_TITLE,
  fallbackProposal,
  onboardingStatus,
  proposalHasContent,
  sanitizeProposal,
  socioLabels,
  type OnboardingProfile,
  type OnboardingProposal,
  type OnboardingStatus,
} from "@/lib/onboarding-logic";
import { fetchSamGovByUei } from "@/lib/samgov";
import { getScoutProfile, runScoutForOrganization, saveScoutProfile } from "@/lib/scout";
import type { ScoutRunSummary } from "@/lib/scout-logic";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type OnboardingState = {
  profile: OnboardingProfile;
  status: OnboardingStatus;
  scoutKeywords: string[];
  /** SAMGOV_API_KEY is set, so a UEI lookup and a scout run can work. */
  samConfigured: boolean;
  /** The AI provider is the stub: proposals come from the registration only. */
  aiStub: boolean;
};

async function readProfile(organizationId: string): Promise<OnboardingProfile | null> {
  const [org] = await db
    .select({
      name: organizations.name,
      uei: organizations.uei,
      cageCode: organizations.cageCode,
      website: organizations.website,
      state: organizations.state,
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
      socioEconomic: organizations.socioEconomic,
      syncSource: organizations.syncSource,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org ? { ...org, sbaDescriptions: [] } : null;
}

export async function getOnboardingState(input: { organizationId: string }): Promise<OnboardingState | null> {
  const { organizationId } = input;
  const profile = await readProfile(organizationId);
  if (!profile) return null;
  const scout = await getScoutProfile({ organizationId });
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.organizationId, organizationId),
        eq(knowledgeEntries.kind, "capability"),
        isNull(knowledgeEntries.archivedAt),
      ),
    );
  const status = onboardingStatus({
    uei: profile.uei,
    primaryNaics: profile.primaryNaics,
    naicsList: profile.naicsList,
    scoutKeywords: scout.keywords,
    capabilityEntries: Number(row?.n ?? 0),
  });
  return {
    profile,
    status,
    scoutKeywords: scout.keywords,
    samConfigured: Boolean(process.env.SAMGOV_API_KEY),
    aiStub: getAIProviderStatus().active.name === "stub",
  };
}

export type SamGovApplyResult = { ok: true; profile: OnboardingProfile } | { ok: false; error: string };

/**
 * Pull the SAM.gov registration for a UEI and write it onto the
 * organization. Used by Settings → "Sync from SAM.gov" and by the
 * Getting-started panel; `via` tells the audit log which.
 */
export async function applySamGovProfile(input: {
  organizationId: string;
  uei: string;
  actor: Actor;
  via: "settings" | "onboarding";
}): Promise<SamGovApplyResult> {
  const { organizationId } = input;
  const uei = input.uei.trim();
  const result = await fetchSamGovByUei(uei);
  if (!result.ok) return { ok: false, error: result.error };
  const p = result.profile;

  await db
    .update(organizations)
    .set({
      name: p.name || undefined,
      website: p.website,
      uei: p.uei,
      cageCode: p.cageCode,
      dunsNumber: p.dunsNumber,
      addressLine1: p.address.line1,
      addressLine2: p.address.line2,
      city: p.address.city,
      state: p.address.state,
      zip: p.address.zip,
      country: p.address.country,
      contactName: p.contactName,
      contactTitle: p.contactTitle,
      phone: p.phone,
      email: p.email,
      primaryNaics: p.primaryNaics,
      naicsList: p.naicsList,
      socioEconomic: p.socioEconomic,
      syncSource: "samgov",
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "settings.samgov_sync",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { uei, via: input.via },
  });

  const profile = await readProfile(organizationId);
  if (!profile) return { ok: false, error: "Organization not found." };
  return { ok: true, profile: { ...profile, sbaDescriptions: p.sbaDescriptions } };
}

export type ProposeResult =
  | { ok: true; proposal: OnboardingProposal; stubbed: boolean; fallback: boolean; model: string }
  | { ok: false; error: string };

/** A starting setup proposed from the registration; the admin edits it before saving. */
export async function proposeOnboarding(input: {
  organizationId: string;
  actor: Actor;
  /** From a SAM.gov pull in the same session, when available. */
  sbaDescriptions?: string[];
}): Promise<ProposeResult> {
  const { organizationId } = input;
  const profile = await readProfile(organizationId);
  if (!profile) return { ok: false, error: "Organization not found." };
  const codes = [profile.primaryNaics, ...profile.naicsList].map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) {
    return {
      ok: false,
      error: "Pull the SAM.gov registration first, or set the NAICS codes under Settings, so the assistant has something to work from.",
    };
  }

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  const refund = () => refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);

  let proposal: OnboardingProposal;
  let fallback = false;
  let stubbed = false;
  let model = "";
  try {
    const prompt = buildOnboardingAssistPrompt({
      name: profile.name,
      state: profile.state,
      website: profile.website,
      primaryNaics: profile.primaryNaics,
      naicsList: profile.naicsList,
      certifications: socioLabels(profile.socioEconomic),
      sbaDescriptions: input.sbaDescriptions ?? [],
    });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "onboarding_assist",
      promptVersion: ONBOARDING_ASSIST_PROMPT_VERSION,
      schema: onboardingAssistSchema,
      toolName: "record_onboarding_setup",
      toolDescription: "Record the proposed starting setup for this company.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1_200,
      temperature: 0.4,
      cacheSystem: true,
    });
    stubbed = res.stubbed;
    model = res.model;
    const clean = res.data ? sanitizeProposal(res.data, codes) : null;
    if (clean && proposalHasContent(clean)) {
      proposal = clean;
    } else {
      fallback = true;
      proposal = fallbackProposal(profile);
      if (!res.stubbed) {
        await refund();
        log.warn("[onboarding]", "assist returned no data", { organizationId, error: res.parseError });
      }
    }
  } catch (err) {
    fallback = true;
    proposal = fallbackProposal(profile);
    await refund();
    log.error("[onboarding]", "assist failed", { organizationId, error: err });
  }

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "onboarding.assist.generate",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {
      keywords: proposal.scoutKeywords.length,
      extraNaics: proposal.extraNaics.length,
      agencies: proposal.targetAgencies.length,
      statementChars: proposal.capabilityStatement.length,
      fallback,
      stubbed,
      model,
      promptVersion: ONBOARDING_ASSIST_PROMPT_VERSION,
    },
  });
  return { ok: true, proposal, stubbed, fallback, model };
}

export type ApplyOnboardingResult =
  | {
      ok: true;
      entryId: string | null;
      keywords: string[];
      extraNaics: string[];
      scout: ScoutRunSummary | null;
    }
  | { ok: false; error: string };

/** Save what the admin kept of the proposal; optionally run the scout once. */
export async function applyOnboardingProposal(input: {
  organizationId: string;
  proposal: unknown;
  runScout: boolean;
  actor: Actor;
}): Promise<ApplyOnboardingResult> {
  const { organizationId } = input;
  const profile = await readProfile(organizationId);
  if (!profile) return { ok: false, error: "Organization not found." };
  const proposal = sanitizeProposal(input.proposal, [profile.primaryNaics, ...profile.naicsList]);
  if (!proposalHasContent(proposal)) {
    return { ok: false, error: "Nothing to save: keep a capability statement or at least one keyword." };
  }

  // Scout profile — merged with what is already there, never replacing it.
  let keywords: string[] = [];
  let extraNaics: string[] = [];
  if (proposal.scoutKeywords.length > 0 || proposal.extraNaics.length > 0) {
    const current = await getScoutProfile({ organizationId });
    const saved = await saveScoutProfile({
      organizationId,
      patch: {
        enabled: true,
        keywords: [...current.keywords, ...proposal.scoutKeywords],
        extraNaics: [...current.extraNaics, ...proposal.extraNaics],
      },
      actor: input.actor,
    });
    keywords = saved.keywords;
    extraNaics = saved.extraNaics;
  }

  // The capability statement becomes a knowledge entry the Brain can cite.
  let entryId: string | null = null;
  if (proposal.capabilityStatement) {
    const metadata: Record<string, string> = { source: "onboarding_assist" };
    if (profile.uei) metadata.uei = profile.uei;
    if (profile.primaryNaics) metadata.primaryNaics = profile.primaryNaics;
    if (proposal.targetAgencies.length > 0) metadata.targetAgencies = agenciesToMetadata(proposal.targetAgencies);
    const quality = scoreKnowledgeEntry({
      kind: "capability",
      title: CAPABILITY_ENTRY_TITLE,
      body: proposal.capabilityStatement,
      tags: CAPABILITY_ENTRY_TAGS,
      metadata,
    });
    const [row] = await db
      .insert(knowledgeEntries)
      .values({
        organizationId,
        kind: "capability",
        title: CAPABILITY_ENTRY_TITLE,
        body: proposal.capabilityStatement,
        tags: CAPABILITY_ENTRY_TAGS,
        metadata,
        outcomeLabel: "none",
        createdByUserId: input.actor.userId,
        qualityScore: quality.score,
        qualityScoreFactors: quality.factors,
        qualityScoredAt: new Date(),
      })
      .returning({ id: knowledgeEntries.id });
    entryId = row?.id ?? null;
    if (entryId) {
      await embedKnowledgeEntry(organizationId, entryId, CAPABILITY_ENTRY_TITLE, proposal.capabilityStatement).catch(
        (err) => log.warn("[onboarding]", "embed failed", { organizationId, error: err }),
      );
    }
  }

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "onboarding.apply",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {
      entryId,
      keywords: proposal.scoutKeywords,
      extraNaics: proposal.extraNaics,
      agencies: proposal.targetAgencies.map((a) => a.name),
      runScout: input.runScout,
    },
  });

  let scout: ScoutRunSummary | null = null;
  if (input.runScout) {
    try {
      scout = await runScoutForOrganization({
        organizationId,
        trigger: "manual",
        requestedByUserId: input.actor.userId,
      });
      await recordAudit({
        organizationId,
        actor: input.actor,
        action: "scout.run",
        resourceType: "scout_run",
        resourceId: scout.runId ?? undefined,
        metadata: { ...scout, via: "onboarding" },
      });
    } catch (err) {
      log.error("[onboarding]", "first scout run failed", { organizationId, error: err });
      scout = null;
    }
  }

  return { ok: true, entryId, keywords, extraNaics, scout };
}
