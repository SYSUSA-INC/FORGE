/**
 * BL-FB-CHAT-UPLOAD — documents in the section chat against Postgres.
 * Two tenants. Asserts: a text file attaches to the owning tenant's
 * section only and its text reaches the prompt loader; limits and
 * unsupported formats are refused; remove and save-to-Knowledge work
 * for the owner only (the artifact belongs to the owner, save is
 * idempotent); clearing the chat drops the attachments; audits.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, knowledgeArtifacts, proposalSections } from "@/db/schema";
import { clearSectionChat } from "@/lib/section-chat";
import {
  attachChatDocument,
  listChatAttachments,
  loadChatAttachmentTexts,
  removeChatAttachment,
  saveChatAttachmentToKnowledge,
} from "@/lib/section-chat-attachments";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const enc = new TextEncoder();

describe("BL-FB-CHAT-UPLOAD — chat attachments", () => {
  let fx: TwoTenantFixture;
  let sectionA = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("chat-attach");
    const [sec] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" })
      .returning({ id: proposalSections.id });
    sectionA = sec!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("attaches to the owning tenant's section only, with limits", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const res = await attachChatDocument({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      fileName: `sample-sow-${tag}.txt`,
      contentType: "text/plain",
      bytes: enc.encode("1. Scope. The contractor shall migrate workloads.\n2. Deliverables. Monthly status reports."),
      actor,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attachment).toMatchObject({ fileName: `sample-sow-${tag}.txt`, savedArtifactId: null });
    expect(res.attachment.chars).toBeGreaterThan(50);

    const listA = await listChatAttachments({ organizationId: fx.orgA.organizationId, sectionId: sectionA });
    expect(listA.map((a) => a.id)).toEqual([res.attachment.id]);
    expect(listA[0]!.authorName).toContain("Test ");
    expect(await listChatAttachments({ organizationId: fx.orgB.organizationId, sectionId: sectionA })).toEqual([]);
    const texts = await loadChatAttachmentTexts({ organizationId: fx.orgA.organizationId, sectionId: sectionA });
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toContain("Monthly status reports");
    expect(await loadChatAttachmentTexts({ organizationId: fx.orgB.organizationId, sectionId: sectionA })).toEqual([]);

    // Another tenant cannot attach to A's section.
    const foreign = await attachChatDocument({
      organizationId: fx.orgB.organizationId,
      sectionId: sectionA,
      fileName: "x.txt",
      contentType: "text/plain",
      bytes: enc.encode("hello world"),
      actor: { userId: fx.orgB.userId },
    });
    expect(foreign).toEqual({ ok: false, error: "Section not found." });

    // Empty, unsupported, unreadable.
    expect((await attachChatDocument({ organizationId: fx.orgA.organizationId, sectionId: sectionA, fileName: "e.txt", contentType: "text/plain", bytes: new Uint8Array(), actor })).ok).toBe(false);
    const image = await attachChatDocument({ organizationId: fx.orgA.organizationId, sectionId: sectionA, fileName: "scan.png", contentType: "image/png", bytes: enc.encode("png"), actor });
    expect(image.ok).toBe(false);
    if (!image.ok) expect(image.error).toMatch(/Images/);
    expect((await attachChatDocument({ organizationId: fx.orgA.organizationId, sectionId: sectionA, fileName: "blank.txt", contentType: "text/plain", bytes: enc.encode("   \n  "), actor })).ok).toBe(false);

    // Five per conversation.
    for (let i = 0; i < 4; i++) {
      const more = await attachChatDocument({ organizationId: fx.orgA.organizationId, sectionId: sectionA, fileName: `n${i}.md`, contentType: "text/markdown", bytes: enc.encode(`# Note ${i}\nSome text here.`), actor });
      expect(more.ok).toBe(true);
    }
    const sixth = await attachChatDocument({ organizationId: fx.orgA.organizationId, sectionId: sectionA, fileName: "n6.txt", contentType: "text/plain", bytes: enc.encode("too many"), actor });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error).toMatch(/Up to 5/);
  });

  it("removes, saves to Knowledge and clears for the owner only, audited", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const a = await attachChatDocument({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      fileName: `brief-${tag}.txt`,
      contentType: "text/plain",
      bytes: enc.encode("Capability brief: we run a 24x7 SOC and a zero trust architecture for NAVSEA."),
      actor,
    });
    const b = await attachChatDocument({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      fileName: `prior-${tag}.txt`,
      contentType: "text/plain",
      bytes: enc.encode("Prior proposal excerpt. Transition in 30 days with a named lead."),
      actor,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Foreign tenant can neither remove nor save.
    expect(await removeChatAttachment({ organizationId: fx.orgB.organizationId, attachmentId: a.attachment.id, actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Attachment not found." });
    expect((await saveChatAttachmentToKnowledge({ organizationId: fx.orgB.organizationId, attachmentId: a.attachment.id, actor: { userId: fx.orgB.userId } })).ok).toBe(false);

    // Save: a text-only artifact of the owner, linked back; idempotent.
    const saved = await saveChatAttachmentToKnowledge({ organizationId: fx.orgA.organizationId, attachmentId: a.attachment.id, actor });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const [artifact] = await db
      .select({ orgId: knowledgeArtifacts.organizationId, rawText: knowledgeArtifacts.rawText, status: knowledgeArtifacts.status, kind: knowledgeArtifacts.kind, title: knowledgeArtifacts.title, tags: knowledgeArtifacts.tags })
      .from(knowledgeArtifacts)
      .where(eq(knowledgeArtifacts.id, saved.artifactId));
    expect(artifact).toMatchObject({ orgId: fx.orgA.organizationId, status: "indexed", kind: "note", title: `brief-${tag}` });
    expect(artifact!.rawText).toContain("zero trust architecture");
    expect(artifact!.tags).toContain("chat-attachment");
    const again = await saveChatAttachmentToKnowledge({ organizationId: fx.orgA.organizationId, attachmentId: a.attachment.id, actor });
    expect(again).toMatchObject({ ok: true, artifactId: saved.artifactId, embedded: false });
    const list = await listChatAttachments({ organizationId: fx.orgA.organizationId, sectionId: sectionA });
    expect(list.find((x) => x.id === a.attachment.id)?.savedArtifactId).toBe(saved.artifactId);

    // Remove one; clear the chat removes the rest.
    expect(await removeChatAttachment({ organizationId: fx.orgA.organizationId, attachmentId: b.attachment.id, actor })).toEqual({ ok: true });
    expect((await listChatAttachments({ organizationId: fx.orgA.organizationId, sectionId: sectionA })).map((x) => x.id)).toEqual([a.attachment.id]);
    await clearSectionChat({ organizationId: fx.orgA.organizationId, sectionId: sectionA });
    expect(await listChatAttachments({ organizationId: fx.orgA.organizationId, sectionId: sectionA })).toEqual([]);
    // The saved artifact survives the clear.
    expect((await db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(eq(knowledgeArtifacts.id, saved.artifactId))).length).toBe(1);

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const names = actions.map((r) => r.action);
    expect(names.filter((n) => n === "section_chat.attach")).toHaveLength(2);
    expect(names.filter((n) => n === "section_chat.detach")).toHaveLength(1);
    expect(names.filter((n) => n === "section_chat.attachment.save_to_knowledge")).toHaveLength(1);
    const none = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "section_chat.attach")));
    expect(none).toHaveLength(0);
  });
});
