/**
 * BL-FB-CHAT-MULTI — the team thread against Postgres. Two tenants.
 * Asserts: a note lands on the owning tenant's section only, shows to
 * the team with its author, never reaches the model's history; the
 * exchange returns its ids; a mention notifies only the active member
 * named, never the author or an outsider, with the link to the section
 * chat; audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, notificationDeliveries, notificationRules, notifications, proposalSections, users } from "@/db/schema";
import {
  appendSectionChatNote,
  appendSectionChatTurns,
  loadSectionChatHistory,
  loadSectionChatModelHistory,
  loadSectionChatThread,
  markSectionChatRead,
  notifySectionChatMentions,
  prepareSectionChat,
  setSectionChatNotesToModel,
  unreadChatCounts,
} from "@/lib/section-chat";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-CHAT-MULTI — the team thread", () => {
  let fx: TwoTenantFixture;
  let sectionA = "";
  let teammate = "";

  beforeEach(async () => {
    fx = await createTwoTenants("chat-multi");
    const [sec] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" })
      .returning({ id: proposalSections.id });
    sectionA = sec!.id;
    teammate = `${fx.orgA.userId}-mate`;
    await db.insert(users).values({ id: teammate, name: "Mate Teammate", email: `${teammate}@bl19-isolation.test`, emailVerified: new Date() });
    await db.insert(memberships).values({ userId: teammate, organizationId: fx.orgA.organizationId, role: "author", status: "active" });
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, teammate));
  });

  it("posts a note the team sees and the model does not, on the owning tenant's section only", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    expect(await appendSectionChatNote({ organizationId: fx.orgB.organizationId, sectionId: sectionA, userId: fx.orgB.userId, content: "hijack", actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Section not found." });
    expect((await appendSectionChatNote({ organizationId: fx.orgA.organizationId, sectionId: sectionA, userId: fx.orgA.userId, content: "   ", actor })).ok).toBe(false);

    const note = await appendSectionChatNote({ organizationId: fx.orgA.organizationId, sectionId: sectionA, userId: fx.orgA.userId, content: `@[${teammate}] can you own the transition paragraph?`, actor });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.proposalId).toBe(fx.orgA.proposalId);
    expect(note.message).toMatchObject({ role: "note", isMine: true, stubbed: false });
    expect(note.message.authorName).toContain("Test ");

    const ids = await appendSectionChatTurns({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, sectionId: sectionA, userId: teammate, userMessage: "Draft the transition paragraph.", assistantReply: "Here is a draft.", stubbed: true });
    expect(ids.userMessageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids.assistantMessageId).toMatch(/^[0-9a-f-]{36}$/);

    const asMate = await loadSectionChatHistory({ organizationId: fx.orgA.organizationId, sectionId: sectionA, viewerUserId: teammate });
    expect(asMate.map((m) => [m.role, m.isMine])).toEqual([
      ["note", false],
      ["user", true],
      ["assistant", true],
    ]);
    expect(asMate[0]!.authorName).toContain("Test ");
    expect(asMate[0]!.content).toContain(`@[${teammate}]`);

    const model = await loadSectionChatModelHistory({ organizationId: fx.orgA.organizationId, sectionId: sectionA });
    expect(model).toEqual([
      { role: "user", content: "Draft the transition paragraph." },
      { role: "assistant", content: "Here is a draft." },
    ]);
    expect(await loadSectionChatHistory({ organizationId: fx.orgB.organizationId, sectionId: sectionA, viewerUserId: fx.orgB.userId })).toEqual([]);

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "section_chat.note")).toHaveLength(1);
  });

  it("notifies only the active member a message mentions, with the link into the section chat", async () => {
    const [rule] = await db
      .insert(notificationRules)
      .values({ organizationId: fx.orgA.organizationId, name: "Test: mention", triggerEventKind: "comment_mentioned", recipientStrategy: "mentioned_in_payload", channels: ["in_app"], frequency: "immediate", active: true })
      .returning({ id: notificationRules.id });
    const note = await appendSectionChatNote({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      userId: fx.orgA.userId,
      content: `@[${teammate}] and @[${fx.orgA.userId}] and @[${fx.orgB.userId}] please read this.`,
      actor: { userId: fx.orgA.userId, email: "a@test" },
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;

    const named = await notifySectionChatMentions({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, sectionId: sectionA, messageId: note.message.id, actorUserId: fx.orgA.userId, body: note.message.content });
    expect(named).toBe(1);
    const deliveries = await db
      .select({ recipientUserId: notificationDeliveries.recipientUserId })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.organizationId, fx.orgA.organizationId), eq(notificationDeliveries.ruleId, rule!.id)));
    expect(deliveries.map((d) => d.recipientUserId)).toEqual([teammate]);
    const [inbox] = await db
      .select({ subject: notifications.subject, body: notifications.body, linkPath: notifications.linkPath, proposalId: notifications.proposalId })
      .from(notifications)
      .where(and(eq(notifications.organizationId, fx.orgA.organizationId), eq(notifications.recipientUserId, teammate)));
    expect(inbox?.subject).toMatch(/^Test .* mentioned you in the chat on "Technical approach"$/);
    expect(inbox?.body).toContain("@Mate Teammate and @Test ");
    expect(inbox?.body).not.toContain("@[");
    // Slice 2 — the link opens the chat scrolled to the message.
    expect(inbox?.linkPath).toBe(`/proposals/${fx.orgA.proposalId}/sections?section=${sectionA}&tab=chat&message=${note.message.id}`);
    expect(inbox?.proposalId).toBe(fx.orgA.proposalId);

    // No mention, or only the author: nothing goes out.
    expect(await notifySectionChatMentions({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, sectionId: sectionA, messageId: note.message.id, actorUserId: fx.orgA.userId, body: `@[${fx.orgA.userId}] note to self` })).toBe(0);
    // Another tenant naming A's member through A's section id gets nothing.
    expect(await notifySectionChatMentions({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId, sectionId: sectionA, messageId: note.message.id, actorUserId: fx.orgB.userId, body: `@[${teammate}] hi` })).toBe(0);
  });

  it("Slice 2: counts what is new per viewer, keeps replies in the thread, lets the model read notes on request", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    // Nobody has looked yet: everything by someone else is new.
    const note = await appendSectionChatNote({ organizationId: fx.orgA.organizationId, sectionId: sectionA, userId: fx.orgA.userId, content: "Lead with the outcome.", actor });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    await appendSectionChatTurns({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, sectionId: sectionA, userId: teammate, userMessage: "Draft the transition paragraph.", assistantReply: "Here is a draft.", stubbed: true, replyToMessageId: note.message.id });
    expect(await unreadChatCounts({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, viewerUserId: teammate })).toEqual({ [sectionA]: 1 });
    expect(await unreadChatCounts({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, viewerUserId: fx.orgA.userId })).toEqual({ [sectionA]: 2 });
    expect(await unreadChatCounts({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId, viewerUserId: fx.orgB.userId })).toEqual({});

    // The thread carries each reply's target; a target from another tenant's thread is dropped.
    const thread = await loadSectionChatThread({ organizationId: fx.orgA.organizationId, sectionId: sectionA, viewerUserId: teammate });
    expect(thread?.lastReadAt).toBeNull();
    expect(thread?.notesToModel).toBe(false);
    expect(thread?.messages.map((m) => [m.role, m.replyToMessageId])).toEqual([
      ["note", null],
      ["user", note.message.id],
      ["assistant", null],
    ]);
    expect(thread?.messages[1]!.replyTo).toMatchObject({ id: note.message.id, role: "note", content: "Lead with the outcome." });
    expect(thread?.messages[1]!.replyTo?.authorName).toContain("Test ");
    const [secB] = await db.insert(proposalSections).values({ proposalId: fx.orgB.proposalId, kind: "technical", title: "B" }).returning({ id: proposalSections.id });
    const bNote = await appendSectionChatNote({ organizationId: fx.orgB.organizationId, sectionId: secB!.id, userId: fx.orgB.userId, content: "B's note", actor: { userId: fx.orgB.userId } });
    expect(bNote.ok).toBe(true);
    if (!bNote.ok) return;
    const cross = await appendSectionChatNote({ organizationId: fx.orgA.organizationId, sectionId: sectionA, userId: fx.orgA.userId, content: "Replying across tenants?", replyToMessageId: bNote.message.id, actor });
    expect(cross.ok).toBe(true);
    if (!cross.ok) return;
    expect(cross.message.replyToMessageId).toBeNull();
    expect(await loadSectionChatThread({ organizationId: fx.orgB.organizationId, sectionId: sectionA, viewerUserId: fx.orgB.userId })).toBeNull();

    // Looking marks the thread read for this viewer only, and the badge clears.
    expect((await markSectionChatRead({ organizationId: fx.orgA.organizationId, sectionId: sectionA, userId: teammate })).ok).toBe(true);
    expect(await unreadChatCounts({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, viewerUserId: teammate })).toEqual({});
    expect((await unreadChatCounts({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, viewerUserId: fx.orgA.userId }))[sectionA]).toBe(2);
    expect((await loadSectionChatThread({ organizationId: fx.orgA.organizationId, sectionId: sectionA, viewerUserId: teammate }))?.lastReadAt).not.toBeNull();
    expect((await markSectionChatRead({ organizationId: fx.orgB.organizationId, sectionId: sectionA, userId: fx.orgB.userId })).ok).toBe(false);

    // Notes reach the model only when the section opts in, as context under the author's name.
    expect((await setSectionChatNotesToModel({ organizationId: fx.orgB.organizationId, sectionId: sectionA, enabled: true, actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    const before = await prepareSectionChat({ organizationId: fx.orgA.organizationId, sectionId: sectionA, history: [], message: "Where do we start?" });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.system).not.toContain("Notes the team left");
    // BL-AIX Phase 1g — the draft rides with the newest message, so the context stays cacheable.
    expect(before.system).not.toContain("Current draft");
    expect(before.messages.at(-1)?.content).toMatch(/--- MESSAGE ---\nWhere do we start\?$/);
    expect(await setSectionChatNotesToModel({ organizationId: fx.orgA.organizationId, sectionId: sectionA, enabled: true, actor })).toEqual({ ok: true, enabled: true });
    const after = await prepareSectionChat({ organizationId: fx.orgA.organizationId, sectionId: sectionA, history: [], message: "Where do we start?" });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.system).toContain("Notes the team left on this section");
    expect(after.system).toMatch(/- Test .*: Lead with the outcome\./);
    expect(after.system).not.toContain("Draft the transition paragraph.");

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "section_chat.notes_to_model")).toHaveLength(1);
  });
});
