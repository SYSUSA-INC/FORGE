/**
 * BL-FB-GEN-VOICE — author voice against Postgres. Two tenants.
 * Asserts: a profile is built from the author's own sections in the
 * owning tenant plus their pasted samples, never from another tenant's
 * sections; the drafter's guidance comes only for sections the profiled
 * author owns, in that tenant, while the profile is enabled; samples
 * and settings are the author's own; all audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalSections } from "@/db/schema";
import { addVoiceSample, getVoiceProfile, rebuildVoiceProfile, removeVoiceSample, updateVoiceSettings, voiceGuidanceForSection } from "@/lib/voice";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const SECTION_TEXT = Array.from({ length: 6 }, () => "We fix the backlog first. Our team runs the help desk every day. We measure every ticket and cut the wait to ten minutes. We own the outcome, and we say so. First, we baseline. Then we cut the queue.").join(" ");
const PASTED = Array.from({ length: 8 }, () => "We write the way we work: short, direct and accountable. Our customers see the numbers before we do, and we tell them what changed.").join(" ");

describe("BL-FB-GEN-VOICE — author voice", () => {
  let fx: TwoTenantFixture;
  let ownSection = "";
  let unownedSection = "";
  const actorA = { userId: "", email: "a@test" };

  beforeEach(async () => {
    fx = await createTwoTenants("voice");
    actorA.userId = fx.orgA.userId;
    const rows = await db
      .insert(proposalSections)
      .values([
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", content: SECTION_TEXT, wordCount: 200, authorUserId: fx.orgA.userId },
        { proposalId: fx.orgA.proposalId, kind: "management", title: "Management approach", content: SECTION_TEXT, wordCount: 200, authorUserId: fx.orgA.userId },
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Unowned", content: SECTION_TEXT, wordCount: 200 },
        // Tenant B's section carries A's user id by accident of data: never read for A's profile.
        { proposalId: fx.orgB.proposalId, kind: "technical", title: "B section", content: SECTION_TEXT.replace(/We /g, "They "), wordCount: 200, authorUserId: fx.orgA.userId },
      ])
      .returning({ id: proposalSections.id, title: proposalSections.title });
    ownSection = rows.find((r) => r.title === "Technical approach")!.id;
    unownedSection = rows.find((r) => r.title === "Unowned")!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("builds the profile from the author's own sections and samples in the owning tenant only", async () => {
    // Tenant B's author has written nothing there.
    const none = await rebuildVoiceProfile({ organizationId: fx.orgB.organizationId, userId: fx.orgB.userId, actor: { userId: fx.orgB.userId } });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/Not enough of your writing yet: 0 of 300 words/);

    expect((await addVoiceSample({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, title: "Short", text: "Too short to say anything.", actor: actorA })).ok).toBe(false);
    const sample = await addVoiceSample({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, title: "Email thread", text: PASTED, actor: actorA });
    expect(sample.ok).toBe(true);

    const built = await rebuildVoiceProfile({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, actor: actorA });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built).toMatchObject({ sections: 2, pasted: 1, sampleCount: 3 });
    expect(built.traits).toContain('Writes as "we" — team-first');

    const mine = await getVoiceProfile({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId });
    expect(mine.profile?.enabled).toBe(true);
    expect(mine.profile?.guidance).toContain("Write in Test ");
    expect(mine.profile?.metrics?.words).toBeGreaterThanOrEqual(300);
    expect(mine.samples).toHaveLength(1);
    // The same user asked about from tenant B has nothing there.
    expect((await getVoiceProfile({ organizationId: fx.orgB.organizationId, userId: fx.orgA.userId })).profile).toBeNull();

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "voice.sample.add")).toHaveLength(1);
    expect(audits.filter((a) => a.action === "voice.profile.rebuild")).toHaveLength(1);
  });

  it("hands the drafter the author's guidance for their own sections only, while enabled", async () => {
    expect(await voiceGuidanceForSection({ organizationId: fx.orgA.organizationId, sectionId: ownSection })).toBeNull();
    expect((await rebuildVoiceProfile({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, actor: actorA })).ok).toBe(true);

    const voice = await voiceGuidanceForSection({ organizationId: fx.orgA.organizationId, sectionId: ownSection });
    expect(voice?.author).toContain("Test ");
    expect(voice?.guidance).toContain("Write in Test ");
    expect(await voiceGuidanceForSection({ organizationId: fx.orgA.organizationId, sectionId: unownedSection })).toBeNull();
    expect(await voiceGuidanceForSection({ organizationId: fx.orgB.organizationId, sectionId: ownSection })).toBeNull();

    expect(await updateVoiceSettings({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, enabled: false, customGuidance: "Never say leverage.", actor: actorA })).toEqual({ ok: true });
    expect(await voiceGuidanceForSection({ organizationId: fx.orgA.organizationId, sectionId: ownSection })).toBeNull();
    expect(await updateVoiceSettings({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, enabled: true, customGuidance: "Never say leverage.", actor: actorA })).toEqual({ ok: true });
    const withNotes = await voiceGuidanceForSection({ organizationId: fx.orgA.organizationId, sectionId: ownSection });
    expect(withNotes?.guidance).toContain("own notes: Never say leverage.");

    // Settings before any profile exists create the row for the other tenant's author without a voice.
    expect(await updateVoiceSettings({ organizationId: fx.orgB.organizationId, userId: fx.orgB.userId, enabled: true, customGuidance: "", actor: { userId: fx.orgB.userId } })).toEqual({ ok: true });
    expect((await getVoiceProfile({ organizationId: fx.orgB.organizationId, userId: fx.orgB.userId })).profile?.guidance).toBe("");

    const sample = await addVoiceSample({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, title: "x", text: PASTED, actor: actorA });
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    expect((await removeVoiceSample({ organizationId: fx.orgB.organizationId, userId: fx.orgA.userId, sampleId: sample.id, actor: actorA })).ok).toBe(false);
    expect((await removeVoiceSample({ organizationId: fx.orgA.organizationId, userId: fx.orgB.userId, sampleId: sample.id, actor: actorA })).ok).toBe(false);
    expect(await removeVoiceSample({ organizationId: fx.orgA.organizationId, userId: fx.orgA.userId, sampleId: sample.id, actor: actorA })).toEqual({ ok: true });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "voice.settings.update")).toHaveLength(2);
    expect(audits.filter((a) => a.action === "voice.sample.remove")).toHaveLength(1);
  });
});
