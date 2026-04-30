"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { knowledgeEntries, organizations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  searchAwardsByRecipientName,
  type UsaspendingAward,
} from "@/lib/usaspending";

export type SearchResult =
  | {
      ok: true;
      awards: (UsaspendingAward & { alreadyImported: boolean })[];
      totalRecords: number;
      defaultRecipient: string;
    }
  | { ok: false; error: string };

export async function searchUsaspendingAction(input?: {
  recipientName?: string;
  includeIdv?: boolean;
}): Promise<SearchResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Default the search to the org's legal name if the user didn't
  // type one — saves a click for the common case.
  const [org] = await db
    .select({
      name: organizations.name,
      uei: organizations.uei,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const query = (input?.recipientName ?? org?.name ?? "").trim();
  if (!query) {
    return {
      ok: false,
      error:
        "Set the org name in Settings (or pass a recipient name) before searching USAspending.",
    };
  }

  const result = await searchAwardsByRecipientName(query, {
    limit: 50,
    includeIdv: input?.includeIdv ?? false,
  });
  if (!result.ok) return result;

  // Mark already-imported entries so the UI can disable their
  // checkboxes. Match on the "usa-award-<awardId>" tag we stamp on
  // import.
  const already = await db
    .select({ tags: knowledgeEntries.tags })
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.organizationId, organizationId));
  const importedAwardTags = new Set<string>();
  for (const row of already) {
    for (const t of row.tags ?? []) {
      if (t.startsWith("usa-award-")) importedAwardTags.add(t);
    }
  }

  return {
    ok: true,
    totalRecords: result.totalRecords,
    defaultRecipient: query,
    awards: result.awards.map((a) => ({
      ...a,
      alreadyImported: importedAwardTags.has(awardTag(a.awardId)),
    })),
  };
}

export type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string };

export async function importUsaspendingAwardsAction(
  awards: UsaspendingAward[],
): Promise<ImportResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (!Array.isArray(awards) || awards.length === 0) {
    return { ok: false, error: "Pick at least one award to import." };
  }

  // Dedupe by awardId in case the client sent duplicates.
  const byId = new Map<string, UsaspendingAward>();
  for (const a of awards) byId.set(a.awardId, a);

  // Skip awards that are already imported (matched via the tag).
  // Postgres array overlap is awkward through Drizzle; we filter in
  // memory after pulling current entries' tags.
  const existing = await db
    .select({ tags: knowledgeEntries.tags })
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.organizationId, organizationId));
  const existingTags = new Set<string>();
  for (const row of existing) {
    for (const t of row.tags ?? []) existingTags.add(t);
  }

  let imported = 0;
  let skipped = 0;
  for (const award of byId.values()) {
    const tag = awardTag(award.awardId);
    if (existingTags.has(tag)) {
      skipped += 1;
      continue;
    }
    try {
      await db.insert(knowledgeEntries).values({
        organizationId,
        kind: "past_performance",
        title: titleFor(award),
        body: bodyFor(award),
        tags: tagsFor(award),
        metadata: {
          awardId: award.awardId,
          amount: String(award.amount ?? ""),
          awardType: award.awardType,
          awardingAgency: award.awardingAgency,
          awardingSubAgency: award.awardingSubAgency,
          startDate: award.startDate ?? "",
          endDate: award.endDate ?? "",
          naicsCode: award.naicsCode,
          pscCode: award.pscCode,
          source: "usaspending.gov",
          uiUrl: award.uiUrl,
        },
        createdByUserId: user.id,
      });
      imported += 1;
    } catch (err) {
      console.error("[importUsaspendingAwards] insert", err);
      skipped += 1;
    }
  }

  revalidatePath("/knowledge-base");
  return { ok: true, imported, skipped };
}

function awardTag(awardId: string): string {
  return `usa-award-${awardId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(
    0,
    64,
  );
}

function titleFor(a: UsaspendingAward): string {
  // "Acme Corp · NAVSEA · N00024-25-D-0094"
  const parts = [
    a.recipientName,
    a.awardingSubAgency || a.awardingAgency,
    a.awardId,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.join(" · ").slice(0, 200) || a.awardId;
}

function bodyFor(a: UsaspendingAward): string {
  const lines: string[] = [];
  lines.push(`Customer: ${a.awardingSubAgency || a.awardingAgency || "—"}`);
  lines.push(`Award ID (PIID): ${a.awardId}`);
  if (a.amount) lines.push(`Total obligated: ${formatUsd(a.amount)}`);
  if (a.startDate || a.endDate) {
    lines.push(
      `Period of performance: ${a.startDate ?? "—"} → ${a.endDate ?? "—"}`,
    );
  }
  if (a.awardType) lines.push(`Award type: ${a.awardType}`);
  if (a.naicsCode) lines.push(`NAICS: ${a.naicsCode}`);
  if (a.pscCode) lines.push(`PSC: ${a.pscCode}`);
  lines.push("");
  lines.push(`Description: ${a.description || "—"}`);
  lines.push("");
  lines.push(`Source: ${a.uiUrl}`);
  return lines.join("\n").slice(0, 5000);
}

function tagsFor(a: UsaspendingAward): string[] {
  const out = new Set<string>();
  out.add(awardTag(a.awardId));
  out.add("usaspending");
  if (a.naicsCode) out.add(`naics-${a.naicsCode}`);
  if (a.awardingAgency) out.add(slug(a.awardingAgency));
  if (a.awardingSubAgency) out.add(slug(a.awardingSubAgency));
  return Array.from(out).slice(0, 12);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
