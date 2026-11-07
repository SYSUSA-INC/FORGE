/**
 * BL-OPP-SOURCE — migration 0155's backfill against Postgres: an existing
 * SAM.gov opportunity gets its notice's page, a Scout find from a portal
 * email its link, an eBuy paste its first link, a document its source;
 * a source someone already set is never overwritten, and running the
 * migration again changes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityActivities, scoutCandidates } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const MIGRATION = readFileSync(join(process.cwd(), "drizzle/0155_opportunity_source.sql"), "utf8");

async function runMigration() {
  for (const stmt of MIGRATION.split("--> statement-breakpoint")) {
    const body = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (body) await db.execute(sql.raw(body));
  }
}

describe("BL-OPP-SOURCE — migration 0155 backfill", () => {
  let fx: TwoTenantFixture;
  let ids: string[] = [];

  beforeEach(async () => {
    fx = await createTwoTenants("opp-source");
    const org = fx.orgA.organizationId;
    const rows = await db
      .insert(opportunities)
      .values([
        { organizationId: org, title: "From SAM", noticeId: "0a1b2c3d4e5f" },
        { organizationId: org, title: "From portal email" },
        { organizationId: org, title: "From eBuy" },
        { organizationId: org, title: "From a document" },
        { organizationId: org, title: "Set by hand", noticeId: "9z8y7x6w5v4u", source: "state", sourceUrl: "https://bids.state.va.us/1" },
      ])
      .returning({ id: opportunities.id });
    ids = rows.map((r) => r.id);
    const [, portal, ebuy, doc] = ids as [string, string, string, string, string];
    await db.insert(scoutCandidates).values({ organizationId: org, source: "portal_email", noticeId: "email:x", title: "From portal email", uiLink: "https://bids.county.gov/rfp/9", status: "imported", opportunityId: portal });
    await db.insert(opportunityActivities).values([
      { opportunityId: ebuy, kind: "note", title: "Created from eBuy paste", body: "RFQ1234567 https://www.ebuy.gsa.gov/ebuy/seller/RFQ1234567 due soon", metadata: { source: "ebuy-paste" } },
      { opportunityId: doc, kind: "note", title: "Created from a document", body: "" },
    ]);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("fills in what FORGE already knows, keeps what was set, and is idempotent", async () => {
    await runMigration();
    await runMigration();
    const rows = await db.select({ title: opportunities.title, source: opportunities.source, url: opportunities.sourceUrl }).from(opportunities).where(inArray(opportunities.id, ids));
    const by = Object.fromEntries(rows.map((r) => [r.title, [r.source, r.url]]));
    expect(by).toEqual({
      "From SAM": ["samgov", "https://sam.gov/opp/0a1b2c3d4e5f/view"],
      "From portal email": ["portal_email", "https://bids.county.gov/rfp/9"],
      "From eBuy": ["gsa_ebuy", "https://www.ebuy.gsa.gov/ebuy/seller/RFQ1234567"],
      "From a document": ["document", ""],
      "Set by hand": ["state", "https://bids.state.va.us/1"],
    });
    // The other tenant's opportunity is untouched by these rows.
    const [theirs] = await db.select({ source: opportunities.source }).from(opportunities).where(eq(opportunities.id, fx.orgB.opportunityId));
    expect(theirs!.source).toBe("manual");
  });
});
