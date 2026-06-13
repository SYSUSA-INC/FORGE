"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { promotionCodes } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

/**
 * BL-16 Phase C-4 — promo code CRUD.
 *
 * Superadmin-only. Codes are global (not tenant-scoped); they apply
 * at redemption time. Redemption itself lands with BL-17 billing
 * integration. Phase C-4 ships the management surface only.
 */

const PromoCodeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Code must be at least 3 characters.")
    .max(64, "Code must be 64 characters or less.")
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, underscore, or hyphen."),
  description: z.string().trim().max(500).default(""),
  discountPercent: z
    .number()
    .int("Discount must be a whole-number percentage.")
    .min(0)
    .max(100),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  maxUses: z.number().int().min(0),
  active: z.boolean(),
});

export type PromoCodeInput = z.infer<typeof PromoCodeInputSchema>;

function parseDateOrNull(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createPromoCodeAction(
  raw: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const parsed = PromoCodeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".")}: ${first.message}`
        : "Invalid input.",
    };
  }
  const input = parsed.data;

  try {
    const [row] = await db
      .insert(promotionCodes)
      .values({
        code: input.code,
        description: input.description,
        discountPercent: input.discountPercent,
        validFrom: parseDateOrNull(input.validFrom),
        validUntil: parseDateOrNull(input.validUntil),
        maxUses: input.maxUses,
        active: input.active,
      })
      .returning({ id: promotionCodes.id });

    if (!row) return { ok: false, error: "Could not create promo code." };

    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email },
        action: "promo_code.create",
        resourceType: "promotion_code",
        resourceId: row.id,
        metadata: {
          code: input.code,
          discountPercent: input.discountPercent,
          maxUses: input.maxUses,
        },
      });
    } else {
      log.info("[createPromoCodeAction]", "create by pure superadmin", {
        actorUserId: actor.id,
        code: input.code,
      });
    }

    revalidatePath("/admin/promo-codes");
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createPromoCodeAction]", "insert failed", { error: err });
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("unique")
    ) {
      return {
        ok: false,
        error: `Code "${input.code}" already exists. Pick a different code.`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updatePromoCodeAction(
  codeId: string,
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();

  const parsed = PromoCodeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".")}: ${first.message}`
        : "Invalid input.",
    };
  }
  const input = parsed.data;

  try {
    await db
      .update(promotionCodes)
      .set({
        code: input.code,
        description: input.description,
        discountPercent: input.discountPercent,
        validFrom: parseDateOrNull(input.validFrom),
        validUntil: parseDateOrNull(input.validUntil),
        maxUses: input.maxUses,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(promotionCodes.id, codeId));

    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email },
        action: "promo_code.update",
        resourceType: "promotion_code",
        resourceId: codeId,
        metadata: {
          code: input.code,
          discountPercent: input.discountPercent,
          active: input.active,
        },
      });
    } else {
      log.info("[updatePromoCodeAction]", "update by pure superadmin", {
        actorUserId: actor.id,
        codeId,
        code: input.code,
      });
    }

    revalidatePath("/admin/promo-codes");
    revalidatePath(`/admin/promo-codes/${codeId}`);
    return { ok: true };
  } catch (err) {
    log.error("[updatePromoCodeAction]", "update failed", {
      error: err,
      codeId,
    });
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("unique")
    ) {
      return {
        ok: false,
        error: `Code "${input.code}" already exists. Pick a different code.`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}
