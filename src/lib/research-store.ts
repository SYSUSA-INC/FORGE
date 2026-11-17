/**
 * BL-NAV-LIFECYCLE 5b — web research: the tenant's settings, the state the
 * settings panel shows, and the numbered sources stored on a proposal.
 *
 * Settings live in `tenant_subscription.custom_overrides.research`, next
 * to `aiBudget` and `prepareAhead` (no migration). Sources live in
 * `proposal_research_source` and are always read through the owning
 * proposal's organization. Server-only; callers own auth.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalResearchSources, proposals, tenantSubscriptions, type ProposalResearchSource } from "@/db/schema";
import { getAIProviderStatus, type AIProviderName } from "@/lib/ai";
import { recordAudit, recordRead } from "@/lib/audit-log";
import type { DraftSource } from "@/lib/citations";
import {
  DEFAULT_RESEARCH_SETTINGS,
  readResearchSettings,
  researchSettingsToJson,
  sanitizeResearchSettings,
  webSourceLabel,
  type ResearchSettings,
  type ResearchSourceDraft,
} from "@/lib/research-logic";
import { getWebSearchAllowance } from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type ResearchResult = { ok: true; settings: ResearchSettings; rejected: string[] } | { ok: false; error: string };

async function readOverrides(organizationId: string) {
  const [row] = await db
    .select({ overrides: tenantSubscriptions.customOverrides })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ? (row.overrides ?? {}) : null;
}

/** The tenant's settings; the default (off) when it has none or no subscription. */
export async function getResearchSettings(organizationId: string): Promise<ResearchSettings> {
  const overrides = await readOverrides(organizationId);
  return overrides ? readResearchSettings(overrides.research) : DEFAULT_RESEARCH_SETTINGS;
}

/** Store the switch, domain lists and the tenant's own monthly cap. Org admins only (the action checks). */
export async function setResearchSettings(input: {
  organizationId: string;
  input: { enabled?: unknown; allowedDomains?: unknown; blockedDomains?: unknown; monthlyCap?: unknown };
  actor: Actor;
}): Promise<ResearchResult> {
  const { organizationId } = input;
  const overrides = await readOverrides(organizationId);
  if (!overrides) return { ok: false, error: "This organization has no subscription yet." };
  const { settings, rejected } = sanitizeResearchSettings(input.input);
  if (rejected.length > 0) {
    return { ok: false, error: `Not a domain: ${rejected.slice(0, 3).join(", ")}. Use a bare domain such as agency.gov, with an optional path.` };
  }
  const previous = readResearchSettings(overrides.research);
  const { research: _old, ...rest } = overrides;
  void _old;
  const json = researchSettingsToJson(settings);
  const next = json ? { ...rest, research: json } : rest;
  await db
    .update(tenantSubscriptions)
    .set({ customOverrides: next, updatedAt: new Date() })
    .where(eq(tenantSubscriptions.organizationId, organizationId));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai_engine.research.update",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: {
      enabled: { from: previous.enabled, to: settings.enabled },
      allowedDomains: { from: previous.allowedDomains, to: settings.allowedDomains },
      blockedDomains: { from: previous.blockedDomains, to: settings.blockedDomains },
      monthlyCap: { from: previous.monthlyCap, to: settings.monthlyCap },
    },
  });
  return { ok: true, settings, rejected: [] };
}

export type ResearchState = {
  settings: ResearchSettings;
  planAllowance: number;
  /** After the tenant's own cap. */
  cap: number;
  used: number;
  remaining: number;
  trialEnded: boolean;
  /** Prepaid pack searches held; used only after the plan's. */
  packBalance: number;
  /** The plan's remaining plus the pack; 0 when the trial has ended. */
  available: number;
  provider: AIProviderName;
  /** True when research can actually run: the Anthropic provider is active. */
  providerReady: boolean;
};

export async function getResearchState(input: { organizationId: string }): Promise<ResearchState> {
  const [settings, allowance] = await Promise.all([getResearchSettings(input.organizationId), getWebSearchAllowance(input.organizationId)]);
  const provider = getAIProviderStatus().active.name;
  return { settings, ...allowance, provider, providerReady: provider === "anthropic" };
}

/** A proposal's research sources, numbered; the proposal must belong to the organization. */
export async function listResearchSources(input: { organizationId: string; proposalId: string }): Promise<ProposalResearchSource[]> {
  return db
    .select({ source: proposalResearchSources })
    .from(proposalResearchSources)
    .innerJoin(proposals, eq(proposals.id, proposalResearchSources.proposalId))
    .where(
      and(
        eq(proposalResearchSources.proposalId, input.proposalId),
        eq(proposalResearchSources.organizationId, input.organizationId),
        eq(proposals.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(proposalResearchSources.ordinal))
    .then((rows) => rows.map((r) => r.source));
}

/** A new run replaces the proposal's earlier set, all or nothing. */
export async function replaceResearchSources(input: {
  organizationId: string;
  proposalId: string;
  userId: string | null;
  sources: ResearchSourceDraft[];
  retrievedAt: Date;
}): Promise<number> {
  const { organizationId, proposalId } = input;
  const [owned] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!owned) return 0;
  await db.transaction(async (tx) => {
    await tx
      .delete(proposalResearchSources)
      .where(and(eq(proposalResearchSources.proposalId, proposalId), eq(proposalResearchSources.organizationId, organizationId)));
    if (input.sources.length > 0) {
      await tx.insert(proposalResearchSources).values(
        input.sources.map((s) => ({
          organizationId,
          proposalId,
          ordinal: s.ordinal,
          url: s.url,
          title: s.title,
          excerpt: s.excerpt,
          pageAge: s.pageAge,
          retrievedAt: input.retrievedAt,
          createdByUserId: input.userId,
        })),
      );
    }
  });
  return input.sources.length;
}

/**
 * The research sources as drafter sources, numbered after the company's own
 * (`firstIndex`). Empty unless the tenant's research switch is on, so a
 * tenant that turns research off stops drafting from older sources. Audited
 * as a read (`proposal.draft.research`).
 */
export async function researchSourcesForDraft(input: {
  organizationId: string;
  proposalId: string;
  firstIndex: number;
  actor: Actor;
}): Promise<DraftSource[]> {
  const settings = await getResearchSettings(input.organizationId);
  if (!settings.enabled) return [];
  const rows = await listResearchSources({ organizationId: input.organizationId, proposalId: input.proposalId });
  if (rows.length === 0) return [];
  await recordRead({
    organizationId: input.organizationId,
    actor: input.actor,
    action: "proposal.draft.research",
    resourceType: "proposal",
    resourceId: input.proposalId,
    metadata: { sources: rows.length },
  });
  return rows.map((r, i) => ({
    index: input.firstIndex + i,
    kind: "web" as const,
    label: webSourceLabel({ title: r.title, url: r.url, retrievedOn: r.retrievedAt.toISOString().slice(0, 10) }),
    excerpt: r.excerpt,
    href: r.url,
  }));
}
