/**
 * BL-16 customTemplates — the flag gates template authoring, not use.
 * With it: create and edit work. Without it: create, edit, Word upload,
 * clear and mode switch are refused with the plan message, while setting
 * the default, archiving, unarchiving and the /proposals/new picker keep
 * working, so nothing a workspace already built is lost.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalTemplates, tenantSubscriptions } from "@/db/schema";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "admin@templates.test",
  name: "Template Admin",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));

import {
  archiveTemplateAction,
  clearTemplateDocxAction,
  createTemplateAction,
  listActiveTemplatesForPickerAction,
  setDefaultTemplateAction,
  setTemplateKindAction,
  unarchiveTemplateAction,
  updateTemplateAction,
  uploadTemplateDocxAction,
} from "@/app/(app)/settings/templates/actions";
import { TEMPLATE_AUTHORING_REFUSAL } from "@/lib/template-gate";

describe("BL-16 customTemplates — authoring is gated, use is not", () => {
  let fx: TwoTenantFixture;
  let tier: { cleanup: () => Promise<void> };
  const tag = Date.now().toString(36);
  const refused = { ok: false, error: TEMPLATE_AUTHORING_REFUSAL };

  const actAs = (org: TwoTenantFixture["orgA"]) => {
    sessionUserStub.id = org.userId;
    sessionUserStub.organizationId = org.organizationId;
  };
  const setFlag = (on: boolean) =>
    db
      .update(tenantSubscriptions)
      .set({ customOverrides: { featureFlags: { customTemplates: on } } })
      .where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));

  beforeEach(async () => {
    fx = await createTwoTenants("tpl");
    tier = await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `tpl-${tag}`, name: "Tpl", featureFlags: { customTemplates: true } });
  });

  afterEach(async () => {
    await tier.cleanup();
    await fx.cleanup();
  });

  it("allows authoring with the flag and refuses it without, keeping existing templates usable", async () => {
    actAs(fx.orgA);
    const made = await createTemplateAction({ name: "Civilian house style" });
    if (!made.ok) throw new Error(made.error);
    expect(await updateTemplateAction(made.id, { description: "Our look" })).toEqual({ ok: true });

    await setFlag(false);
    expect(await createTemplateAction({ name: "Another" })).toEqual(refused);
    expect(await updateTemplateAction(made.id, { name: "Renamed" })).toEqual(refused);
    expect(await setTemplateKindAction(made.id, "html")).toEqual(refused);
    expect(await clearTemplateDocxAction(made.id)).toEqual(refused);
    expect(await uploadTemplateDocxAction(made.id, new FormData())).toEqual(refused);

    const [row] = await db
      .select({ name: proposalTemplates.name, description: proposalTemplates.description, kind: proposalTemplates.kind })
      .from(proposalTemplates)
      .where(and(eq(proposalTemplates.id, made.id), eq(proposalTemplates.organizationId, fx.orgA.organizationId)));
    expect(row).toEqual({ name: "Civilian house style", description: "Our look", kind: "docx" });
    const count = await db.select({ id: proposalTemplates.id }).from(proposalTemplates).where(eq(proposalTemplates.organizationId, fx.orgA.organizationId));
    expect(count).toHaveLength(1);

    // Use is never gated.
    expect(await setDefaultTemplateAction(made.id)).toEqual({ ok: true });
    expect((await listActiveTemplatesForPickerAction()).map((t) => t.id)).toEqual([made.id]);
    expect(await archiveTemplateAction(made.id)).toEqual({ ok: true });
    expect(await unarchiveTemplateAction(made.id)).toEqual({ ok: true });

    // Turning the flag back on restores authoring.
    await setFlag(true);
    expect(await updateTemplateAction(made.id, { name: "Renamed" })).toEqual({ ok: true });
  });

  it("refuses a workspace with no plan at all", async () => {
    actAs(fx.orgB);
    expect(await createTemplateAction({ name: "B's template" })).toEqual(refused);
    expect(await db.select({ id: proposalTemplates.id }).from(proposalTemplates).where(eq(proposalTemplates.organizationId, fx.orgB.organizationId))).toEqual([]);
  });
});
