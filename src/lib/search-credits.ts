/**
 * BL-NAV-LIFECYCLE 5b-2a — prepaid web-search packs: the balance and its ledger.
 *
 * A tenant holds one balance of pack searches (`tenant_search_credit`). A
 * research run draws the plan's monthly allowance first and this balance
 * only for the rest (`reserveWebSearches` in subscription-gates.ts). Every
 * change writes one `search_credit_entry` in the same transaction, so the
 * balance always equals the sum of its entries. The balance cannot go
 * below zero: a draw locks the row and takes what is there, and the column
 * carries a CHECK. Pack searches do not expire.
 *
 * Design: docs/design/BL-NAV-LIFECYCLE_PHASE5B2_SEARCH_PACKS.md.
 */
import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { searchCreditEntries, tenantSearchCredits, type SearchCreditEntry } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";

/** The most a platform admin can add or remove in one correction. */
export const SEARCH_CREDIT_ADJUST_MAX = 100_000;

/** The pack searches a tenant holds. No row means none. */
export async function getSearchCreditBalance(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ balance: tenantSearchCredits.balance })
    .from(tenantSearchCredits)
    .where(eq(tenantSearchCredits.organizationId, organizationId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Take up to `want` searches from the tenant's pack balance: all of them,
 * or what is left. Returns how many were taken (0 = none). The row is
 * locked for the read and the write, so racing draws cannot take the same
 * search twice or pass zero.
 */
export async function drawSearchCredits(input: { organizationId: string; want: number; proposalId?: string | null }): Promise<number> {
  const want = Math.floor(input.want);
  if (!(want > 0)) return 0;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ balance: tenantSearchCredits.balance })
      .from(tenantSearchCredits)
      .where(eq(tenantSearchCredits.organizationId, input.organizationId))
      .for("update");
    if (!row || row.balance <= 0) return 0;
    const n = Math.min(row.balance, want);
    await tx
      .update(tenantSearchCredits)
      .set({ balance: row.balance - n, updatedAt: new Date() })
      .where(eq(tenantSearchCredits.organizationId, input.organizationId));
    await tx.insert(searchCreditEntries).values({
      organizationId: input.organizationId,
      delta: -n,
      kind: "draw",
      balanceAfter: row.balance - n,
      proposalId: input.proposalId ?? null,
    });
    return n;
  });
}

/** Add to a balance (creating the row) and write the entry, in one transaction. Returns the new balance. */
async function addSearchCredits(input: {
  organizationId: string;
  count: number;
  kind: "release" | "adjust";
  proposalId?: string | null;
  actorUserId?: string | null;
  note?: string;
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tenantSearchCredits)
      .values({ organizationId: input.organizationId, balance: input.count })
      .onConflictDoUpdate({
        target: tenantSearchCredits.organizationId,
        set: { balance: sql`${tenantSearchCredits.balance} + ${input.count}`, updatedAt: new Date() },
      })
      .returning({ balance: tenantSearchCredits.balance });
    await tx.insert(searchCreditEntries).values({
      organizationId: input.organizationId,
      delta: input.count,
      kind: input.kind,
      balanceAfter: row!.balance,
      proposalId: input.proposalId ?? null,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? "",
    });
    return row!.balance;
  });
}

/** Give back pack searches a run drew and did not use. */
export async function returnSearchCredits(input: { organizationId: string; count: number; proposalId?: string | null }): Promise<void> {
  const count = Math.floor(input.count);
  if (!(count > 0)) return;
  await addSearchCredits({ organizationId: input.organizationId, count, kind: "release", proposalId: input.proposalId });
}

/**
 * A platform admin's correction: add searches, or remove some (never below
 * zero: a removal larger than the balance is refused, not clipped). A note
 * is required. Audited in the tenant's own log.
 */
export async function adjustSearchCredits(input: {
  organizationId: string;
  delta: number;
  note: string;
  actor: { userId: string | null; email?: string | null };
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const { organizationId } = input;
  const delta = Math.trunc(Number(input.delta));
  const note = (input.note ?? "").trim().slice(0, 500);
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "Enter a number of searches to add or remove." };
  if (Math.abs(delta) > SEARCH_CREDIT_ADJUST_MAX) return { ok: false, error: `One correction is at most ${SEARCH_CREDIT_ADJUST_MAX.toLocaleString("en-US")} searches.` };
  if (!note) return { ok: false, error: "Say why in the note." };

  let balance: number;
  if (delta > 0) {
    balance = await addSearchCredits({ organizationId, count: delta, kind: "adjust", actorUserId: input.actor.userId, note });
  } else {
    const after = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ balance: tenantSearchCredits.balance })
        .from(tenantSearchCredits)
        .where(eq(tenantSearchCredits.organizationId, organizationId))
        .for("update");
      if (!row || row.balance + delta < 0) return null;
      await tx
        .update(tenantSearchCredits)
        .set({ balance: row.balance + delta, updatedAt: new Date() })
        .where(eq(tenantSearchCredits.organizationId, organizationId));
      await tx.insert(searchCreditEntries).values({
        organizationId,
        delta,
        kind: "adjust",
        balanceAfter: row.balance + delta,
        actorUserId: input.actor.userId,
        note,
      });
      return row.balance + delta;
    });
    if (after === null) return { ok: false, error: "The organization holds fewer pack searches than that." };
    balance = after;
  }

  await recordAudit({
    organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email ?? null },
    action: "admin.search_credit.adjust",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { delta, balance, note },
  });
  return { ok: true, balance };
}

/** The tenant's newest ledger entries. */
export async function listSearchCreditEntries(input: { organizationId: string; limit?: number }): Promise<SearchCreditEntry[]> {
  return db
    .select()
    .from(searchCreditEntries)
    .where(eq(searchCreditEntries.organizationId, input.organizationId))
    .orderBy(desc(searchCreditEntries.createdAt))
    .limit(Math.min(Math.max(1, input.limit ?? 20), 200));
}
