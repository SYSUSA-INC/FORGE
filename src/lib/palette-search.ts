/**
 * BL-AIP-7d — the palette's record search, server side. One ILIKE query
 * per record kind on the fields a person types (title, agency,
 * solicitation number, company name / UEI, entry title), every one
 * scoped by organizationId, most recently touched first. Cheap by
 * design: the palette calls this per keystroke (debounced). Callers
 * own auth.
 */
import "server-only";

import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { companies, knowledgeEntries, opportunities, proposals, solicitations } from "@/db/schema";
import { normalizeQuery, type PaletteRecord } from "@/lib/palette";

/** ILIKE pattern for the query with the wildcard characters neutralised. */
export function likePattern(raw: string): string | null {
  const q = normalizeQuery(raw).replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  return q.length >= 2 ? `%${q}%` : null;
}

const subtitle = (...parts: (string | null | undefined)[]) =>
  parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
const stageLabel = (stage: string) => stage.replace(/_/g, " ");

export async function searchWorkspace(input: {
  organizationId: string;
  query: string;
  /** Per kind. */
  limit?: number;
}): Promise<PaletteRecord[]> {
  const { organizationId } = input;
  const pattern = likePattern(input.query);
  if (!pattern) return [];
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));

  const [opps, props, sols, cos, entries] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        agency: opportunities.agency,
        stage: opportunities.stage,
        number: opportunities.solicitationNumber,
      })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          or(
            ilike(opportunities.title, pattern),
            ilike(opportunities.agency, pattern),
            ilike(opportunities.solicitationNumber, pattern),
          ),
        ),
      )
      .orderBy(desc(opportunities.updatedAt))
      .limit(limit),
    db
      .select({ id: proposals.id, title: proposals.title, stage: proposals.stage })
      .from(proposals)
      .where(and(eq(proposals.organizationId, organizationId), ilike(proposals.title, pattern)))
      .orderBy(desc(proposals.updatedAt))
      .limit(limit),
    db
      .select({
        id: solicitations.id,
        title: solicitations.title,
        agency: solicitations.agency,
        number: solicitations.solicitationNumber,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.organizationId, organizationId),
          or(
            ilike(solicitations.title, pattern),
            ilike(solicitations.agency, pattern),
            ilike(solicitations.solicitationNumber, pattern),
          ),
        ),
      )
      .orderBy(desc(solicitations.updatedAt))
      .limit(limit),
    db
      .select({ id: companies.id, name: companies.name, uei: companies.uei, city: companies.city, state: companies.state })
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, organizationId),
          or(ilike(companies.name, pattern), ilike(companies.uei, pattern)),
        ),
      )
      .orderBy(desc(companies.updatedAt))
      .limit(limit),
    db
      .select({ id: knowledgeEntries.id, title: knowledgeEntries.title, kind: knowledgeEntries.kind })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.organizationId, organizationId),
          isNull(knowledgeEntries.archivedAt),
          ilike(knowledgeEntries.title, pattern),
        ),
      )
      .orderBy(desc(knowledgeEntries.updatedAt))
      .limit(limit),
  ]);

  return [
    ...opps.map<PaletteRecord>((r) => ({
      kind: "opportunity",
      id: r.id,
      title: r.title || "(untitled opportunity)",
      subtitle: subtitle(r.agency, r.number, stageLabel(r.stage)),
      href: `/opportunities/${r.id}`,
    })),
    ...props.map<PaletteRecord>((r) => ({
      kind: "proposal",
      id: r.id,
      title: r.title || "(untitled proposal)",
      subtitle: subtitle(stageLabel(r.stage)),
      href: `/proposals/${r.id}`,
    })),
    ...sols.map<PaletteRecord>((r) => ({
      kind: "solicitation",
      id: r.id,
      title: r.title || r.number || "(untitled solicitation)",
      subtitle: subtitle(r.agency, r.number),
      href: `/solicitations/${r.id}`,
    })),
    ...cos.map<PaletteRecord>((r) => ({
      kind: "company",
      id: r.id,
      title: r.name,
      subtitle: subtitle(r.uei ? `UEI ${r.uei}` : "", [r.city, r.state].filter(Boolean).join(", ")),
      href: `/companies/${r.id}`,
    })),
    ...entries.map<PaletteRecord>((r) => ({
      kind: "knowledge",
      id: r.id,
      title: r.title,
      subtitle: subtitle(stageLabel(r.kind)),
      href: `/knowledge-base/${r.id}`,
    })),
  ];
}
