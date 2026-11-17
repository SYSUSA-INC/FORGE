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

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { searchCreditEntries, searchPacks, tenantSearchCredits, type SearchCreditEntry, type SearchPack } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { searchesToRefund } from "@/lib/search-pack-logic";

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

// ─────────────────────────────────────────────────────────────────────
// 5b-2b — buying a pack through Stripe Checkout, and refunds.
// ─────────────────────────────────────────────────────────────────────

/** The packs on sale (platform-wide catalogue), smallest first. */
export async function listActiveSearchPacks(): Promise<SearchPack[]> {
  return db.select().from(searchPacks).where(eq(searchPacks.active, true)).orderBy(asc(searchPacks.searches));
}

/** One pack by slug, on sale or not (a paid session is honoured after a pack is retired). */
export async function getSearchPack(slug: string): Promise<SearchPack | null> {
  const [row] = await db.select().from(searchPacks).where(eq(searchPacks.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Credit a paid Checkout session's pack to the tenant, exactly once. The
 * number of searches comes from the catalogue, never from the session.
 * The ledger's unique Checkout session id makes a second delivery, or two
 * racing ones, credit nothing: the loser's transaction rolls back.
 */
export async function creditSearchPackPurchase(input: {
  organizationId: string;
  packSlug: string;
  checkoutSessionId: string;
  paymentIntentId: string | null;
  stripeEventId: string | null;
}): Promise<{ credited: true; searches: number; balance: number } | { credited: false; reason: "already_credited" | "unknown_pack" }> {
  const { organizationId } = input;
  const pack = await getSearchPack(input.packSlug);
  if (!pack) return { credited: false, reason: "unknown_pack" };

  const [seen] = await db
    .select({ id: searchCreditEntries.id })
    .from(searchCreditEntries)
    .where(eq(searchCreditEntries.stripeCheckoutSessionId, input.checkoutSessionId))
    .limit(1);
  if (seen) return { credited: false, reason: "already_credited" };

  let balance: number;
  try {
    balance = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tenantSearchCredits)
        .values({ organizationId, balance: pack.searches })
        .onConflictDoUpdate({
          target: tenantSearchCredits.organizationId,
          set: { balance: sql`${tenantSearchCredits.balance} + ${pack.searches}`, updatedAt: new Date() },
        })
        .returning({ balance: tenantSearchCredits.balance });
      await tx.insert(searchCreditEntries).values({
        organizationId,
        delta: pack.searches,
        kind: "purchase",
        balanceAfter: row!.balance,
        packSlug: pack.slug,
        stripeCheckoutSessionId: input.checkoutSessionId,
        stripePaymentIntentId: input.paymentIntentId,
        stripeEventId: input.stripeEventId,
        note: pack.name,
      });
      return row!.balance;
    });
  } catch (err) {
    // 23505 = unique_violation: a racing delivery of the same session credited first.
    if ((err as { code?: string } | null)?.code === "23505") return { credited: false, reason: "already_credited" };
    throw err;
  }

  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "billing.search_pack.credited",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { packSlug: pack.slug, searches: pack.searches, balance, checkoutSessionId: input.checkoutSessionId },
  });
  return { credited: true, searches: pack.searches, balance };
}

/**
 * A Stripe refund of a pack payment: take the refunded share of the pack
 * back from the tenant that bought it, down to zero at the lowest
 * (searches already used are not clawed back). The tenant comes from our
 * own purchase entry, found by the payment intent; a refund of anything
 * else (a plan invoice) matches no entry and does nothing.
 */
export async function refundSearchPackPurchase(input: {
  paymentIntentId: string;
  chargeAmount: number;
  amountRefunded: number;
  previousAmountRefunded: number;
  stripeEventId: string | null;
}): Promise<{ refunded: false } | { refunded: true; organizationId: string; removed: number; balance: number }> {
  const [purchase] = await db
    .select({
      organizationId: searchCreditEntries.organizationId,
      searches: searchCreditEntries.delta,
      packSlug: searchCreditEntries.packSlug,
    })
    .from(searchCreditEntries)
    .where(and(eq(searchCreditEntries.stripePaymentIntentId, input.paymentIntentId), eq(searchCreditEntries.kind, "purchase")))
    .limit(1);
  if (!purchase) return { refunded: false };
  const { organizationId } = purchase;

  const owed = searchesToRefund({
    packSearches: purchase.searches,
    chargeAmount: input.chargeAmount,
    amountRefunded: input.amountRefunded,
    previousAmountRefunded: input.previousAmountRefunded,
  });
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ balance: tenantSearchCredits.balance })
      .from(tenantSearchCredits)
      .where(eq(tenantSearchCredits.organizationId, organizationId))
      .for("update");
    const held = row?.balance ?? 0;
    const removed = Math.min(held, owed);
    if (row && removed > 0) {
      await tx
        .update(tenantSearchCredits)
        .set({ balance: held - removed, updatedAt: new Date() })
        .where(eq(tenantSearchCredits.organizationId, organizationId));
    }
    // Written even when nothing could be removed, so the refund is on the record.
    await tx.insert(searchCreditEntries).values({
      organizationId,
      delta: -removed,
      kind: "refund",
      balanceAfter: held - removed,
      packSlug: purchase.packSlug,
      stripePaymentIntentId: input.paymentIntentId,
      stripeEventId: input.stripeEventId,
      note: removed < owed ? `Refund of ${owed} searches; ${owed - removed} were already used.` : "",
    });
    return { removed, balance: held - removed };
  });

  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "billing.search_pack.refunded",
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { packSlug: purchase.packSlug, owed, removed: result.removed, balance: result.balance, paymentIntentId: input.paymentIntentId },
  });
  return { refunded: true, organizationId, ...result };
}
