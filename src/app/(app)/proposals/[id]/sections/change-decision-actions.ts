"use server";

/**
 * BL-9 Slice 7 — record accept / reject decisions on tracked changes.
 *
 * The editor resolves changes client-side (no round-trip; Slice 3). This
 * action is the write-behind: the `TrackChanges` extension's
 * `onDecision` callback hands the host the resolved changes and the
 * host calls this fire-and-forget. Each call inserts one
 * `section_change_decision` row per change and one audit row per batch,
 * which is the audit log Slice 3 deferred to here.
 *
 * Gates: auth, org scope through the proposal, and the same ownership
 * rule the editor applies (section author, an ownerless section, or an
 * org admin). A mismatch is audited and refused; it never throws into
 * the editor.
 */

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { proposalSections, proposals, sectionChangeDecisions } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { countWords } from "@/lib/edit-feedback-summary";
import { log } from "@/lib/log";

const MAX_DECISIONS = 200;
const MAX_TEXT_CHARS = 2000;
const MAX_ID_CHARS = 64;
const MAX_AUTHOR_CHARS = 128;

export type ChangeDecisionInput = {
  id: string;
  type: "insert" | "delete";
  decision: "accept" | "reject";
  authorId?: string;
  authorName?: string;
  text?: string;
};

export type RecordChangeDecisionsResult =
  | { ok: true; recorded: number }
  | { ok: false; error: string };

export async function recordChangeDecisionsAction(input: {
  proposalId: string;
  sectionId: string;
  bulk?: boolean;
  decisions: ChangeDecisionInput[];
}): Promise<RecordChangeDecisionsResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [section] = await db
    .select({
      id: proposalSections.id,
      kind: proposalSections.kind,
      authorUserId: proposalSections.authorUserId,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposalSections.id, input.sectionId),
        eq(proposalSections.proposalId, input.proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!section) return { ok: false, error: "Section not found." };

  const isOwner = section.authorUserId === null || section.authorUserId === actor.id;
  const isAdmin = actor.role === "admin" || actor.isSuperadmin;
  if (!isOwner && !isAdmin) {
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal_section.changes_resolve_denied",
      resourceType: "proposal_section",
      resourceId: input.sectionId,
      metadata: { reason: "not_section_owner", attempted: input.decisions.length },
    });
    return { ok: false, error: "Only the section owner can resolve tracked changes." };
  }

  const clean = sanitize(input.decisions).slice(0, MAX_DECISIONS);
  if (clean.length === 0) return { ok: false, error: "No valid decisions." };
  const bulk = Boolean(input.bulk);

  try {
    await db.insert(sectionChangeDecisions).values(
      clean.map((d) => ({
        organizationId,
        proposalId: input.proposalId,
        sectionId: section.id,
        sectionKind: section.kind,
        changeId: d.id,
        changeType: d.type,
        decision: d.decision,
        bulk,
        authorUserId: d.authorId,
        authorNameSnapshot: d.authorName,
        decidedByUserId: actor.id,
        changeText: d.text,
        wordCount: countWords(d.text),
      })),
    );
  } catch (err) {
    log.warn("[recordChangeDecisionsAction]", "insert failed", { error: err });
    return { ok: false, error: "Could not record the decisions." };
  }

  const accepted = clean.filter((d) => d.decision === "accept").length;
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal_section.changes_resolved",
    resourceType: "proposal_section",
    resourceId: input.sectionId,
    metadata: {
      accepted,
      rejected: clean.length - accepted,
      bulk,
      changeIds: clean.slice(0, 20).map((d) => d.id),
      authors: [...new Set(clean.map((d) => d.authorId).filter(Boolean))].slice(0, 10),
    },
  });

  // The proposal overview's AI Draft Insights panel reads these rows.
  revalidatePath(`/proposals/${input.proposalId}`);
  return { ok: true, recorded: clean.length };
}

function sanitize(decisions: ChangeDecisionInput[]): {
  id: string;
  type: "insert" | "delete";
  decision: "accept" | "reject";
  authorId: string;
  authorName: string;
  text: string;
}[] {
  if (!Array.isArray(decisions)) return [];
  const out: ReturnType<typeof sanitize> = [];
  for (const d of decisions) {
    if (!d || typeof d.id !== "string" || !d.id.trim()) continue;
    if (d.type !== "insert" && d.type !== "delete") continue;
    if (d.decision !== "accept" && d.decision !== "reject") continue;
    out.push({
      id: d.id.trim().slice(0, MAX_ID_CHARS),
      type: d.type,
      decision: d.decision,
      authorId: typeof d.authorId === "string" ? d.authorId.slice(0, MAX_AUTHOR_CHARS) : "",
      authorName: typeof d.authorName === "string" ? d.authorName.slice(0, MAX_AUTHOR_CHARS) : "",
      text: typeof d.text === "string" ? d.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS) : "",
    });
  }
  return out;
}
