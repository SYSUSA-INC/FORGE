/**
 * BL-AIP-4b — harvest a proposal into the corpus, as a library.
 *
 * Phase 10f wrote the harvest as a server action, so only a click (or
 * a fire-and-forget from another action) could run it, and a won
 * proposal whose harvest died with the instance stayed out of the
 * Brain for good. The core now lives here: the action delegates, and
 * the brain-index cron calls it for submitted / won proposals that
 * have no harvest artifact.
 *
 *   proposal sections → knowledge_artifact (kind='proposal',
 *                       source='mined_from_proposal')
 *                       → embed for semantic search
 *                       → Brain extraction for the review queue
 *
 * Idempotent — a re-run updates the existing artifact (unique partial
 * index from migration 0029 backs this). Every write carries the
 * proposal's organization_id. Server-only; callers own auth.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  opportunities,
  proposalOutcomes,
  proposalSections,
  proposals,
  type KnowledgeOutcomeLabel,
  type TipTapDoc,
  type TipTapNode,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { embedArtifact } from "@/lib/knowledge-artifact-embed";
import { runKnowledgeExtraction } from "@/lib/knowledge-extraction";
import { log } from "@/lib/log";

const RAW_TEXT_CAP = 500_000;

export type HarvestResult =
  | {
      ok: true;
      artifactId: string;
      reused: boolean;
      candidateCount: number;
      embeddedChunks: number;
    }
  | { ok: false; error: string };

export async function harvestProposal(input: {
  organizationId: string;
  proposalId: string;
  /** Null for the cron; the audit row then carries no actor user. */
  actor: { userId: string | null; email?: string | null; name?: string | null };
  /** Cron: refuse the stub-mode extraction placeholder. */
  skipStubExtraction?: boolean;
}): Promise<HarvestResult> {
  const { organizationId, proposalId } = input;

  const [propRow] = await db
    .select({ proposal: proposals, opportunity: opportunities })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!propRow) return { ok: false, error: "Proposal not found." };

  // BL-AIP-4 — a proposal that already has an outcome lands labelled.
  const [outcomeRow] = await db
    .select({ outcomeType: proposalOutcomes.outcomeType })
    .from(proposalOutcomes)
    .where(and(eq(proposalOutcomes.proposalId, proposalId), eq(proposalOutcomes.organizationId, organizationId)))
    .limit(1);
  const outcomeLabel: KnowledgeOutcomeLabel | null = outcomeRow
    ? (outcomeRow.outcomeType as KnowledgeOutcomeLabel)
    : null;

  const sections = await db
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));
  if (sections.length === 0) {
    return { ok: false, error: "Proposal has no sections to harvest. Author content first." };
  }

  const composed = composeProposalText({
    proposalTitle: propRow.proposal.title,
    agency: propRow.opportunity.agency,
    solicitationNumber: propRow.opportunity.solicitationNumber,
    naicsCode: propRow.opportunity.naicsCode,
    setAside: propRow.opportunity.setAside,
    sections,
  });
  if (composed.trim().length === 0) {
    return {
      ok: false,
      error: "Proposal sections are empty. Add content before harvesting to the corpus.",
    };
  }

  async function findExisting() {
    const rows = await db
      .select({ id: knowledgeArtifacts.id, metadata: knowledgeArtifacts.metadata })
      .from(knowledgeArtifacts)
      .where(
        and(
          eq(knowledgeArtifacts.organizationId, organizationId),
          eq(knowledgeArtifacts.source, "mined_from_proposal"),
        ),
      );
    return rows.find((e) => (e.metadata as Record<string, unknown>)?.proposalId === proposalId);
  }

  const existing = await findExisting();
  let artifactId: string;
  let reused = false;

  if (existing) {
    artifactId = existing.id;
    reused = true;
    await db
      .update(knowledgeArtifacts)
      .set({
        title: harvestTitle(propRow.proposal.title),
        rawText: composed.slice(0, RAW_TEXT_CAP),
        status: "indexed",
        statusError: "",
        indexedAt: new Date(),
        updatedAt: new Date(),
        ...(outcomeLabel ? { outcomeLabel } : {}),
        metadata: {
          ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata : {}),
          proposalId,
          opportunityId: propRow.proposal.opportunityId,
          harvestedAt: new Date().toISOString(),
        },
      })
      .where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.organizationId, organizationId)));
  } else {
    try {
      const [created] = await db
        .insert(knowledgeArtifacts)
        .values({
          organizationId,
          kind: "proposal",
          source: "mined_from_proposal",
          title: harvestTitle(propRow.proposal.title),
          tags: composeTags(propRow),
          fileName: "",
          fileSize: composed.length,
          contentType: "text/plain",
          storagePath: "",
          rawText: composed.slice(0, RAW_TEXT_CAP),
          status: "indexed",
          indexedAt: new Date(),
          outcomeLabel: outcomeLabel ?? "none",
          uploadedByUserId: input.actor.userId,
          metadata: {
            proposalId,
            opportunityId: propRow.proposal.opportunityId,
            harvestedAt: new Date().toISOString(),
          },
        })
        .returning({ id: knowledgeArtifacts.id });
      if (!created) return { ok: false, error: "Could not create harvest artifact." };
      artifactId = created.id;
    } catch (err) {
      // Another run beat us to the insert (unique partial index): reuse.
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
      const after = await findExisting();
      if (!after) {
        return {
          ok: false,
          error: "Concurrent harvest collision detected but no existing artifact found. Try again.",
        };
      }
      artifactId = after.id;
      reused = true;
    }
  }

  // Embed for semantic search (best-effort).
  let embeddedChunks = 0;
  try {
    const r = await embedArtifact({ organizationId, artifactId });
    if (r.ok) embeddedChunks = r.chunks;
    else log.warn("[harvestProposal]", "embed declined", { error: r.error });
  } catch (err) {
    log.warn("[harvestProposal]", "embed failed", { error: err });
  }

  // Brain extraction for the review queue (best-effort).
  let candidateCount = 0;
  try {
    const r = await runKnowledgeExtraction({
      organizationId,
      artifactId,
      startedByUserId: input.actor.userId,
      skipStub: !!input.skipStubExtraction,
    });
    if (r.ok) candidateCount = r.candidateCount;
    else log.warn("[harvestProposal]", "extraction declined", { error: r.error });
  } catch (err) {
    log.warn("[harvestProposal]", "extraction failed", { error: err });
  }

  await recordAudit({
    organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email },
    action: "proposal.harvest",
    resourceType: "knowledge_artifact",
    resourceId: artifactId,
    metadata: {
      proposalId,
      reused,
      candidateCount,
      embeddedChunks,
      ...(input.actor.userId ? {} : { viaCron: true }),
    },
  });

  return { ok: true, artifactId, reused, candidateCount, embeddedChunks };
}

function harvestTitle(proposalTitle: string): string {
  const safe = proposalTitle.trim() || "Submitted proposal";
  return `Submitted: ${safe}`.slice(0, 256);
}

function composeTags(propRow: {
  proposal: { title: string };
  opportunity: { agency: string; naicsCode: string; setAside: string };
}): string[] {
  const tags = new Set<string>();
  tags.add("harvested");
  if (propRow.opportunity.agency) tags.add(slug(propRow.opportunity.agency));
  if (propRow.opportunity.naicsCode) tags.add(`naics-${propRow.opportunity.naicsCode}`);
  if (propRow.opportunity.setAside) tags.add(slug(propRow.opportunity.setAside));
  return Array.from(tags).slice(0, 8);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function composeProposalText(input: {
  proposalTitle: string;
  agency: string;
  solicitationNumber: string;
  naicsCode: string;
  setAside: string;
  sections: { title: string; bodyDoc: TipTapDoc | null; ordering: number }[];
}): string {
  const header = [
    `# ${input.proposalTitle}`,
    [
      input.agency ? `Agency: ${input.agency}` : "",
      input.solicitationNumber ? `Solicitation: ${input.solicitationNumber}` : "",
      input.naicsCode ? `NAICS: ${input.naicsCode}` : "",
      input.setAside ? `Set-aside: ${input.setAside}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  ]
    .filter(Boolean)
    .join("\n");

  const body = input.sections
    .slice()
    .sort((a, b) => a.ordering - b.ordering)
    .map((s) => {
      const text = tiptapPlainText(s.bodyDoc);
      if (!text.trim()) return "";
      return `\n\n## ${s.title}\n\n${text}`;
    })
    .filter(Boolean)
    .join("");

  return `${header}${body}`.trim();
}

function tiptapPlainText(doc: TipTapDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const lines: string[] = [];
  for (const node of doc.content) walk(node, lines);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function walk(node: TipTapNode, lines: string[]): void {
  switch (node.type) {
    case "paragraph":
    case "heading":
      lines.push(textOf(node));
      lines.push("");
      break;
    case "bulletList":
    case "orderedList":
      if (Array.isArray(node.content)) {
        let i = 1;
        for (const item of node.content) {
          const prefix = node.type === "orderedList" ? `${i}. ` : "• ";
          const t = textOf(item).split("\n").join(" ").trim();
          if (t) lines.push(prefix + t);
          i += 1;
        }
        lines.push("");
      }
      break;
    case "blockquote":
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          const t = textOf(child).trim();
          if (t) lines.push("> " + t);
        }
        lines.push("");
      }
      break;
    case "codeBlock":
      lines.push(textOf(node));
      lines.push("");
      break;
    default:
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child, lines);
      }
  }
}

function textOf(node: TipTapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((c) => textOf(c)).join("");
}
