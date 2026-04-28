"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { opportunities, opportunityActivities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { aiExtractEbuy } from "@/lib/ebuy-extract";
import type { EbuyExtractionResult } from "@/lib/ai-prompts";

export type EbuyParseResult =
  | {
      ok: true;
      data: EbuyExtractionResult;
      provider: string;
      model: string;
      stubbed: boolean;
    }
  | { ok: false; error: string };

export async function parseEbuyTextAction(
  rawText: string,
): Promise<EbuyParseResult> {
  await requireAuth();
  await requireCurrentOrg();

  if (!rawText || rawText.trim().length === 0) {
    return { ok: false, error: "Paste the eBuy RFQ body before extracting." };
  }
  if (rawText.length > 200_000) {
    return {
      ok: false,
      error:
        "Pasted text is unusually long. Trim to the RFQ body and resubmit (or use the file-upload solicitation intake for full RFPs).",
    };
  }

  return aiExtractEbuy(rawText);
}

export type EbuyCreateInput = {
  title: string;
  rfqNumber: string;
  buyingAgency: string;
  vehicle: string;
  naicsCode: string;
  setAside: string;
  responseDueDate: string | null;
  placeOfPerformance: string;
  scopeSummary: string;
  clinSummary: string;
  notes: string;
  /** Original pasted text — stored on the activity entry so the trail is honest about the source. */
  rawText: string;
};

export type EbuyCreateResult =
  | { ok: true; opportunityId: string }
  | { ok: false; error: string };

export async function createOpportunityFromEbuyAction(
  input: EbuyCreateInput,
): Promise<EbuyCreateResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!input.title.trim()) {
    return { ok: false, error: "Title is required." };
  }

  // Compose a description with vehicle, scope, CLINs, and notes so the
  // capture lead doesn't lose the structured detail when they jump to
  // the opportunity record.
  const descriptionParts: string[] = [];
  if (input.scopeSummary.trim()) descriptionParts.push(input.scopeSummary.trim());
  if (input.clinSummary.trim()) {
    descriptionParts.push(`\nCLINs / line items:\n${input.clinSummary.trim()}`);
  }
  if (input.notes.trim()) {
    descriptionParts.push(`\nNotes:\n${input.notes.trim()}`);
  }
  const description = descriptionParts.join("\n\n");

  const due =
    input.responseDueDate && input.responseDueDate.match(/^\d{4}-\d{2}-\d{2}/)
      ? new Date(input.responseDueDate)
      : null;

  // The vehicle goes into the agency field as a prefix so it shows on
  // pipeline rows. e.g. "GSA Polaris · Department of Veterans Affairs".
  const agency = [
    input.vehicle.trim() ? `GSA ${input.vehicle.trim()}` : "GSA",
    input.buyingAgency.trim(),
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    const [opp] = await db
      .insert(opportunities)
      .values({
        organizationId,
        title: input.title.trim(),
        agency,
        office: "",
        stage: "identified",
        solicitationNumber: input.rfqNumber.trim(),
        noticeId: "",
        responseDueDate: due,
        naicsCode: input.naicsCode.trim(),
        setAside: input.setAside.trim(),
        placeOfPerformance: input.placeOfPerformance.trim(),
        description,
        ownerUserId: actor.id,
        createdByUserId: actor.id,
      })
      .returning({ id: opportunities.id });

    if (!opp) return { ok: false, error: "Could not create opportunity." };

    // Drop the raw paste on an activity entry so the source-of-truth is
    // recoverable from the opportunity timeline.
    await db.insert(opportunityActivities).values({
      opportunityId: opp.id,
      userId: actor.id,
      kind: "note",
      title: "Created from eBuy paste",
      body: input.rawText.slice(0, 50_000),
      metadata: { source: "ebuy-paste" },
    });

    revalidatePath("/opportunities");
    revalidatePath(`/opportunities/${opp.id}`);
    return { ok: true, opportunityId: opp.id };
  } catch (err) {
    console.error("[createOpportunityFromEbuyAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}
