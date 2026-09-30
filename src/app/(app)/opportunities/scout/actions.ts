"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import {
  decideScoutCandidate,
  runScoutForOrganization,
  saveScoutProfile,
  type ScoutDecideResult,
} from "@/lib/scout";
import type { ScoutDecision, ScoutProfileView, ScoutRunSummary } from "@/lib/scout-logic";

/**
 * BL-AIP-7b — the Scout page's actions. Settings and "run now" are for
 * org admins; import / dismiss is for any member, since importing is
 * the same as creating an opportunity by hand.
 */

function splitTerms(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveScoutProfileAction(input: {
  enabled: boolean;
  keywords: string;
  extraNaics: string;
  postedDaysBack: number;
}): Promise<{ ok: true; profile: ScoutProfileView } | { ok: false; error: string }> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  try {
    const profile = await saveScoutProfile({
      organizationId,
      patch: {
        enabled: !!input.enabled,
        keywords: splitTerms(String(input.keywords ?? "")),
        extraNaics: splitTerms(String(input.extraNaics ?? "")),
        postedDaysBack: Number(input.postedDaysBack) || 3,
      },
      actor: { userId: actor.id, email: actor.email },
    });
    revalidatePath("/opportunities/scout");
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function runScoutNowAction(): Promise<
  { ok: true; summary: ScoutRunSummary } | { ok: false; error: string }
> {
  const { organizationId } = await requireCurrentOrg();
  const actor = await requireOrgAdmin(organizationId);
  try {
    const summary = await runScoutForOrganization({
      organizationId,
      trigger: "manual",
      requestedByUserId: actor.id,
    });
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "scout.run",
      resourceType: "scout_run",
      resourceId: summary.runId ?? undefined,
      metadata: { ...summary },
    });
    revalidatePath("/opportunities/scout");
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Run failed." };
  }
}

export async function decideScoutCandidateAction(
  candidateId: string,
  decision: ScoutDecision,
): Promise<ScoutDecideResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (decision !== "imported" && decision !== "dismissed") {
    return { ok: false, error: "Unknown decision." };
  }
  const res = await decideScoutCandidate({
    organizationId,
    candidateId,
    decision,
    actor: { userId: actor.id, email: actor.email },
  });
  if (res.ok) {
    revalidatePath("/opportunities/scout");
    revalidatePath("/opportunities");
    revalidatePath("/");
  }
  return res;
}
