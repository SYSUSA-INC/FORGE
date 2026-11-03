/**
 * BL-SCOUT-QUALITY — the scout raises one card per solicitation, never one
 * for a solicitation already in the pipeline, drops finds that only
 * mention a keyword in passing, and scores every waiting find again each
 * run (Postgres, SAM.gov stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, organizations, samNoticeLoadRuns, samNotices, scoutCandidates } from "@/db/schema";
import { runScoutForOrganization, saveScoutProfile } from "@/lib/scout";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const id = (n: number) => (9000 + n).toString(16).padStart(32, "0");
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const LONG = "Operational support services across the enterprise network and its cyberspace environment. ".repeat(12);

const notice = (n: number, title: string, o: Record<string, unknown> = {}) => ({
  noticeId: id(n),
  title,
  solicitationNumber: `SOLQ-${n}`,
  active: "Yes",
  type: "Solicitation",
  postedDate: "2026-10-12",
  naicsCode: "541513",
  responseDeadLine: inDays(30).toISOString(),
  description: `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=${id(n)}`,
  department: "DEPT OF DEFENSE",
  ...o,
});

const SEARCH = [
  // Amendment 0004 of a solicitation waiting as Amendment 0003: replaces it.
  notice(1, "MCCE OSS and Enterprise AI Integration", { solicitationNumber: "M67854-26-I-4208", postedDate: "2026-10-21" }),
  // A new notice of a solicitation already in the pipeline: no find.
  notice(2, "Help desk modernization, Amendment 0002", { solicitationNumber: "36C10B26R0042" }),
  // ServiceNow said once in a long description: a passing mention, dropped.
  notice(3, "Cyberspace operations support"),
  // ServiceNow in the title: a real find.
  notice(4, "ServiceNow ITSM platform support"),
];
const STORED: [number, string][] = [
  [1, "Amendment 04 answers industry questions. ServiceNow is the target platform for the enterprise service desk."],
  [2, "Extends the response date."],
  [3, `${LONG} The government uses ServiceNow for tickets.`],
  [4, "Configure and run the ServiceNow ITSM platform."],
];

describe("BL-SCOUT-QUALITY — one card per solicitation, no passing mentions, scores kept current", () => {
  let fx: TwoTenantFixture;
  const clearCopy = async () => {
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
  };

  beforeEach(async () => {
    fx = await createTwoTenants("scout-quality");
    vi.stubEnv("SAMGOV_API_KEY", "SHAREDKEY0123456789abcdef");
    await clearCopy();
    await db.insert(samNoticeLoadRuns).values({ status: "ok", sourceModifiedAt: new Date(Date.now() - 6 * 3_600_000), newestPostedAt: new Date("2026-10-22T20:00:00Z") });
    await db.insert(samNotices).values(STORED.map(([n, description]) => ({ noticeId: id(n), state: "text", description, postedAt: new Date("2026-10-21T10:00:00Z"), digest: `q${n}` })));
    await db.update(organizations).set({ primaryNaics: "541513", naicsList: [] }).where(eq(organizations.id, fx.orgA.organizationId));
    await saveScoutProfile({ organizationId: fx.orgA.organizationId, patch: { keywords: ["ServiceNow"], extraNaics: [] }, actor: { userId: fx.orgA.userId } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/search")) return new Response("Description Not Found", { status: 404 });
        return new Response(JSON.stringify({ totalRecords: SEARCH.length, opportunitiesData: SEARCH }), { status: 200 });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clearCopy();
    await fx.cleanup();
  });

  it("folds, replaces, skips the pipeline's solicitations, drops passing mentions and re-scores", async () => {
    const org = fx.orgA.organizationId;
    const waiting = (n: number, o: Partial<typeof scoutCandidates.$inferInsert>) => ({
      organizationId: org,
      source: "keyword" as const,
      noticeId: id(n),
      title: `Waiting ${n}`,
      naicsCode: "541513",
      responseDueAt: inDays(20),
      matchedKeyword: "ServiceNow",
      fitScore: 65,
      signals: ["NAICS 541513 is one of your codes", "Matches your keyword: ServiceNow"],
      ...o,
    });
    await db.insert(scoutCandidates).values([
      // Two waiting cards of one solicitation (Amendments 02 and 03): fold to the latest.
      waiting(50, { solicitationNumber: "M67854-26-I-4208", postedAt: new Date("2026-10-01"), title: "MCCE RFI, Amendment 02", description: "ServiceNow service desk." }),
      waiting(51, { solicitationNumber: "M67854-26-I-4208", postedAt: new Date("2026-10-10"), title: "MCCE RFI, Amendment 03", description: "ServiceNow service desk, due date moved." }),
      // An old score from the old formula, due in two days: re-scored.
      waiting(52, { solicitationNumber: "SOLQ-52", title: "ServiceNow licensing", description: "Licenses.", responseDueAt: inDays(2) }),
      // Waiting, but only a passing mention in a long text: removed.
      waiting(53, { solicitationNumber: "SOLQ-53", title: "Network operations", description: `${LONG} ServiceNow is used.` }),
    ]);
    await db.insert(opportunities).values({ organizationId: org, title: "Help desk modernization", solicitationNumber: "36C10B26R0042", stage: "identified" });

    const r = await runScoutForOrganization({ organizationId: org, trigger: "manual" });
    expect(r.errors).toBe(0);

    const rows = await db
      .select({ noticeId: scoutCandidates.noticeId, title: scoutCandidates.title, fitScore: scoutCandidates.fitScore, signals: scoutCandidates.signals, number: scoutCandidates.solicitationNumber })
      .from(scoutCandidates)
      .where(and(eq(scoutCandidates.organizationId, org), eq(scoutCandidates.status, "new")));
    const byNumber = (n: string) => rows.filter((x) => x.number === n);

    // One card for the MCCE solicitation, now Amendment 04's notice.
    const mcce = byNumber("M67854-26-I-4208");
    expect(mcce).toHaveLength(1);
    expect(mcce[0]!.noticeId).toBe(id(1));
    // Nothing for the solicitation already in the pipeline.
    expect(byNumber("36C10B26R0042")).toHaveLength(0);
    // The passing mentions are gone, new and waiting alike; the title match stays.
    expect(byNumber("SOLQ-3")).toHaveLength(0);
    expect(byNumber("SOLQ-53")).toHaveLength(0);
    expect(byNumber("SOLQ-4")).toHaveLength(1);
    // The old score is recomputed with the new rules and the near deadline.
    const lic = byNumber("SOLQ-52")[0]!;
    expect(lic.signals).toContain("Your keyword ServiceNow is in the title");
    expect(lic.signals).toContain("Due in 2 days");
    expect(lic.fitScore).toBe(25 + 30 - 20);
    // Another tenant's finds are untouched by this run.
    const other = await db.select({ id: scoutCandidates.id }).from(scoutCandidates).where(eq(scoutCandidates.organizationId, fx.orgB.organizationId));
    expect(other).toHaveLength(0);
  });
});
