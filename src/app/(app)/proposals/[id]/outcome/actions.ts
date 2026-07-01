"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  proposalDebriefs,
  proposalOutcomes,
  proposals,
  type ProposalDebriefFormat,
  type ProposalDebriefStatus,
  type ProposalOutcomeReason,
  type ProposalOutcomeType,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { propagateOutcomeToCorpus } from "@/lib/knowledge-outcome";
import { OUTCOME_REASONS } from "@/lib/proposal-outcome-types";
import { log } from "@/lib/log";

const OUTCOME_TYPES: ProposalOutcomeType[] = [
  "won",
  "lost",
  "no_bid",
  "withdrawn",
];

const DEBRIEF_STATUSES: ProposalDebriefStatus[] = [
  "not_requested",
  "requested",
  "scheduled",
  "held",
  "declined_by_govt",
  "not_offered",
  "waived",
];

const DEBRIEF_FORMATS: ProposalDebriefFormat[] = [
  "written",
  "oral",
  "both",
  "unknown",
];

async function ownsProposal(id: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id, stage: proposals.stage })
    .from(proposals)
    .where(
      and(eq(proposals.id, id), eq(proposals.organizationId, organizationId)),
    )
    .limit(1);
  return row ?? null;
}

function parseDate(value: FormDataEntryValue | null): Date | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function saveOutcomeAction(
  proposalId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const owned = await ownsProposal(proposalId, organizationId);
  if (!owned) return { ok: false, error: "Proposal not found." };

  const outcomeTypeRaw = getString(formData, "outcomeType");
  if (!OUTCOME_TYPES.includes(outcomeTypeRaw as ProposalOutcomeType)) {
    return { ok: false, error: "Pick an outcome type." };
  }
  const outcomeType = outcomeTypeRaw as ProposalOutcomeType;

  const reasonsRaw = formData.getAll("reasons");
  const reasons = reasonsRaw
    .map((r) => (typeof r === "string" ? r : ""))
    .filter((r): r is ProposalOutcomeReason =>
      OUTCOME_REASONS.includes(r as ProposalOutcomeReason),
    );

  const decisionDate = parseDate(formData.get("decisionDate"));

  const payload = {
    organizationId,
    proposalId,
    outcomeType,
    awardValue: getString(formData, "awardValue"),
    decisionDate,
    reasons,
    summary: getString(formData, "summary"),
    lessonsLearned: getString(formData, "lessonsLearned"),
    followUpActions: getString(formData, "followUpActions"),
    awardedToCompetitor: getString(formData, "awardedToCompetitor"),
    createdByUserId: user.id,
    updatedAt: new Date(),
  };

  try {
    const [existing] = await db
      .select({ id: proposalOutcomes.id })
      .from(proposalOutcomes)
      .where(eq(proposalOutcomes.proposalId, proposalId))
      .limit(1);

    if (existing) {
      const { createdByUserId: _ignored, ...update } = payload;
      void _ignored;
      await db
        .update(proposalOutcomes)
        .set(update)
        .where(eq(proposalOutcomes.id, existing.id));
    } else {
      await db.insert(proposalOutcomes).values(payload);
    }

    const stageMap: Record<ProposalOutcomeType, string> = {
      won: "awarded",
      lost: "lost",
      no_bid: "no_bid",
      withdrawn: "no_bid",
    };
    if (owned.stage !== stageMap[outcomeType]) {
      await db
        .update(proposals)
        .set({
          stage: stageMap[outcomeType] as never,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, proposalId));
    }

    // Phase 14a: propagate the outcome to the harvested artifact and
    // any entries promoted from it. Best-effort — don't fail the save
    // if the corpus update errors, since the outcome row is the
    // source of truth.
    try {
      const propagated = await propagateOutcomeToCorpus(
        proposalId,
        outcomeType,
      );

      // BL-FB-X-BRAIN-MINE — wins must end up in the Brain. The
      // standard pipeline harvests on stage=submitted transition;
      // proposals that go straight to "won" (e.g. uploaded after the
      // fact, or that skipped submitted in the stage progression)
      // never get mined unless we kick off a harvest here. Fire-and-
      // forget so the outcome save isn't blocked by AI extraction.
      if (outcomeType === "won" && propagated.artifactsTagged === 0) {
        const { harvestProposalToCorpusAction } = await import(
          "../harvest-actions"
        );
        void harvestProposalToCorpusAction(proposalId).catch((err) => {
          log.warn("[saveOutcomeAction]", "win-harvest failed", { error: err });
        });
      }
    } catch (err) {
      log.warn("[saveOutcomeAction]", "propagateOutcomeToCorpus failed", { error: err });
    }
    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "proposal.outcome.save",
      resourceType: "proposal_outcome",
      resourceId: proposalId,
      metadata: {
        proposalId,
        outcomeType,
        reasonsCount: reasons.length,
      },
    });
    revalidatePath(`/proposals/${proposalId}`);
    revalidatePath(`/proposals/${proposalId}/outcome`);
    revalidatePath(`/proposals`);
    revalidatePath(`/knowledge-base`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    log.error("[saveOutcomeAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save outcome.",
    };
  }
}

export async function saveDebriefAction(
  proposalId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await ownsProposal(proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }

  const statusRaw = getString(formData, "status");
  if (!DEBRIEF_STATUSES.includes(statusRaw as ProposalDebriefStatus)) {
    return { ok: false, error: "Pick a debrief status." };
  }
  const formatRaw = getString(formData, "format") || "unknown";
  if (!DEBRIEF_FORMATS.includes(formatRaw as ProposalDebriefFormat)) {
    return { ok: false, error: "Pick a debrief format." };
  }

  const [outcome] = await db
    .select({ id: proposalOutcomes.id })
    .from(proposalOutcomes)
    .where(eq(proposalOutcomes.proposalId, proposalId))
    .limit(1);

  const payload = {
    organizationId,
    proposalId,
    outcomeId: outcome?.id ?? null,
    status: statusRaw as ProposalDebriefStatus,
    format: formatRaw as ProposalDebriefFormat,
    requestedAt: parseDate(formData.get("requestedAt")),
    scheduledFor: parseDate(formData.get("scheduledFor")),
    heldOn: parseDate(formData.get("heldOn")),
    governmentAttendees: getString(formData, "governmentAttendees"),
    ourAttendees: getString(formData, "ourAttendees"),
    strengths: getString(formData, "strengths"),
    weaknesses: getString(formData, "weaknesses"),
    improvements: getString(formData, "improvements"),
    pastPerformanceCitation: getString(formData, "pastPerformanceCitation"),
    notes: getString(formData, "notes"),
    createdByUserId: user.id,
    updatedAt: new Date(),
  };

  try {
    const [existing] = await db
      .select({ id: proposalDebriefs.id })
      .from(proposalDebriefs)
      .where(eq(proposalDebriefs.proposalId, proposalId))
      .limit(1);

    if (existing) {
      const { createdByUserId: _ignored, ...update } = payload;
      void _ignored;
      await db
        .update(proposalDebriefs)
        .set(update)
        .where(eq(proposalDebriefs.id, existing.id));
    } else {
      await db.insert(proposalDebriefs).values(payload);
    }

    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "proposal.debrief.save",
      resourceType: "proposal_debrief",
      resourceId: proposalId,
      metadata: {
        proposalId,
        status: statusRaw,
        format: formatRaw,
      },
    });

    revalidatePath(`/proposals/${proposalId}/outcome`);
    return { ok: true };
  } catch (err) {
    log.error("[saveDebriefAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save debrief.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// BL-FB-WIN-DEBRIEF-REQ — debrief request letter generator.
// Pure template — no AI call, no quota. Picks the right FAR citation
// based on procurement type (setAside, contractType).
// ─────────────────────────────────────────────────────────────────

function pickFarCite(
  setAside: string,
  contractType: string,
): { cite: string; title: string; deadlineDays: number; questions: string[] } {
  const lc = (s: string) => s.toLowerCase();

  // GSA Schedule / FSS → FAR 8.405-2(d)
  if (
    lc(contractType).includes("schedule") ||
    lc(contractType).includes("fss") ||
    lc(contractType).includes("gsa") ||
    lc(setAside).includes("schedule")
  ) {
    return {
      cite: "FAR 8.405-2(d)",
      title: "Federal Supply Schedule Task Order",
      deadlineDays: 5,
      questions: [
        "The evaluation rating for our quotation for each evaluation factor and an overall rating.",
        "A summary of the rationale for the award decision.",
        "The total evaluated price of the awardee and our total evaluated price, if available.",
      ],
    };
  }

  // IDIQ / Task Order (non-schedule) → FAR 16.505(b)(6)
  if (
    lc(contractType).includes("idiq") ||
    lc(contractType).includes("task order") ||
    lc(contractType).includes("to") ||
    lc(contractType).includes("delivery order")
  ) {
    return {
      cite: "FAR 16.505(b)(6)",
      title: "IDIQ / Task Order",
      deadlineDays: 5,
      questions: [
        "An overall summary of the Government's basis for the award, including significant discriminators between our proposal and the successful contractor's proposal.",
        "Our technical approach rating relative to the successful contractor's rating.",
        "Our price or cost relative to the successful contractor's price or cost.",
        "Past performance ratings for all evaluated offerors, to the extent permitted by law.",
      ],
    };
  }

  // Default: full-and-open negotiated acquisition → FAR 15.506
  return {
    cite: "FAR 15.506",
    title: "Negotiated Acquisition",
    deadlineDays: 5,
    questions: [
      "The Government's evaluation of the significant weaknesses or deficiencies in our proposal, if applicable.",
      "The overall evaluated cost or price and technical rating of the successful offeror and our overall evaluated cost or price and technical rating (to the extent it is releasable).",
      "The rationale for award, including the basis for the selection decision.",
      "The Government's evaluation of our past performance.",
      "Reasonable responses to relevant questions about whether source selection procedures contained in the solicitation, applicable regulations, and other applicable authorities were followed in the process of awarding the contract.",
    ],
  };
}

function addBusinessDays(from: Date, days: number): Date {
  let d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export type DebriefRequestLetterResult =
  | { ok: true; letter: string; farCite: string }
  | { ok: false; error: string };

export async function generateDebriefRequestLetterAction(
  proposalId: string,
): Promise<DebriefRequestLetterResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const owned = await ownsProposal(proposalId, organizationId);
  if (!owned) return { ok: false, error: "Proposal not found." };

  const [prop] = await db
    .select({
      title: proposals.title,
      opportunityId: proposals.opportunityId,
      submittedAt: proposals.submittedAt,
    })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!prop) return { ok: false, error: "Proposal not found." };

  const [opp] = await db
    .select({
      agency: opportunities.agency,
      office: opportunities.office,
      solicitationNumber: opportunities.solicitationNumber,
      setAside: opportunities.setAside,
      contractType: opportunities.contractType,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, prop.opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);

  const agency = opp?.agency ?? "Contracting Agency";
  const office = opp?.office ?? "Contracting Office";
  const solNum = opp?.solicitationNumber ?? "N/A";
  const setAside = opp?.setAside ?? "";
  const contractType = opp?.contractType ?? "";

  const { cite, title, deadlineDays, questions } = pickFarCite(setAside, contractType);

  const today = new Date();
  const todayStr = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const deadline = addBusinessDays(today, deadlineDays);
  const deadlineStr = deadline.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const questionsList = questions
    .map((q, i) => `  ${i + 1}. ${q}`)
    .join("\n");

  const letter = `${todayStr}

Contracting Officer
${office}
${agency}

Subject: Request for Post-Award Debriefing — ${prop.title}
Solicitation No.: ${solNum}

Dear Contracting Officer,

Pursuant to ${cite} (${title}), we respectfully request a post-award debriefing regarding the above-referenced solicitation in which our organization submitted an offer and was not selected for award.

We request that the debriefing address, at minimum, the following:

${questionsList}

We understand that, pursuant to ${cite}, the Government shall provide a debriefing within five (5) business days of our written request. We would appreciate scheduling the debriefing at your earliest convenience and no later than ${deadlineStr}.

We prefer a written debriefing if available; however, we are open to an oral format. Please advise us of the date, time, and format of the debriefing.

Thank you for your consideration and the opportunity to submit a proposal.

Respectfully,

[Name]
[Title]
[Company Name]
[Address]
[Phone] | [Email]

---
Note: This letter is generated as a template. Verify the applicable FAR citation (${cite}) against the actual solicitation and procurement vehicle before sending. Legal counsel review is recommended.`;

  return { ok: true, letter, farCite: cite };
}
