/**
 * BL-PACKAGES add-ons Slice 1 — à la carte add-ons, server side.
 *
 *   catalogue   — listAddonCatalog / createAddon / updateAddon
 *                 (platform-wide; the admin action owns auth)
 *   grants      — listTenantAddons / grantTenantAddon / revokeTenantAddon
 *                 (manual, by a platform admin; audited in the tenant's log)
 *   gate input  — activeAddonEffects, read by getCurrentTier on every
 *                 gated call

 * Self-serve purchase through Stripe (the tenant picker on
 * /settings/billing and the webhook hooks) lands in Slice 1b.
 *
 * Server-only; callers own auth. Every tenant_addon write carries
 * organizationId.
 */
import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantAddons, tierAddons } from "@/db/schema";
import { addonIsLive, sanitizeAddonQuantity, type AddonCatalogRow, type AddonEffect, type AddonInput, type TenantAddonRow } from "@/lib/addons-logic";
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
  priceMonthlyCents: tierAddons.priceMonthlyCents,
  addonActive: tierAddons.active,
  quantity: tenantAddons.quantity,
  status: tenantAddons.status,
  source: tenantAddons.source,
  stripeSubscriptionId: tenantAddons.stripeSubscriptionId,
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
    priceMonthlyCents: r.priceMonthlyCents,
    quantity: r.quantity,
    status: r.status,
    source: r.source,
    stripeSubscriptionId: r.stripeSubscriptionId,
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
    .map((r) => ({ kind: r.kind, aiTokensPerMonth: r.aiTokensPerMonth, featureFlag: r.featureFlag, quantity: r.quantity }));
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
