/**
 * BL-FB-GEN-BLOCKS — content blocks and version history against
 * Postgres. Two tenants. Asserts: versions are recorded, listed and
 * restored for the deciding tenant only (with the lazy v1 of an older
 * entry); the block list shows live boilerplate with its latest version
 * and never another tenant's; an insertion bumps the reuse counter of
 * the owning tenant's block only. Every write is audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, knowledgeEntries } from "@/db/schema";
import { listContentBlocks, recordBlockUse } from "@/lib/content-blocks";
import { listEntryVersions, recordEntryVersion, restoreEntryVersion } from "@/lib/entry-versions";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-GEN-BLOCKS — content blocks and versions", () => {
  let fx: TwoTenantFixture;
  const tag = Date.now().toString(36);
  let blockA = "";
  let capabilityA = "";
  let archivedA = "";
  let blockB = "";

  beforeEach(async () => {
    fx = await createTwoTenants("blocks");
    const rows = await db
      .insert(knowledgeEntries)
      .values([
        { organizationId: fx.orgA.organizationId, kind: "boilerplate", title: `Company overview ${tag}`, body: "Founded in 2009, we deliver cloud migration.", tags: ["overview", "corporate"] },
        { organizationId: fx.orgA.organizationId, kind: "capability", title: `Not a block ${tag}`, body: "A capability.", tags: [] },
        { organizationId: fx.orgA.organizationId, kind: "boilerplate", title: `Archived block ${tag}`, body: "Old text.", tags: [], archivedAt: new Date() },
        { organizationId: fx.orgB.organizationId, kind: "boilerplate", title: `B overview ${tag}`, body: "Tenant B's overview.", tags: ["overview"] },
      ])
      .returning({ id: knowledgeEntries.id, title: knowledgeEntries.title });
    blockA = rows.find((r) => r.title.startsWith("Company overview"))!.id;
    capabilityA = rows.find((r) => r.title.startsWith("Not a block"))!.id;
    archivedA = rows.find((r) => r.title.startsWith("Archived"))!.id;
    blockB = rows.find((r) => r.title.startsWith("B overview"))!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("records, lists and restores versions for the deciding tenant only", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    // An entry that predates version history: the first tracked save keeps the old state as v1.
    const v = await recordEntryVersion({
      organizationId: fx.orgA.organizationId,
      entryId: blockA,
      state: { title: `Company overview ${tag}`, body: "Founded in 2009, we deliver cloud migration and zero-trust security.", tags: ["overview", "corporate", "cyber"] },
      previous: { title: `Company overview ${tag}`, body: "Founded in 2009, we deliver cloud migration.", tags: ["overview", "corporate"] },
      changeNote: "  Added the   zero-trust line ",
      actor,
    });
    expect(v).toBe(2);
    const list = await listEntryVersions({ organizationId: fx.orgA.organizationId, entryId: blockA });
    expect(list.map((x) => [x.version, x.changeNote, x.wordsAdded, x.wordsRemoved])).toEqual([
      [2, "Added the zero-trust line", 3, 0],
      [1, "Before first tracked change", 7, 0],
    ]);
    expect(list[0]!.authorName).toContain("Test ");
    expect(list[1]!.authorName).toBeNull();

    // Another tenant sees nothing and cannot restore.
    expect(await listEntryVersions({ organizationId: fx.orgB.organizationId, entryId: blockA })).toEqual([]);
    expect(
      await restoreEntryVersion({ organizationId: fx.orgB.organizationId, entryId: blockA, version: 1, actor: { userId: fx.orgB.userId } }),
    ).toEqual({ ok: false, error: "Version not found." });

    // Restore v1: the entry carries v1's text again and the restore is v3.
    await db.update(knowledgeEntries).set({ body: "Founded in 2009, we deliver cloud migration and zero-trust security.", tags: ["overview", "corporate", "cyber"] }).where(eq(knowledgeEntries.id, blockA));
    const restored = await restoreEntryVersion({ organizationId: fx.orgA.organizationId, entryId: blockA, version: 1, actor });
    expect(restored).toEqual({ ok: true, version: 3 });
    const [entry] = await db.select({ body: knowledgeEntries.body, tags: knowledgeEntries.tags, score: knowledgeEntries.qualityScore }).from(knowledgeEntries).where(eq(knowledgeEntries.id, blockA));
    expect(entry).toMatchObject({ body: "Founded in 2009, we deliver cloud migration.", tags: ["overview", "corporate"] });
    expect(entry!.score).not.toBeNull();
    const after = await listEntryVersions({ organizationId: fx.orgA.organizationId, entryId: blockA });
    expect(after.map((x) => [x.version, x.changeNote])).toEqual([
      [3, "Restored v1"],
      [2, "Added the zero-trust line"],
      [1, "Before first tracked change"],
    ]);
    expect(after[0]).toMatchObject({ wordsAdded: 0, wordsRemoved: 3 });

    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "knowledge_entry.version.restore")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ restored: 1, version: 3 });
    expect(await restoreEntryVersion({ organizationId: fx.orgA.organizationId, entryId: blockA, version: 9, actor })).toEqual({ ok: false, error: "Version not found." });
  });

  it("lists live boilerplate with its latest version and bumps reuse for the owning tenant only", async () => {
    await recordEntryVersion({
      organizationId: fx.orgA.organizationId,
      entryId: blockA,
      state: { title: `Company overview ${tag}`, body: "Founded in 2009, we deliver cloud migration.", tags: ["overview", "corporate"] },
      previous: null,
      changeNote: "Created",
      actor: { userId: fx.orgA.userId },
    });
    const a = await listContentBlocks({ organizationId: fx.orgA.organizationId });
    expect(a.map((b) => b.id)).toEqual([blockA]);
    expect(a[0]).toMatchObject({ version: 1, reuseCount: 0, tags: ["overview", "corporate"] });
    expect(a.some((b) => b.id === capabilityA || b.id === archivedA || b.id === blockB)).toBe(false);
    const b = await listContentBlocks({ organizationId: fx.orgB.organizationId });
    expect(b.map((x) => [x.id, x.version])).toEqual([[blockB, 0]]);

    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const use = await recordBlockUse({ organizationId: fx.orgA.organizationId, entryId: blockA, proposalId: fx.orgA.proposalId, sectionId: "sec-1", actor });
    expect(use).toEqual({ ok: true, reuseCount: 1 });
    // Not a block, another tenant's block, or another tenant acting: refused, counters untouched.
    expect((await recordBlockUse({ organizationId: fx.orgA.organizationId, entryId: capabilityA, proposalId: fx.orgA.proposalId, sectionId: "s", actor })).ok).toBe(false);
    expect((await recordBlockUse({ organizationId: fx.orgB.organizationId, entryId: blockA, proposalId: fx.orgB.proposalId, sectionId: "s", actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    const [row] = await db.select({ n: knowledgeEntries.reuseCount }).from(knowledgeEntries).where(eq(knowledgeEntries.id, blockA));
    expect(row!.n).toBe(1);
    const [rowB] = await db.select({ n: knowledgeEntries.reuseCount }).from(knowledgeEntries).where(eq(knowledgeEntries.id, blockB));
    expect(rowB!.n).toBe(0);

    const audits = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "knowledge_entry.reuse")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ proposalId: fx.orgA.proposalId, sectionId: "sec-1", via: "content_block" });
  });
});
