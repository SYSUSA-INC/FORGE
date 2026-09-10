/**
 * BL-FB-CHAT-PERSIST — runtime tests for the persisted section thread.
 *
 * Pins the lib contract the action and the streaming route both rely on:
 * append writes one user + one assistant row, display history comes back
 * oldest-first with author attribution, model history is trimmed to the
 * last N turns, threads are tenant-isolated, and clear removes only the
 * targeted section's rows.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { proposalSections, sectionChatMessages } from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import {
  appendSectionChatTurns,
  clearSectionChat,
  findSectionForOrg,
  loadSectionChatHistory,
  loadSectionChatModelHistory,
} from "@/lib/section-chat";

async function createSection(proposalId: string, title: string): Promise<string> {
  const [row] = await db
    .insert(proposalSections)
    .values({ proposalId, kind: "technical", title })
    .returning({ id: proposalSections.id });
  if (!row) throw new Error("section insert failed");
  return row.id;
}

describe("BL-FB-CHAT-PERSIST — section chat thread (runtime)", () => {
  let fx: TwoTenantFixture;
  let sectionA: string;
  let sectionA2: string;
  let sectionB: string;

  beforeEach(async () => {
    fx = await createTwoTenants("chat-persist");
    sectionA = await createSection(fx.orgA.proposalId, "Technical Approach");
    sectionA2 = await createSection(fx.orgA.proposalId, "Management");
    sectionB = await createSection(fx.orgB.proposalId, "Technical Approach");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("findSectionForOrg confirms ownership and refuses a foreign section", async () => {
    const own = await findSectionForOrg({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
    });
    expect(own?.proposalId).toBe(fx.orgA.proposalId);

    const foreign = await findSectionForOrg({
      organizationId: fx.orgB.organizationId,
      sectionId: sectionA,
    });
    expect(foreign).toBeNull();
  });

  it("append writes a user + assistant pair and history returns them oldest-first with attribution", async () => {
    await appendSectionChatTurns({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      sectionId: sectionA,
      userId: fx.orgA.userId,
      userMessage: "How should we open?",
      assistantReply: "Lead with the mission outcome.",
      stubbed: false,
    });

    const mine = await loadSectionChatHistory({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      viewerUserId: fx.orgA.userId,
    });
    expect(mine.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(mine[0]!.content).toBe("How should we open?");
    expect(mine[0]!.isMine).toBe(true);
    expect(mine[0]!.authorName).toContain("Test ");
    expect(mine[1]!.content).toBe("Lead with the mission outcome.");
    expect(mine[1]!.stubbed).toBe(false);

    // A different viewer in the same org sees the author, not "mine".
    const theirs = await loadSectionChatHistory({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      viewerUserId: "someone-else",
    });
    expect(theirs[0]!.isMine).toBe(false);
  });

  it("model history is oldest-first and trimmed to the last N turns", async () => {
    for (let i = 1; i <= 5; i++) {
      await appendSectionChatTurns({
        organizationId: fx.orgA.organizationId,
        proposalId: fx.orgA.proposalId,
        sectionId: sectionA,
        userId: fx.orgA.userId,
        userMessage: `q${i}`,
        assistantReply: `a${i}`,
        stubbed: false,
      });
    }
    const last4 = await loadSectionChatModelHistory({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
      turns: 4,
    });
    expect(last4.map((m) => m.content)).toEqual(["q4", "a4", "q5", "a5"]);
    expect(last4.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("threads are isolated per tenant and per section", async () => {
    await appendSectionChatTurns({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      sectionId: sectionA,
      userId: fx.orgA.userId,
      userMessage: "A says hi",
      assistantReply: "Hi A",
      stubbed: false,
    });
    await appendSectionChatTurns({
      organizationId: fx.orgB.organizationId,
      proposalId: fx.orgB.proposalId,
      sectionId: sectionB,
      userId: fx.orgB.userId,
      userMessage: "B says hi",
      assistantReply: "Hi B",
      stubbed: true,
    });

    // Org B asking for org A's section id gets nothing.
    expect(
      await loadSectionChatHistory({
        organizationId: fx.orgB.organizationId,
        sectionId: sectionA,
        viewerUserId: fx.orgB.userId,
      }),
    ).toEqual([]);
    expect(
      await loadSectionChatModelHistory({
        organizationId: fx.orgB.organizationId,
        sectionId: sectionA,
      }),
    ).toEqual([]);

    // Another section in org A is its own thread.
    expect(
      await loadSectionChatHistory({
        organizationId: fx.orgA.organizationId,
        sectionId: sectionA2,
        viewerUserId: fx.orgA.userId,
      }),
    ).toEqual([]);

    // Org B's own thread is intact, stub flag preserved.
    const b = await loadSectionChatHistory({
      organizationId: fx.orgB.organizationId,
      sectionId: sectionB,
      viewerUserId: fx.orgB.userId,
    });
    expect(b.map((m) => m.content)).toEqual(["B says hi", "Hi B"]);
    expect(b[1]!.stubbed).toBe(true);
  });

  it("clear removes only the targeted section's rows and reports the count", async () => {
    for (const sid of [sectionA, sectionA2]) {
      await appendSectionChatTurns({
        organizationId: fx.orgA.organizationId,
        proposalId: fx.orgA.proposalId,
        sectionId: sid,
        userId: fx.orgA.userId,
        userMessage: "q",
        assistantReply: "a",
        stubbed: false,
      });
    }
    const deleted = await clearSectionChat({
      organizationId: fx.orgA.organizationId,
      sectionId: sectionA,
    });
    expect(deleted).toBe(2);

    const remaining = await db
      .select({ sectionId: sectionChatMessages.sectionId })
      .from(sectionChatMessages)
      .where(eq(sectionChatMessages.organizationId, fx.orgA.organizationId));
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.sectionId === sectionA2)).toBe(true);

    // Clearing with the wrong org is a no-op.
    expect(
      await clearSectionChat({
        organizationId: fx.orgB.organizationId,
        sectionId: sectionA2,
      }),
    ).toBe(0);
  });
});
