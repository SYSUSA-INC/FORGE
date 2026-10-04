/**
 * BL-PACKAGES add-ons Slice 1 — à la carte add-ons, server side.
 *
 *   catalogue   — listAddonCatalog / createAddon / updateAddon
 *                 (platform-wide; the admin action owns auth)
 *   grants      — listTenantAddons / grantTenantAddon / revokeTenantAddon
 *                 (manual, by a platform admin; audited in the tenant's log)
 *   gate input  — activeAddonEffects, read by getCurrentTier on every
 *                 gated call
 *   Stripe      — provisionStripeAddon / syncStripeAddonSubscription,
 *                 called by the webhook so a bought add-on appears and
 *                 disappears with its Stripe subscription;
 *                 syncPlanAddonItems / endPlanAddonGrants for add-ons
 *                 billed as items on the plan's own subscription
 *                 (Slice 2a), and getTenantGrant / setGrantQuantity /
 *                 endGrantNow for the tenant's own changes
 *
 * Server-only; callers own auth. Every tenant_addon write carries
 * organizationId.
 */
import "server-only";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { tenantAddons, tierAddons } from "@/db/schema";
import { addonIsLive, reconcilePlanItems, sanitizeAddonQuantity, type AddonCatalogRow, type AddonEffect, type AddonInput, type TenantAddonRow } from "@/lib/addons-logic";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

export type { AddonCatalogRow, TenantAddonRow } from "@/lib/addons-logic";

type Actor = { userId: string | null; email?: string | null };

const catalogColumns = {
  id: tierAddons.id,
  slug: tierAddons.slug,
  name: tierAddons.name,
  description: tierAddons.description,
  kind: tierAddons.kind,
  aiTokensPerMonth: tierAddons.aiTokensPerMonth,
  featureFlag: tierAddons.featureFlag,
  amountPerUnit: tierAddons.amountPerUnit,
  priceMonthlyCents: tierAddons.priceMonthlyCents,
  stripePriceId: tierAddons.stripePriceId,
  sortOrder: tierAddons.sortOrder,
  active: tierAddons.active,
};

/** The catalogue, in display order. Platform data (no tenant scope). */
export async function listAddonCatalog(input?: { activeOnly?: boolean }): Promise<AddonCatalogRow[]> {
  const q = db.select(catalogColumns).from(tierAddons);
  const rows = input?.activeOnly ? await q.where(eq(tierAddons.active, true)).orderBy(asc(tierAddons.sortOrder), asc(tierAddons.name)) : await q.orderBy(asc(tierAddons.sortOrder), asc(tierAddons.name));
  return rows;
}

export async function getAddonBySlug(slug: string): Promise<AddonCatalogRow | null> {
  const [row] = await db.select(catalogColumns).from(tierAddons).where(eq(tierAddons.slug, slug)).limit(1);
  return row ?? null;
}

/** New catalogue entry. Platform-wide; audited into the actor's own org when they have one. */
export async function createAddon(input: { value: AddonInput; actor: Actor & { organizationId?: string | null } }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const v = input.value;
  const [taken] = await db.select({ id: tierAddons.id }).from(tierAddons).where(eq(tierAddons.slug, v.slug)).limit(1);
  if (taken) return { ok: false, error: `An add-on with the slug "${v.slug}" already exists.` };
  const [row] = await db
    .insert(tierAddons)
    .values({
      slug: v.slug,
      name: v.name,
      description: v.description,
      kind: v.kind,
      aiTokensPerMonth: v.aiTokensPerMonth,
      amountPerUnit: v.amountPerUnit,
      featureFlag: v.featureFlag,
      priceMonthlyCents: v.priceMonthlyCents,
      stripePriceId: v.stripePriceId,
      sortOrder: v.sortOrder,
      active: v.active,
    })
    .returning({ id: tierAddons.id });
  if (!row) return { ok: false, error: "Insert failed." };
  await auditCatalog(input.actor, "tier_addon.create", row.id, v);
  return { ok: true, id: row.id };
}

/** Edit a catalogue entry (the slug stays). The caller decides whether retiring is allowed. */
export async function updateAddon(input: { id: string; value: Omit<AddonInput, "slug">; actor: Actor & { organizationId?: string | null } }): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = input.value;
  const [existing] = await db.select({ id: tierAddons.id, slug: tierAddons.slug }).from(tierAddons).where(eq(tierAddons.id, input.id)).limit(1);
  if (!existing) return { ok: false, error: "Add-on not found." };
  await db
    .update(tierAddons)
    .set({
      name: v.name,
      description: v.description,
      kind: v.kind,
      aiTokensPerMonth: v.aiTokensPerMonth,
      amountPerUnit: v.amountPerUnit,
      featureFlag: v.featureFlag,
      priceMonthlyCents: v.priceMonthlyCents,
      stripePriceId: v.stripePriceId,
      sortOrder: v.sortOrder,
      active: v.active,
      updatedAt: new Date(),
    })
    .where(eq(tierAddons.id, input.id));
  await auditCatalog(input.actor, "tier_addon.update", input.id, { slug: existing.slug, ...v });
  return { ok: true };
}

async function auditCatalog(actor: Actor & { organizationId?: string | null }, action: string, id: string, metadata: Record<string, unknown>) {
  // Catalogue edits are platform-scoped. Like tier edits, they land in the
  // acting admin's own org log when they have one, else in the deploy log.
  if (actor.organizationId) {
    await recordAudit({ organizationId: actor.organizationId, actor, action, resourceType: "tier_addon", resourceId: id, metadata });
  } else {
    log.info("[addons]", action, { actorUserId: actor.userId, addonId: id, ...metadata });
  }
}

// ── Grants ────────────────────────────────────────────────────────────

const grantColumns = {
  id: tenantAddons.id,
  addonId: tenantAddons.addonId,
  slug: tierAddons.slug,
  name: tierAddons.name,
  kind: tierAddons.kind,
  aiTokensPerMonth: tierAddons.aiTokensPerMonth,
  featureFlag: tierAddons.featureFlag,
  amountPerUnit: tierAddons.amountPerUnit,
  priceMonthlyCents: tierAddons.priceMonthlyCents,
  addonActive: tierAddons.active,
  quantity: tenantAddons.quantity,
  status: tenantAddons.status,
  source: tenantAddons.source,
  stripeSubscriptionId: tenantAddons.stripeSubscriptionId,
  stripeSubscriptionItemId: tenantAddons.stripeSubscriptionItemId,
  note: tenantAddons.note,
  startsAt: tenantAddons.startsAt,
  endsAt: tenantAddons.endsAt,
  canceledAt: tenantAddons.canceledAt,
};

/** A tenant's grants, newest first, with whether each counts right now. */
export async function listTenantAddons(input: { organizationId: string; now?: Date }): Promise<TenantAddonRow[]> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const rows = await db
    .select(grantColumns)
    .from(tenantAddons)
    .innerJoin(tierAddons, eq(tierAddons.id, tenantAddons.addonId))
    .where(eq(tenantAddons.organizationId, organizationId))
    .orderBy(desc(tenantAddons.startsAt), desc(tenantAddons.id));
  return rows.map((r) => ({
    id: r.id,
    addonId: r.addonId,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    aiTokensPerMonth: r.aiTokensPerMonth,
    featureFlag: r.featureFlag,
    amountPerUnit: r.amountPerUnit,
    priceMonthlyCents: r.priceMonthlyCents,
    quantity: r.quantity,
    status: r.status,
    source: r.source,
    stripeSubscriptionId: r.stripeSubscriptionId,
    stripeSubscriptionItemId: r.stripeSubscriptionItemId,
    note: r.note,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    canceledAt: r.canceledAt?.toISOString() ?? null,
    live: addonIsLive({ status: r.status, startsAt: r.startsAt, endsAt: r.endsAt, addonActive: r.addonActive }, now),
  }));
}

/** What the tenant's live grants contribute — the subscription gate's input. */
export async function activeAddonEffects(input: { organizationId: string; now?: Date }): Promise<AddonEffect[]> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      kind: tierAddons.kind,
      aiTokensPerMonth: tierAddons.aiTokensPerMonth,
      featureFlag: tierAddons.featureFlag,
      amountPerUnit: tierAddons.amountPerUnit,
      addonActive: tierAddons.active,
      quantity: tenantAddons.quantity,
      status: tenantAddons.status,
      startsAt: tenantAddons.startsAt,
      endsAt: tenantAddons.endsAt,
    })
    .from(tenantAddons)
    .innerJoin(tierAddons, eq(tierAddons.id, tenantAddons.addonId))
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.status, "active")));
  return rows
    .filter((r) => addonIsLive({ status: r.status, startsAt: r.startsAt, endsAt: r.endsAt, addonActive: r.addonActive }, now))
    .map((r) => ({ kind: r.kind, aiTokensPerMonth: r.aiTokensPerMonth, featureFlag: r.featureFlag, amountPerUnit: r.amountPerUnit, quantity: r.quantity }));
}

/** A platform admin grants an add-on to a tenant. Audited as tenant.addon.grant in the tenant's log. */
export async function grantTenantAddon(input: {
  organizationId: string;
  addonId: string;
  quantity: number;
  note?: string;
  endsAt?: Date | null;
  actor: Actor;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { organizationId } = input;
  const quantity = sanitizeAddonQuantity(input.quantity);
  if (quantity === null) return { ok: false, error: "Quantity: a whole number from 1 to 100." };
  const [addon] = await db.select({ id: tierAddons.id, slug: tierAddons.slug, name: tierAddons.name, kind: tierAddons.kind, active: tierAddons.active }).from(tierAddons).where(eq(tierAddons.id, input.addonId)).limit(1);
  if (!addon) return { ok: false, error: "Add-on not found." };
  if (!addon.active) return { ok: false, error: `"${addon.name}" is retired; re-activate it in the catalogue first.` };
  if (input.endsAt && input.endsAt.getTime() <= Date.now()) return { ok: false, error: "The end date must be in the future." };
  const [row] = await db
    .insert(tenantAddons)
    .values({
      organizationId,
      addonId: addon.id,
      quantity,
      status: "active",
      source: "manual",
      grantedByUserId: input.actor.userId,
      note: (input.note ?? "").trim().slice(0, 300),
      endsAt: input.endsAt ?? null,
    })
    .returning({ id: tenantAddons.id });
  if (!row) return { ok: false, error: "Insert failed." };
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.addon.grant",
    resourceType: "tenant_addon",
    resourceId: row.id,
    metadata: { addonId: addon.id, slug: addon.slug, name: addon.name, kind: addon.kind, quantity, endsAt: input.endsAt?.toISOString() ?? null, note: (input.note ?? "").trim().slice(0, 300) },
  });
  return { ok: true, id: row.id };
}

/** End a grant now. A Stripe-sourced grant stops counting here but keeps billing until cancelled in Stripe. */
export async function revokeTenantAddon(input: { organizationId: string; tenantAddonId: string; actor: Actor }): Promise<{ ok: true; source: "manual" | "stripe" } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .select({ id: tenantAddons.id, status: tenantAddons.status, source: tenantAddons.source, addonId: tenantAddons.addonId, quantity: tenantAddons.quantity, slug: tierAddons.slug })
    .from(tenantAddons)
    .innerJoin(tierAddons, eq(tierAddons.id, tenantAddons.addonId))
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, input.tenantAddonId)))
    .limit(1);
  if (!row) return { ok: false, error: "Grant not found." };
  if (row.status !== "active") return { ok: false, error: "This grant has already ended." };
  const now = new Date();
  await db
    .update(tenantAddons)
    .set({ status: "canceled", canceledAt: now, updatedAt: now })
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, row.id)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.addon.revoke",
    resourceType: "tenant_addon",
    resourceId: row.id,
    metadata: { addonId: row.addonId, slug: row.slug, quantity: row.quantity, source: row.source },
  });
  return { ok: true, source: row.source };
}

// ── Stripe ────────────────────────────────────────────────────────────

/**
 * A checkout for an add-on completed: record the grant, keyed by the
 * Stripe subscription so a replayed webhook updates instead of
 * duplicating. Audited as tenant.addon.purchased.
 */
export async function provisionStripeAddon(input: {
  organizationId: string;
  addonSlug: string;
  quantity: number;
  stripeSubscriptionId: string;
  stripeSubscriptionItemId?: string | null;
  note?: string;
}): Promise<{ ok: true; id: string; created: boolean } | { ok: false; error: string }> {
  const { organizationId } = input;
  const addon = await getAddonBySlug(input.addonSlug);
  if (!addon) return { ok: false, error: `Unknown add-on "${input.addonSlug}".` };
  const quantity = sanitizeAddonQuantity(input.quantity) ?? 1;
  const now = new Date();
  const [existing] = await db
    .select({ id: tenantAddons.id, organizationId: tenantAddons.organizationId })
    .from(tenantAddons)
    .where(
      and(
        eq(tenantAddons.organizationId, organizationId),
        // An add-on billed on the plan's subscription shares that
        // subscription with the plan and other add-ons: its item is the key.
        input.stripeSubscriptionItemId
          ? eq(tenantAddons.stripeSubscriptionItemId, input.stripeSubscriptionItemId)
          : eq(tenantAddons.stripeSubscriptionId, input.stripeSubscriptionId),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(tenantAddons)
      .set({ quantity, status: "active", canceledAt: null, stripeSubscriptionItemId: input.stripeSubscriptionItemId ?? null, updatedAt: now })
      .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, existing.id)));
    return { ok: true, id: existing.id, created: false };
  }
  const [row] = await db
    .insert(tenantAddons)
    .values({
      organizationId,
      addonId: addon.id,
      quantity,
      status: "active",
      source: "stripe",
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSubscriptionItemId: input.stripeSubscriptionItemId ?? null,
      note: input.note ?? "Bought through Stripe Checkout.",
    })
    .returning({ id: tenantAddons.id });
  if (!row) return { ok: false, error: "Insert failed." };
  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "tenant.addon.purchased",
    resourceType: "tenant_addon",
    resourceId: row.id,
    metadata: { addonId: addon.id, slug: addon.slug, quantity, stripeSubscriptionId: input.stripeSubscriptionId },
  });
  return { ok: true, id: row.id, created: true };
}

/**
 * Keep a Stripe-sourced grant in step with its subscription. Returns
 * `matched: false` when the subscription is not an add-on's — the
 * webhook then treats it as the tenant's main plan.
 */
export async function syncStripeAddonSubscription(input: {
  stripeSubscriptionId: string;
  stripeStatus: string;
  quantity?: number | null;
  currentPeriodEnd?: Date | null;
}): Promise<{ matched: boolean; organizationId: string | null; status: "active" | "canceled" | null }> {
  const [row] = await db
    .select({ id: tenantAddons.id, organizationId: tenantAddons.organizationId, status: tenantAddons.status, slug: tierAddons.slug })
    .from(tenantAddons)
    .innerJoin(tierAddons, eq(tierAddons.id, tenantAddons.addonId))
    .where(eq(tenantAddons.stripeSubscriptionId, input.stripeSubscriptionId))
    .limit(1);
  if (!row) return { matched: false, organizationId: null, status: null };
  const { organizationId } = row;
  const ended = input.stripeStatus === "canceled" || input.stripeStatus === "unpaid" || input.stripeStatus === "incomplete_expired";
  const status: "active" | "canceled" = ended ? "canceled" : "active";
  const now = new Date();
  const quantity = input.quantity != null ? sanitizeAddonQuantity(input.quantity) : null;
  await db
    .update(tenantAddons)
    .set({
      status,
      canceledAt: ended ? now : null,
      // A cancelled subscription keeps serving until the paid period ends.
      endsAt: ended ? (input.currentPeriodEnd && input.currentPeriodEnd.getTime() > now.getTime() ? input.currentPeriodEnd : now) : null,
      ...(quantity !== null ? { quantity } : {}),
      updatedAt: now,
    })
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, row.id)));
  if (status !== row.status) {
    await recordAudit({
      organizationId,
      actor: { userId: null, email: "stripe-webhook" },
      action: ended ? "tenant.addon.cancelled" : "tenant.addon.reactivated",
      resourceType: "tenant_addon",
      resourceId: row.id,
      metadata: { slug: row.slug, stripeSubscriptionId: input.stripeSubscriptionId, stripeStatus: input.stripeStatus },
    });
  }
  return { matched: true, organizationId, status };
}

// ── Slice 2a — add-ons billed on the plan's own subscription ──────────

/**
 * Bring the grants for add-ons billed as items on a tenant's plan
 * subscription in line with that subscription's items: new items are
 * recorded, quantity follows Stripe, items removed in Stripe (or by the
 * tenant) end their grant now. Called by the webhook for the plan.
 */
export async function syncPlanAddonItems(input: {
  organizationId: string;
  stripeSubscriptionId: string;
  items: { id: string; slug: string; quantity: number }[];
}): Promise<{ added: number; ended: number; changed: number }> {
  const { organizationId, stripeSubscriptionId } = input;
  const grants = await db
    .select({ id: tenantAddons.id, itemId: tenantAddons.stripeSubscriptionItemId, quantity: tenantAddons.quantity })
    .from(tenantAddons)
    .where(
      and(
        eq(tenantAddons.organizationId, organizationId),
        eq(tenantAddons.stripeSubscriptionId, stripeSubscriptionId),
        isNotNull(tenantAddons.stripeSubscriptionItemId),
        eq(tenantAddons.status, "active"),
      ),
    );
  const plan = reconcilePlanItems(
    grants.map((g) => ({ id: g.id, itemId: g.itemId!, quantity: g.quantity })),
    input.items.map((i) => ({ id: i.id, quantity: sanitizeAddonQuantity(i.quantity) ?? 1 })),
  );
  for (const itemId of plan.added) {
    const item = input.items.find((i) => i.id === itemId)!;
    const res = await provisionStripeAddon({
      organizationId,
      addonSlug: item.slug,
      quantity: item.quantity,
      stripeSubscriptionId,
      stripeSubscriptionItemId: item.id,
      note: "Billed on the plan's subscription.",
    });
    if (!res.ok) log.warn("[addons]", "plan add-on item not recorded", { organizationId, itemId, error: res.error });
  }
  for (const q of plan.quantity) await setGrantQuantity({ organizationId, tenantAddonId: q.grantId, quantity: q.quantity });
  const now = new Date();
  for (const id of plan.end) await endGrantNow({ organizationId, tenantAddonId: id, actor: { userId: null, email: "stripe-webhook" }, now });
  return { added: plan.added.length, ended: plan.end.length, changed: plan.quantity.length };
}

/** The plan's subscription ended: every add-on billed on it ends with it. */
export async function endPlanAddonGrants(input: { organizationId: string; stripeSubscriptionId: string; endsAt: Date }): Promise<number> {
  const { organizationId } = input;
  const ended = await db
    .update(tenantAddons)
    .set({ status: "canceled", canceledAt: new Date(), endsAt: input.endsAt, updatedAt: new Date() })
    .where(
      and(
        eq(tenantAddons.organizationId, organizationId),
        eq(tenantAddons.stripeSubscriptionId, input.stripeSubscriptionId),
        isNotNull(tenantAddons.stripeSubscriptionItemId),
        eq(tenantAddons.status, "active"),
      ),
    )
    .returning({ id: tenantAddons.id });
  for (const g of ended) {
    await recordAudit({
      organizationId,
      actor: { userId: null, email: "stripe-webhook" },
      action: "tenant.addon.cancelled",
      resourceType: "tenant_addon",
      resourceId: g.id,
      metadata: { stripeSubscriptionId: input.stripeSubscriptionId, reason: "plan subscription ended" },
    });
  }
  return ended.length;
}

export type TenantGrant = {
  id: string;
  slug: string;
  kind: AddonCatalogRow["kind"];
  quantity: number;
  status: "active" | "canceled";
  source: "manual" | "stripe";
  stripeSubscriptionId: string | null;
  stripeSubscriptionItemId: string | null;
};

/** One of the tenant's grants, by id, or null when it isn't this tenant's. */
export async function getTenantGrant(input: { organizationId: string; tenantAddonId: string }): Promise<TenantGrant | null> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      id: tenantAddons.id,
      slug: tierAddons.slug,
      kind: tierAddons.kind,
      quantity: tenantAddons.quantity,
      status: tenantAddons.status,
      source: tenantAddons.source,
      stripeSubscriptionId: tenantAddons.stripeSubscriptionId,
      stripeSubscriptionItemId: tenantAddons.stripeSubscriptionItemId,
    })
    .from(tenantAddons)
    .innerJoin(tierAddons, eq(tierAddons.id, tenantAddons.addonId))
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, input.tenantAddonId)))
    .limit(1);
  return row ?? null;
}

/** Record a grant's new quantity (after Stripe accepted it). Audited when a person made the change. */
export async function setGrantQuantity(input: {
  organizationId: string;
  tenantAddonId: string;
  quantity: number;
  actor?: Actor;
  stripeSubscriptionItemId?: string;
}): Promise<void> {
  const { organizationId } = input;
  const quantity = sanitizeAddonQuantity(input.quantity) ?? 1;
  await db
    .update(tenantAddons)
    .set({
      quantity,
      ...(input.stripeSubscriptionItemId ? { stripeSubscriptionItemId: input.stripeSubscriptionItemId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, input.tenantAddonId)));
  if (input.actor) {
    await recordAudit({
      organizationId,
      actor: input.actor,
      action: "tenant.addon.quantity_change",
      resourceType: "tenant_addon",
      resourceId: input.tenantAddonId,
      metadata: { quantity },
    });
  }
}

/** End a grant now (its plan item was removed). Audited as tenant.addon.removed. */
export async function endGrantNow(input: { organizationId: string; tenantAddonId: string; actor: Actor; now?: Date }): Promise<boolean> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const [row] = await db
    .update(tenantAddons)
    .set({ status: "canceled", canceledAt: now, endsAt: now, updatedAt: now })
    .where(and(eq(tenantAddons.organizationId, organizationId), eq(tenantAddons.id, input.tenantAddonId), eq(tenantAddons.status, "active")))
    .returning({ id: tenantAddons.id });
  if (!row) return false;
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.addon.removed",
    resourceType: "tenant_addon",
    resourceId: row.id,
  });
  return true;
}
