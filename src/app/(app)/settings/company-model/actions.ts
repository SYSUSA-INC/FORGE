"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizationModels, organizationModelVersions } from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import { recordAudit } from "@/lib/audit-log";
import { requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { acceptCompanyModel, companyModelBodySchema, sanitizeCompanyModelBody } from "@/lib/company-model";
import { loadCompanyModelInputs } from "@/lib/company-model-inputs";
import { buildCompanyModelPrompt } from "@/lib/company-model-prompt";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-COMPANY-MODEL phase 1a — build, edit, approve and discard the
 * company model. Org admins only (the design's decision 1). A draft
 * never counts: readers use the approved body, and only Approve writes
 * it, with a version row.
 */
type Result = { ok: true } | { ok: false; error: string };
const PAGE = "/settings/company-model";

async function loadRow(organizationId: string) {
  const [row] = await db.select().from(organizationModels).where(eq(organizationModels.organizationId, organizationId)).limit(1);
  return row ?? null;
}

export async function buildCompanyModelAction(): Promise<
  { ok: true; registrationOnly: boolean; capabilities: number } | { ok: false; error: string }
> {
  const { organizationId } = await requireCurrentOrg();
  const user = await requireOrgAdmin(organizationId);

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  const limit = await enforceRateLimit({ key: `company-model:${organizationId}`, limit: 5, windowSeconds: 3600 });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: `Model-building limit reached (5/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.` };
  }

  const inputs = await loadCompanyModelInputs(organizationId);
  if (!inputs) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "Organization not found." };
  }
  const existing = await loadRow(organizationId);
  const prompt = buildCompanyModelPrompt({
    ...inputs.prompt,
    approved: existing?.approved ? JSON.stringify(existing.approved, null, 1).slice(0, 8_000) : null,
  });
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "company_model",
    schema: companyModelBodySchema,
    toolName: "record_company_model",
    toolDescription: "Record the company model: summary, capabilities with evidence ids, NAICS work, customers, differentiators, gaps, partners and keywords.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 4000,
    temperature: 0.2,
    cacheSystem: true,
  });
  if (res.stubbed) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "AI provider is in stub mode — configure a provider to build the model." };
  }
  if (!res.data) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.warn("[buildCompanyModelAction]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
    return { ok: false, error: "AI returned an unexpected format. Try again." };
  }

  const draft = acceptCompanyModel({ parsed: res.data, allowedEvidence: inputs.allowedEvidence, naicsCodes: inputs.naicsCodes });
  const now = new Date();
  await db
    .insert(organizationModels)
    .values({
      organizationId,
      draft,
      draftSources: inputs.sources,
      draftGeneratedAt: now,
      draftModel: res.model,
      draftPromptVersion: PROMPT_VERSIONS.company_model,
      draftEditedByUserId: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: organizationModels.organizationId,
      set: { draft, draftSources: inputs.sources, draftGeneratedAt: now, draftModel: res.model, draftPromptVersion: PROMPT_VERSIONS.company_model, draftEditedByUserId: null, updatedAt: now },
    });
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "organization.model.build",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {
      capabilities: draft.capabilities.length,
      keywords: draft.keywords.length,
      registrationOnly: inputs.sources.registrationOnly,
      sources: { knowledge: inputs.sources.knowledgeEntryIds.length, pastPerformance: inputs.sources.pastPerformanceIds.length, proposals: inputs.sources.proposalIds.length, questionnaires: inputs.sources.questionnaireOpportunityIds.length },
      revision: !!existing?.approved,
      model: res.model,
    },
  });
  revalidatePath(PAGE);
  return { ok: true, registrationOnly: inputs.sources.registrationOnly, capabilities: draft.capabilities.length };
}

export async function saveCompanyModelDraftAction(input: { body: unknown }): Promise<Result> {
  const { organizationId } = await requireCurrentOrg();
  const user = await requireOrgAdmin(organizationId);
  const body = sanitizeCompanyModelBody(input.body);
  if (!body) return { ok: false, error: "The draft has a field that is too long or malformed." };
  const now = new Date();
  await db
    .insert(organizationModels)
    .values({ organizationId, draft: body, draftGeneratedAt: now, draftEditedByUserId: user.id, updatedAt: now })
    .onConflictDoUpdate({ target: organizationModels.organizationId, set: { draft: body, draftEditedByUserId: user.id, updatedAt: now } });
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "organization.model.edit",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { capabilities: body.capabilities.length },
  });
  revalidatePath(PAGE);
  return { ok: true };
}

export async function approveCompanyModelAction(input: { body: unknown }): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { organizationId } = await requireCurrentOrg();
  const user = await requireOrgAdmin(organizationId);
  const body = sanitizeCompanyModelBody(input.body);
  if (!body) return { ok: false, error: "The draft has a field that is too long or malformed." };
  if (!body.summary && body.capabilities.length === 0) return { ok: false, error: "Write a summary or at least one capability before approving." };
  const row = await loadRow(organizationId);
  const version = (row?.approvedVersion ?? 0) + 1;
  const sources = row?.draftSources ?? null;
  const now = new Date();
  await db
    .insert(organizationModels)
    .values({ organizationId, approved: body, approvedSources: sources, approvedVersion: version, approvedByUserId: user.id, approvedAt: now, draft: null, draftSources: null, draftGeneratedAt: null, draftEditedByUserId: null, staleReasons: [], updatedAt: now })
    .onConflictDoUpdate({
      target: organizationModels.organizationId,
      set: { approved: body, approvedSources: sources, approvedVersion: version, approvedByUserId: user.id, approvedAt: now, draft: null, draftSources: null, draftGeneratedAt: null, draftEditedByUserId: null, staleReasons: [], updatedAt: now },
    });
  await db.insert(organizationModelVersions).values({ organizationId, version, body, sources, approvedByUserId: user.id, approvedAt: now });
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "organization.model.approve",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { version, capabilities: body.capabilities.length, keywords: body.keywords.length },
  });
  revalidatePath(PAGE);
  revalidatePath("/");
  return { ok: true, version };
}

export async function discardCompanyModelDraftAction(): Promise<Result> {
  const { organizationId } = await requireCurrentOrg();
  const user = await requireOrgAdmin(organizationId);
  const row = await loadRow(organizationId);
  if (!row?.draft) return { ok: true };
  await db
    .update(organizationModels)
    .set({ draft: null, draftSources: null, draftGeneratedAt: null, draftEditedByUserId: null, updatedAt: new Date() })
    .where(and(eq(organizationModels.id, row.id), eq(organizationModels.organizationId, organizationId)));
  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "organization.model.discard",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {},
  });
  revalidatePath(PAGE);
  return { ok: true };
}
