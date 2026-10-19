/**
 * BL-FB-X-CRM Slice 3 — importing contacts against Postgres: mark which
 * people the tenant already has, then create the new ones in one insert
 * and skip or update the duplicates. Server-only; callers own auth.
 * BL-STAB-2f — the browser parses the file; rows arrive in chunks that
 * fit one request, each re-checked here and audited with its counts.
 */
import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, customerContacts } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { agencyKey } from "@/lib/crm-logic";
import {
  IMPORT_LIMITS,
  dedupeWithinImport,
  detectDuplicates,
  sanitizeImportRow,
  type DuplicateMatch,
  type ImportPerson,
  type ImportRow,
} from "@/lib/crm-import-logic";

type Actor = { userId: string | null; email?: string | null };

export type DuplicateCheck = { ok: true; matches: (DuplicateMatch | null)[] } | { ok: false; error: string };

async function existingContacts(organizationId: string) {
  return db
    .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, agency: customerContacts.agency, agencyKey: customerContacts.agencyKey })
    .from(customerContacts)
    .where(eq(customerContacts.organizationId, organizationId));
}

/**
 * Which of these people the tenant already has (by email, else by agency
 * and name), one answer per person in order; a person who can't be a
 * contact gets none. For the preview; nothing is written.
 */
export async function findImportDuplicates(input: { organizationId: string; people: readonly Partial<ImportPerson>[] }): Promise<DuplicateCheck> {
  const { organizationId } = input;
  const people = input.people.slice(0, IMPORT_LIMITS.maxRows).map((p) => sanitizeImportRow({ name: p?.name, agency: p?.agency, email: p?.email }));
  const valid = people.flatMap((p, i) => (p ? [{ p, i }] : []));
  if (valid.length === 0) return { ok: true, matches: people.map(() => null) };
  const found = detectDuplicates(valid.map((v) => v.p), await existingContacts(organizationId));
  const matches: (DuplicateMatch | null)[] = people.map(() => null);
  valid.forEach((v, k) => {
    matches[v.i] = found.get(k) ?? null;
  });
  return { ok: true, matches };
}

export type ImportBatch = { id: string; part: number; parts: number };

/**
 * BL-STAB-2f — a part sent again after its answer was lost: its audit row
 * says what it did, so that is the answer and nothing is written twice
 * (re-run, its people would be counted as duplicates the same import made).
 */
async function partAlreadyImported(organizationId: string, batch: ImportBatch): Promise<ImportCommit | null> {
  const [row] = await db
    .select({ metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        // An import runs in minutes; the day bounds the scan to the organization's recent rows.
        gt(auditLogs.createdAt, sql`now() - interval '1 day'`),
        eq(auditLogs.action, "crm.contact.import"),
        sql`${auditLogs.metadata}->>'importId' = ${batch.id}`,
        sql`${auditLogs.metadata}->>'part' = ${String(batch.part)}`,
      ),
    )
    .limit(1);
  if (!row) return null;
  const m = row.metadata as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { ok: true, created: n(m.created), updated: n(m.updated), skipped: n(m.skipped) };
}

export type ImportCommit = { ok: true; created: number; updated: number; skipped: number } | { ok: false; error: string };

/**
 * Write the previewed rows: new people in one insert, duplicates skipped
 * or updated with the file's non-empty fields. Rows are re-normalised and
 * duplicates re-detected here; the client's view is never trusted.
 */
export async function commitContactImport(input: {
  organizationId: string;
  rows: readonly Partial<ImportRow>[];
  duplicates: "skip" | "update";
  actor: Actor;
  /** BL-STAB-2f — this call's part of a larger import, for the audit trail. */
  batch?: ImportBatch;
}): Promise<ImportCommit> {
  const { organizationId } = input;
  if (input.batch) {
    const done = await partAlreadyImported(organizationId, input.batch);
    if (done) return done;
  }
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
    metadata: { rows: clean.length, created, updated, skipped, duplicates: input.duplicates, ...(input.batch ? { importId: input.batch.id, part: input.batch.part, parts: input.batch.parts } : {}) },
  });
  return { ok: true, created, updated, skipped };
}
