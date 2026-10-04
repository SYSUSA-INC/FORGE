/**
 * BL-FB-X-CRM Slice 3 — importing contacts against Postgres: preview a
 * CSV or vCard against what the tenant already has, then create the new
 * people in one insert and skip or update the duplicates. Server-only;
 * callers own auth; the import is audited once with its counts.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerContacts } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { agencyKey } from "@/lib/crm-logic";
import {
  IMPORT_LIMITS,
  dedupeWithinImport,
  detectDuplicates,
  parseImport,
  sanitizeImportRow,
  summarizeImport,
  type DuplicateMatch,
  type ImportFormat,
  type ImportRow,
  type ImportSkip,
  type ImportSummary,
} from "@/lib/crm-import-logic";

type Actor = { userId: string | null; email?: string | null };

export type ImportPreviewRow = ImportRow & { duplicate: DuplicateMatch | null };
export type ImportPreview =
  | { ok: true; format: ImportFormat; rows: ImportPreviewRow[]; skipped: ImportSkip[]; unmappedHeaders: string[]; summary: ImportSummary }
  | { ok: false; error: string };

async function existingContacts(organizationId: string) {
  return db
    .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, agency: customerContacts.agency, agencyKey: customerContacts.agencyKey })
    .from(customerContacts)
    .where(eq(customerContacts.organizationId, organizationId));
}

/** Parse the pasted or uploaded text and mark the rows the tenant already has. Nothing is written. */
export async function previewContactImport(input: { organizationId: string; text: string; fileName?: string }): Promise<ImportPreview> {
  const { organizationId } = input;
  const text = input.text ?? "";
  if (!text.trim()) return { ok: false, error: "Paste a CSV or choose a .csv / .vcf file first." };
  if (text.length > IMPORT_LIMITS.maxChars) return { ok: false, error: "That file is too large (2 MB of text at most)." };
  const parsed = parseImport(text, input.fileName ?? "");
  const { rows, dropped } = dedupeWithinImport(parsed.rows);
  const skipped = [...parsed.skipped, ...dropped];
  if (rows.length === 0) return { ok: false, error: skipped[0]?.reason ?? "No contacts found: each row needs a name and an agency." };
  const duplicates = detectDuplicates(rows, await existingContacts(organizationId));
  return {
    ok: true,
    format: parsed.format,
    rows: rows.map((r, i) => ({ ...r, duplicate: duplicates.get(i) ?? null })),
    skipped,
    unmappedHeaders: parsed.unmappedHeaders,
    summary: summarizeImport(rows, duplicates, skipped),
  };
}

export type ImportCommit = { ok: true; created: number; updated: number; skipped: number } | { ok: false; error: string };

/**
 * Write the previewed rows: new people in one insert, duplicates skipped
 * or updated with the file's non-empty fields. Rows are re-normalised and
 * duplicates re-detected here; the client's view is never trusted.
 */
export async function commitContactImport(input: { organizationId: string; rows: readonly Partial<ImportRow>[]; duplicates: "skip" | "update"; actor: Actor }): Promise<ImportCommit> {
  const { organizationId } = input;
  const clean = dedupeWithinImport(
    input.rows
      .slice(0, IMPORT_LIMITS.maxRows)
      .map((r) => sanitizeImportRow(r))
      .filter((r): r is ImportRow => r !== null),
  ).rows;
  if (clean.length === 0) return { ok: false, error: "Nothing to import: each row needs a name and an agency." };
  const duplicates = detectDuplicates(clean, await existingContacts(organizationId));

  const fresh = clean.filter((_, i) => !duplicates.has(i));
  let created = 0;
  if (fresh.length > 0) {
    const inserted = await db
      .insert(customerContacts)
      .values(
        fresh.map((r) => ({
          organizationId,
          agency: r.agency,
          agencyKey: agencyKey(r.agency),
          office: r.office,
          name: r.name,
          title: r.title,
          role: r.role,
          email: r.email,
          phone: r.phone,
          notes: r.notes,
          nextTouchAt: r.nextTouchAt ? new Date(`${r.nextTouchAt}T12:00:00`) : null,
          createdByUserId: input.actor.userId,
        })),
      )
      .returning({ id: customerContacts.id });
    created = inserted.length;
  }

  let updated = 0;
  let skipped = 0;
  for (const [index, match] of duplicates) {
    if (input.duplicates === "skip") {
      skipped += 1;
      continue;
    }
    const r = clean[index]!;
    // The file fills what it has; blanks never erase what the team already knew.
    const set: Partial<typeof customerContacts.$inferInsert> = { updatedAt: new Date() };
    if (r.office) set.office = r.office;
    if (r.title) set.title = r.title;
    if (r.role !== "other") set.role = r.role;
    if (r.email) set.email = r.email;
    if (r.phone) set.phone = r.phone;
    if (r.notes) set.notes = r.notes;
    if (r.nextTouchAt) set.nextTouchAt = new Date(`${r.nextTouchAt}T12:00:00`);
    await db
      .update(customerContacts)
      .set(set)
      .where(and(eq(customerContacts.id, match.existingId), eq(customerContacts.organizationId, organizationId)));
    updated += 1;
  }

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "crm.contact.import",
    resourceType: "customer_contact",
    metadata: { rows: clean.length, created, updated, skipped, duplicates: input.duplicates },
  });
  return { ok: true, created, updated, skipped };
}
