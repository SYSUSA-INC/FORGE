/**
 * BL-FB-GEN-VOICE — an author's writing voice against Postgres: the
 * profile is rebuilt from the sections they own in this organization
 * plus the texts they pasted, stored once per (organization, user), and
 * handed to the drafter and chat for sections this author owns.
 *
 * Slice 2: the rebuild subtracts the sentences the AI drafted and the
 * author merely kept (`section_draft_signal`), so the profile is the
 * author's own prose; a save by the author re-learns at most once an
 * hour; the team's house style (`organization.house_style`) is layered
 * under every author's voice; the editor can read the profile to check
 * a draft against it. Server-only; callers own auth; mutations audited.
 */
import "server-only";

import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { authorVoiceProfiles, authorVoiceSamples, organizations, proposalSections, proposals, sectionDraftSignals, users, type TipTapDoc, type VoiceMetrics } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { projectToPlain } from "@/lib/tiptap-doc";
import { AUTO_REBUILD_MIN_INTERVAL_MS, VOICE_LIMITS, analyzeVoice, authoredSentences, describeVoice, houseStyleGuidance, sampleWordCount, voiceGuidance } from "@/lib/voice-logic";

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
  | { ok: true; traits: string[]; sampleCount: number; sampleWords: number; sections: number; pasted: number; aiWordsDropped: number }
  | { ok: false; error: string };

/**
 * Read the author's sections in this organization and their pasted
 * samples; drop the sentences the AI drafted and they kept; measure;
 * store.
 */
export async function rebuildVoiceProfile(input: { organizationId: string; userId: string; actor: Actor; trigger?: "manual" | "save" }): Promise<RebuildResult> {
  const { organizationId } = input;
  const pasted = await db
    .select({ text: authorVoiceSamples.text })
    .from(authorVoiceSamples)
    .where(and(eq(authorVoiceSamples.organizationId, organizationId), eq(authorVoiceSamples.userId, input.userId)))
    .orderBy(desc(authorVoiceSamples.createdAt))
    .limit(VOICE_LIMITS.maxSamples);
  const sectionRows = await db
    .select({ id: proposalSections.id, content: proposalSections.content, bodyDoc: proposalSections.bodyDoc })
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

  // Slice 2 — what the AI drafted for these sections. A sentence the
  // author accepted verbatim is the model's voice, not theirs.
  const drafts = new Map<string, string[]>();
  if (sectionRows.length > 0) {
    const signals = await db
      .select({ sectionId: sectionDraftSignals.sectionId, draftText: sectionDraftSignals.draftText })
      .from(sectionDraftSignals)
      .where(and(eq(sectionDraftSignals.organizationId, organizationId), inArray(sectionDraftSignals.sectionId, sectionRows.map((r) => r.id))))
      .orderBy(desc(sectionDraftSignals.createdAt))
      .limit(VOICE_LIMITS.maxSamples * 3);
    for (const s of signals) drafts.set(s.sectionId, [...(drafts.get(s.sectionId) ?? []), s.draftText]);
  }
  let aiWordsDropped = 0;
  const sectionTexts: string[] = [];
  for (const r of sectionRows) {
    const full = (projectToPlain(r.bodyDoc as TipTapDoc | null) || r.content || "").slice(0, VOICE_LIMITS.maxSampleChars);
    const ai = drafts.get(r.id);
    const own = ai?.length ? authoredSentences(full, ai).join(" ") : full;
    aiWordsDropped += Math.max(0, sampleWordCount(full) - sampleWordCount(own));
    if (sampleWordCount(own) >= VOICE_LIMITS.minSampleWords) sectionTexts.push(own);
  }
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
    metadata: { sampleCount: texts.length, sampleWords: metrics.words, sections: sectionTexts.length, pasted: pasted.length, traits: traits.length, aiWordsDropped, trigger: input.trigger ?? "manual" },
  });
  return { ok: true, traits, sampleCount: texts.length, sampleWords: metrics.words, sections: sectionTexts.length, pasted: pasted.length, aiWordsDropped };
}

export type RefreshResult = { refreshed: boolean; reason: "not_author" | "no_profile" | "throttled" | "too_little" | "rebuilt" };

/**
 * Slice 2 — after a section save by its author: re-learn their voice from
 * what they kept and rewrote, when they have a built profile and it is
 * more than an hour old. Anyone else's save, or an unbuilt profile,
 * changes nothing.
 */
export async function refreshVoiceAfterSave(input: { organizationId: string; sectionId: string; userId: string; actor: Actor; now?: Date }): Promise<RefreshResult> {
  const { organizationId } = input;
  const now = input.now ?? new Date();
  const [section] = await db
    .select({ authorUserId: proposalSections.authorUserId })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, input.sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!section || section.authorUserId !== input.userId) return { refreshed: false, reason: "not_author" };
  const [profile] = await db
    .select({ builtAt: authorVoiceProfiles.builtAt })
    .from(authorVoiceProfiles)
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, input.userId)))
    .limit(1);
  if (!profile?.builtAt) return { refreshed: false, reason: "no_profile" };
  if (now.getTime() - profile.builtAt.getTime() < AUTO_REBUILD_MIN_INTERVAL_MS) return { refreshed: false, reason: "throttled" };
  const res = await rebuildVoiceProfile({ organizationId, userId: input.userId, actor: input.actor, trigger: "save" });
  return res.ok ? { refreshed: true, reason: "rebuilt" } : { refreshed: false, reason: "too_little" };
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

// ── Slice 2 — house style ────────────────────────────────────────────

export async function getHouseStyle(input: { organizationId: string }): Promise<{ orgName: string; houseStyle: string }> {
  const { organizationId } = input;
  const [org] = await db.select({ name: organizations.name, houseStyle: organizations.houseStyle }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return { orgName: org?.name?.trim() || "the team", houseStyle: org?.houseStyle ?? "" };
}

/** The team's writing rules; an empty text clears them. Tenant admins only (callers gate); audited. */
export async function updateHouseStyle(input: { organizationId: string; text: string; actor: Actor }): Promise<{ ok: true; houseStyle: string } | { ok: false; error: string }> {
  const { organizationId } = input;
  const houseStyle = input.text.replace(/\r\n?/g, "\n").trim().slice(0, VOICE_LIMITS.maxHouseStyleChars);
  const [row] = await db
    .update(organizations)
    .set({ houseStyle, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
    .returning({ id: organizations.id });
  if (!row) return { ok: false, error: "Organization not found." };
  await recordAudit({ organizationId, actor: input.actor, action: "voice.house_style.update", resourceType: "organization", resourceId: organizationId, metadata: { chars: houseStyle.length, cleared: houseStyle.length === 0 } });
  return { ok: true, houseStyle };
}

// ── For the drafter, the chat and the editor ─────────────────────────

async function sectionAuthor(organizationId: string, sectionId: string): Promise<{ found: boolean; authorUserId: string | null }> {
  const [section] = await db
    .select({ authorUserId: proposalSections.authorUserId })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.id, sectionId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return { found: !!section, authorUserId: section?.authorUserId ?? null };
}

export type SectionVoice = { author: string; guidance: string; authorVoice: boolean; houseStyle: boolean };

/**
 * The guidance for a section: the team's house style, then the author's
 * own voice when they have an enabled profile; null when there is
 * neither or the section is not this organization's.
 */
export async function voiceGuidanceForSection(input: { organizationId: string; sectionId: string }): Promise<SectionVoice | null> {
  const { organizationId } = input;
  const section = await sectionAuthor(organizationId, input.sectionId);
  if (!section.found) return null;
  let author: { name: string; guidance: string } | null = null;
  if (section.authorUserId) {
    const [row] = await db
      .select({ guidance: authorVoiceProfiles.guidance, enabled: authorVoiceProfiles.enabled, name: users.name, email: users.email })
      .from(authorVoiceProfiles)
      .innerJoin(users, eq(users.id, authorVoiceProfiles.userId))
      .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, section.authorUserId)))
      .limit(1);
    if (row && row.enabled && row.guidance.trim()) author = { name: row.name?.trim() || row.email?.split("@")[0] || "the author", guidance: row.guidance };
  }
  const style = await getHouseStyle({ organizationId });
  const parts: string[] = [];
  if (style.houseStyle) parts.push(houseStyleGuidance(style.orgName, style.houseStyle));
  if (author) parts.push(author.guidance);
  if (parts.length === 0) return null;
  return { author: author?.name ?? style.orgName, guidance: parts.join("\n\n"), authorVoice: !!author, houseStyle: !!style.houseStyle };
}

export type SectionVoiceProfile = { author: string; metrics: VoiceMetrics; traits: string[] };

/** Slice 2 — the author's measured profile for the editor's voice check; null without an enabled, built profile. */
export async function voiceProfileForSection(input: { organizationId: string; sectionId: string }): Promise<SectionVoiceProfile | null> {
  const { organizationId } = input;
  const section = await sectionAuthor(organizationId, input.sectionId);
  if (!section.found || !section.authorUserId) return null;
  const [row] = await db
    .select({ metrics: authorVoiceProfiles.metrics, traits: authorVoiceProfiles.traits, enabled: authorVoiceProfiles.enabled, name: users.name, email: users.email })
    .from(authorVoiceProfiles)
    .innerJoin(users, eq(users.id, authorVoiceProfiles.userId))
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.userId, section.authorUserId)))
    .limit(1);
  if (!row || !row.enabled || !row.metrics) return null;
  return { author: row.name?.trim() || row.email?.split("@")[0] || "the author", metrics: row.metrics, traits: row.traits };
}

/** Slice 2 — the members whose sections the drafter writes in their voice (enabled, built profiles), for the editor's chip. */
export async function voiceAuthorIds(input: { organizationId: string }): Promise<string[]> {
  const { organizationId } = input;
  const rows = await db
    .select({ userId: authorVoiceProfiles.userId })
    .from(authorVoiceProfiles)
    .where(and(eq(authorVoiceProfiles.organizationId, organizationId), eq(authorVoiceProfiles.enabled, true), isNotNull(authorVoiceProfiles.builtAt)));
  return rows.map((r) => r.userId);
}
