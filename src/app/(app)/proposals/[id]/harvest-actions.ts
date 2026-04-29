"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  opportunities,
  proposalSections,
  proposals,
  type TipTapDoc,
  type TipTapNode,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { startKnowledgeExtractionAction } from "../../knowledge-base/import/[id]/actions";
import { embedArtifactAction } from "../../knowledge-base/import/embed-actions";

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

/**
 * Phase 10f: harvest a submitted proposal back into the corpus.
 *
 *   proposal sections → knowledge_artifact (kind='proposal',
 *                       source='mined_from_proposal')
 *                       → embed for semantic search
 *                       → run Brain extraction for review queue
 *
 * Idempotent — re-running on a proposal updates the existing harvest
 * artifact rather than creating duplicates. Each harvested artifact
 * carries metadata.proposalId so we can find it again.
 *
 * Triggered automatically when a proposal is advanced to "submitted"
 * (see advanceProposalStageAction); also exposed as a manual
 * "Harvest now" button on the proposal page.
 */
export async function harvestProposalToCorpusAction(
  proposalId: string,
): Promise<HarvestResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [propRow] = await db
    .select({
      proposal: proposals,
      opportunity: opportunities,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!propRow) return { ok: false, error: "Proposal not found." };

  const sections = await db
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  if (sections.length === 0) {
    return {
      ok: false,
      error: "Proposal has no sections to harvest. Author content first.",
    };
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
      error:
        "Proposal sections are empty. Add content before harvesting to the corpus.",
    };
  }

  // Look for an existing harvest artifact for this proposal — reuse
  // it so re-runs don't pile up duplicates.
  const existing = await db
    .select({
      id: knowledgeArtifacts.id,
      metadata: knowledgeArtifacts.metadata,
    })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.source, "mined_from_proposal"),
      ),
    );
  const match = existing.find(
    (e) => (e.metadata as Record<string, unknown>)?.proposalId === proposalId,
  );

  let artifactId: string;
  let reused = false;

  if (match) {
    artifactId = match.id;
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
        metadata: {
          ...(typeof match.metadata === "object" && match.metadata
            ? match.metadata
            : {}),
          proposalId,
          opportunityId: propRow.proposal.opportunityId,
          harvestedAt: new Date().toISOString(),
        },
      })
      .where(eq(knowledgeArtifacts.id, artifactId));
  } else {
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
        uploadedByUserId: user.id,
        metadata: {
          proposalId,
          opportunityId: propRow.proposal.opportunityId,
          harvestedAt: new Date().toISOString(),
        },
      })
      .returning({ id: knowledgeArtifacts.id });
    if (!created) {
      return { ok: false, error: "Could not create harvest artifact." };
    }
    artifactId = created.id;
  }

  // Embed for semantic search. Best-effort — the user can re-run
  // from the artifact detail page if it fails (e.g. embedding
  // provider not configured).
  let embeddedChunks = 0;
  try {
    const r = await embedArtifactAction(artifactId);
    if (r.ok) embeddedChunks = r.chunks;
  } catch (err) {
    console.warn("[harvestProposalToCorpus] embed failed", err);
  }

  // Run Brain extraction so candidate knowledge entries land in the
  // review queue. Stub mode produces a placeholder which is still
  // useful as a UI sanity check.
  let candidateCount = 0;
  try {
    const r = await startKnowledgeExtractionAction(artifactId);
    if (r.ok) candidateCount = r.candidateCount;
  } catch (err) {
    console.warn("[harvestProposalToCorpus] extraction failed", err);
  }

  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  revalidatePath(`/knowledge-base/import/${artifactId}`);
  revalidatePath(`/proposals/${proposalId}`);

  return {
    ok: true,
    artifactId,
    reused,
    candidateCount,
    embeddedChunks,
  };
}

function harvestTitle(proposalTitle: string): string {
  const safe = proposalTitle.trim() || "Submitted proposal";
  return `Submitted: ${safe}`.slice(0, 256);
}

function composeTags(propRow: {
  proposal: { title: string };
  opportunity: {
    agency: string;
    naicsCode: string;
    setAside: string;
  };
}): string[] {
  const tags = new Set<string>();
  tags.add("harvested");
  if (propRow.opportunity.agency) {
    tags.add(slug(propRow.opportunity.agency));
  }
  if (propRow.opportunity.naicsCode) {
    tags.add(`naics-${propRow.opportunity.naicsCode}`);
  }
  if (propRow.opportunity.setAside) {
    tags.add(slug(propRow.opportunity.setAside));
  }
  return Array.from(tags).slice(0, 8);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function composeProposalText(input: {
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
      input.solicitationNumber
        ? `Solicitation: ${input.solicitationNumber}`
        : "",
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
