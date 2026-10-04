/**
 * BL-FB-GEN-VOICE — an author's writing voice against Postgres: the
 * profile is rebuilt from the sections they own in this organization
 * plus the texts they pasted, stored once per (organization, user), and
 * handed to the drafter and chat for sections this author owns.
 * Server-only; callers own auth; mutations audited.
 */
import "server-only";

import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { authorVoiceProfiles, authorVoiceSamples, proposalSections, proposals, users, type TipTapDoc } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { projectToPlain } from "@/lib/tiptap-doc";
import { VOICE_LIMITS, analyzeVoice, describeVoice, sampleWordCount, voiceGuidance } from "@/lib/voice-logic";

type Actor = { userId: string | null; email?: string | null };

async function authorName(userId: string): Promise<string> {
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name?.trim() || u?.email?.split("@")[0] || "the author";
}

export async function getVoiceProfile(input: { organizationId: string; userId: string }) {
  const { organizationId } = input;
  const [profile] = await db
    .select()
    .from(authorVoiceProfiles)
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, input.userId)))
    .limit(1);
  const samples = await db
    .select({ id: authorVoiceSamples.id, source: authorVoiceSamples.source, title: authorVoiceSamples.title, words: authorVoiceSamples.words, createdAt: authorVoiceSamples.createdAt })
    .from(authorVoiceSamples)
    .where(and(eq(authorVoiceSamples.organizationId, organizationId), eq(authorVoiceSamples.userId, input.userId)))
    .orderBy(desc(authorVoiceSamples.createdAt));
  return { profile: profile ?? null, samples };
}

export type RebuildResult =
  | { ok: true; traits: string[]; sampleCount: number; sampleWords: number; sections: number; pasted: number }
  | { ok: false; error: string };

/** Read the author's sections in this organization and their pasted samples; measure; store. */
export async function rebuildVoiceProfile(input: { organizationId: string; userId: string; actor: Actor }): Promise<RebuildResult> {
  const { organizationId } = input;
  const pasted = await db
    .select({ text: authorVoiceSamples.text })
    .from(authorVoiceSamples)
    .where(and(eq(authorVoiceSamples.organizationId, organizationId), eq(authorVoiceSamples.userId, input.userId)))
    .orderBy(desc(authorVoiceSamples.createdAt))
    .limit(VOICE_LIMITS.maxSamples);
  const sectionRows = await db
    .select({ content: proposalSections.content, bodyDoc: proposalSections.bodyDoc })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        eq(proposalSections.authorUserId, input.userId),
        gte(proposalSections.wordCount, VOICE_LIMITS.minSampleWords),
      ),
    )
    .orderBy(desc(proposalSections.updatedAt))
    .limit(Math.max(0, VOICE_LIMITS.maxSamples - pasted.length));
  const sectionTexts = sectionRows
    .map((r) => (projectToPlain(r.bodyDoc as TipTapDoc | null) || r.content || "").slice(0, VOICE_LIMITS.maxSampleChars))
    .filter((t) => sampleWordCount(t) >= VOICE_LIMITS.minSampleWords);
  const texts = [...pasted.map((p) => p.text), ...sectionTexts];
  const metrics = analyzeVoice(texts);
  if (!metrics) {
    const have = texts.reduce((n, t) => n + sampleWordCount(t), 0);
    return { ok: false, error: `Not enough of your writing yet: ${have} of ${VOICE_LIMITS.minProfileWords} words. Author a few sections or paste something you wrote.` };
  }

  const [existing] = await db
    .select({ id: authorVoiceProfiles.id, customGuidance: authorVoiceProfiles.customGuidance, enabled: authorVoiceProfiles.enabled })
    .from(authorVoiceProfiles)
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, input.userId)))
    .limit(1);
  const traits = describeVoice(metrics);
  const guidance = voiceGuidance({ authorName: await authorName(input.userId), metrics, traits, custom: existing?.customGuidance ?? "" });
  const values = { metrics, traits, guidance, sampleCount: texts.length, sampleWords: metrics.words, builtAt: new Date(), updatedAt: new Date() };
  if (existing) {
    await db
      .update(authorVoiceProfiles)
      .set(values)
      .where(and(eq(authorVoiceProfiles.id, existing.id), eq(authorVoiceProfiles.organizationId, organizationId)));
  } else {
    await db.insert(authorVoiceProfiles).values({ ...values, organizationId, userId: input.userId });
  }
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "voice.profile.rebuild",
    resourceType: "author_voice_profile",
    resourceId: input.userId,
    metadata: { sampleCount: texts.length, sampleWords: metrics.words, sections: sectionTexts.length, pasted: pasted.length, traits: traits.length },
  });
  return { ok: true, traits, sampleCount: texts.length, sampleWords: metrics.words, sections: sectionTexts.length, pasted: pasted.length };
}

/** Store a text the author pasted as a sample of their writing; audited. */
export async function addVoiceSample(input: { organizationId: string; userId: string; title: string; text: string; actor: Actor }): Promise<{ ok: true; id: string; words: number } | { ok: false; error: string }> {
  const { organizationId } = input;
  const text = input.text.trim().slice(0, VOICE_LIMITS.maxSampleChars);
  const words = sampleWordCount(text);
  if (words < VOICE_LIMITS.minSampleWords) return { ok: false, error: `A sample needs at least ${VOICE_LIMITS.minSampleWords} words (this one has ${words}).` };
  const [row] = await db
    .insert(authorVoiceSamples)
    .values({ organizationId, userId: input.userId, source: "pasted", title: input.title.trim().slice(0, VOICE_LIMITS.maxTitleChars), text, words })
    .returning({ id: authorVoiceSamples.id });
  if (!row) return { ok: false, error: "Could not save the sample." };
  await recordAudit({ organizationId, actor: input.actor, action: "voice.sample.add", resourceType: "author_voice_sample", resourceId: row.id, metadata: { words } });
  return { ok: true, id: row.id, words };
}

export async function removeVoiceSample(input: { organizationId: string; userId: string; sampleId: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const [row] = await db
    .delete(authorVoiceSamples)
    .where(and(eq(authorVoiceSamples.id, input.sampleId), eq(authorVoiceSamples.organizationId, organizationId), eq(authorVoiceSamples.userId, input.userId)))
    .returning({ id: authorVoiceSamples.id });
  if (!row) return { ok: false, error: "Sample not found." };
  await recordAudit({ organizationId, actor: input.actor, action: "voice.sample.remove", resourceType: "author_voice_sample", resourceId: row.id, metadata: {} });
  return { ok: true };
}

/** The author's switch and notes; the guidance is recomposed when a profile exists. */
export async function updateVoiceSettings(input: { organizationId: string; userId: string; enabled: boolean; customGuidance: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const customGuidance = input.customGuidance.trim().slice(0, VOICE_LIMITS.maxCustomChars);
  const [existing] = await db
    .select({ id: authorVoiceProfiles.id, metrics: authorVoiceProfiles.metrics, traits: authorVoiceProfiles.traits })
    .from(authorVoiceProfiles)
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, input.userId)))
    .limit(1);
  const guidance = existing?.metrics ? voiceGuidance({ authorName: await authorName(input.userId), metrics: existing.metrics, traits: existing.traits, custom: customGuidance }) : "";
  if (existing) {
    await db
      .update(authorVoiceProfiles)
      .set({ enabled: input.enabled, customGuidance, guidance, updatedAt: new Date() })
      .where(and(eq(authorVoiceProfiles.id, existing.id), eq(authorVoiceProfiles.organizationId, organizationId)));
  } else {
    await db.insert(authorVoiceProfiles).values({ organizationId, userId: input.userId, enabled: input.enabled, customGuidance, guidance });
  }
  await recordAudit({ organizationId, actor: input.actor, action: "voice.settings.update", resourceType: "author_voice_profile", resourceId: input.userId, metadata: { enabled: input.enabled, hasNotes: customGuidance.length > 0 } });
  return { ok: true };
}

export type SectionVoice = { author: string; guidance: string };

/** The guidance for a section's author, when they own one that is enabled; null otherwise. */
export async function voiceGuidanceForSection(input: { organizationId: string; sectionId: string }): Promise<SectionVoice | null> {
  const { organizationId } = input;
  const [row] = await db
    .select({ guidance: authorVoiceProfiles.guidance, enabled: authorVoiceProfiles.enabled, name: users.name, email: users.email })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .innerJoin(authorVoiceProfiles, and(eq(authorVoiceProfiles.userId, proposalSections.authorUserId), eq(authorVoiceProfiles.organizationId, organizationId)))
    .innerJoin(users, eq(users.id, authorVoiceProfiles.userId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .orderBy(asc(authorVoiceProfiles.createdAt))
    .limit(1);
  if (!row || !row.enabled || !row.guidance.trim()) return null;
  return { author: row.name?.trim() || row.email?.split("@")[0] || "the author", guidance: row.guidance };
}
