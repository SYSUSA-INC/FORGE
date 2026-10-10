/**
 * BL-STAB-7a — how FORGE talks to SAM.gov (fetch stubbed): plain messages,
 * the key only to SAM.gov hosts and never in an error, deadlines, and
 * description lookups that stop after a rejection or their budget.
 */
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSamResource, fetchSamNotice, fetchSamOpportunities, readNoticeDescriptions } from "@/lib/samgov";
import { SamCredential, platformSamCredential } from "@/lib/samgov-key";
import { OPEN_NOTICE_TYPES } from "@/lib/samgov-match";
import { findSamOpportunities } from "@/lib/samgov-search";

const KEY = "SECRETKEY0123456789abcd";
const cred = new SamCredential(KEY, { source: "platform", audience: "tenant", organizationId: null });
const OWNER_BODY = "<html><body><h1>API_KEY_INVALID</h1></body></html>";

type Call = { url: string; init: RequestInit };
function stubFetch(answer: (url: URL) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url: url.toString(), init });
      return answer(url);
    }),
  );
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const op = (i: number, description: string) => ({ noticeId: `N${i}`, title: `Notice ${i}`, active: "Yes", type: "Solicitation", description });
const descLink = (i: number) => `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=N${i}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("BL-STAB-7a — SAM.gov transport", () => {
  it("turns the owner's 401 page into the plain message, with the status and class", async () => {
    const calls = stubFetch(() => new Response(OWNER_BODY, { status: 401 }));
    const r = await fetchSamOpportunities(cred, { naicsCodes: ["541512"] });
    expect(r).toEqual({
      ok: false,
      cls: "key_invalid",
      status: 401,
      error: "SAM.gov rejected FORGE's shared SAM.gov key. This has been logged for FORGE support. To keep working now, a company admin can set your company's own key under Settings → Integrations. (SAM.gov API_KEY_INVALID, HTTP 401)",
    });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).hostname).toBe("api.sam.gov");
    expect(new URL(calls[0]!.url).searchParams.get("api_key")).toBe(KEY);
    expect(calls[0]!.init.cache).toBe("no-store");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect((calls[0]!.init.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("never fetches a description link off SAM.gov, and blanks it", async () => {
    const foreign = [
      "https://evil.example/d",
      "http://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=1",
      "https://api.sam.gov.evil.example/d",
      "https://api.sam.gov@evil.example/d",
    ];
    const calls = stubFetch(() => json({ description: "leaked" }));
    const read = await readNoticeDescriptions(cred, foreign.map((d, i) => op(i, d)), 10);
    expect([...read.values()]).toEqual(foreign.map(() => ({ unread: true })));
    expect(calls).toHaveLength(0);
  });

  it("stops description lookups after a rejected key instead of trying every one", async () => {
    const calls = stubFetch(() => new Response(OWNER_BODY, { status: 401 }));
    const read = await readNoticeDescriptions(cred, Array.from({ length: 20 }, (_, i) => op(i, descLink(i))), 20);
    // At most the four already in flight when the first 401 lands.
    expect(calls.length).toBeLessThanOrEqual(4);
    expect([...read.values()].every((d) => "unread" in d)).toBe(true);
  });

  it("stops description lookups when their time budget runs out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const calls = stubFetch(() => {
      vi.setSystemTime(Date.now() + 15_000); // each lookup "takes" 15 s
      return json({ description: "text" });
    });
    const read = await readNoticeDescriptions(cred, Array.from({ length: 12 }, (_, i) => op(i, descLink(i))), 12);
    expect(calls.length).toBeLessThan(12);
    expect([...read.values()].filter((d) => "unread" in d).length).toBeGreaterThan(0);
  });

  it("BL-STAB-10 — asks SAM.gov per NAICS code, never with `q`, and keeps only active notices", async () => {
    const calls = stubFetch((url) =>
      json({ totalRecords: 2, opportunitiesData: [op(Number(url.searchParams.get("ncode")), "x"), { ...op(9, "x"), active: "No" }] }),
    );
    const r = await fetchSamOpportunities(cred, { naicsCodes: ["541512", " 541519 ", "541512"], title: "ServiceNow" });
    expect(calls.map((c) => new URL(c.url).searchParams.get("ncode")).sort()).toEqual(["541512", "541519"]);
    for (const c of calls) {
      const p = new URL(c.url).searchParams;
      expect(p.has("q")).toBe(false);
      expect([p.get("limit"), p.get("title")]).toEqual(["1000", "ServiceNow"]);
    }
    expect(r).toMatchObject({ ok: true, samTotal: 4, received: 4, failedCodes: [] });
    if (r.ok) expect(r.rows.map((o) => o.noticeId).sort()).toEqual(["N541512", "N541519"]);
  });

  it("BL-STAB-10 — reads descriptions only when the title doesn't decide, within the key's budget", async () => {
    const rows = [{ ...op(1, descLink(1)), title: "ServiceNow licenses" }, ...Array.from({ length: 14 }, (_, i) => op(i + 2, descLink(i + 2)))];
    const calls = stubFetch((url) => (url.pathname.endsWith("/search") ? json({ totalRecords: 15, opportunitiesData: rows }) : json({ description: "IT services" })));
    const company = new SamCredential(KEY, { source: "company", audience: "tenant", organizationId: "org" });
    const r = await findSamOpportunities(company, { naicsCodes: ["541519"], keyword: "ServiceNow", noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30 });
    expect(calls.filter((c) => c.url.includes("noticedesc"))).toHaveLength(10);
    // With codes, SAM.gov's title filter isn't used (it would hide description matches).
    expect(new URL(calls[0]!.url).searchParams.has("title")).toBe(false);
    expect(r).toMatchObject({ ok: true, counts: { matched: 1, notMentioned: 10, unchecked: 4 } });
    if (r.ok) expect(r.notices.map((n) => [n.noticeId, n.match?.status])).toEqual([["N1", "match"]]);

    // No keyword: no description reads at all.
    const browse = stubFetch(() => json({ totalRecords: 15, opportunitiesData: rows }));
    expect(await findSamOpportunities(cred, { naicsCodes: ["541519"], noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30 })).toMatchObject({ ok: true, counts: { matched: 15 } });
    expect(browse).toHaveLength(1);
  });

  it("BL-STAB-10 — a notice whose description wasn't read is never a match; one SAM.gov has no description for is checked", async () => {
    const ops = [1, 2, 3].map((i) => ({ ...op(i, descLink(i)), title: "Help desk" }));
    stubFetch((url) => (url.pathname.endsWith("/search") ? json({ totalRecords: 3, opportunitiesData: ops }) : new Response(OWNER_BODY, { status: 401 })));
    const r = await findSamOpportunities(cred, { naicsCodes: ["541519"], keyword: "cyber", noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30 });
    expect(r).toMatchObject({ ok: true, notices: [], counts: { matched: 0, unchecked: 3 } });
    if (r.ok) expect(r.unchecked.map((o) => o.description)).toEqual(["", "", ""]);

    stubFetch((url) => (url.pathname.endsWith("/search") ? json({ totalRecords: 3, opportunitiesData: ops }) : new Response("Description Not Found", { status: 404 })));
    expect(await findSamOpportunities(cred, { naicsCodes: ["541519"], keyword: "cyber", noticeTypes: OPEN_NOTICE_TYPES, postedDaysBack: 30 })).toMatchObject({
      ok: true,
      notices: [],
      unchecked: [],
      counts: { noDescription: 3, unchecked: 0 },
    });
  });

  it("keeps SAM.gov's own placeholder on an attachment link and refuses foreign links without a fetch", async () => {
    const calls = stubFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-disposition": 'attachment; filename="QA.pdf"' } }));
    const link = "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/abc/download?api_key=null&token=";
    const dl = await downloadSamResource(cred, link, 1024);
    expect(dl).toMatchObject({ ok: true, fileName: "QA.pdf" });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get("api_key")).toBe("null");

    const bare = await downloadSamResource(cred, "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/def/download", 1024);
    expect(bare.ok).toBe(true);
    expect(new URL(calls[1]!.url).searchParams.get("api_key")).toBe(KEY);

    for (const bad of ["https://evil.example/file.pdf", "not a url"]) {
      const r = await downloadSamResource(cred, bad, 1024);
      expect(r).toMatchObject({ ok: false, cls: "foreign_host", permanent: true, error: "Skipped an attachment link that isn't on sam.gov." });
    }
    expect(calls).toHaveLength(2);
  });

  it("redacts the key from SAM.gov's reply before trimming it", async () => {
    stubFetch(() => json({ detail: `${"x".repeat(170)} key ${KEY} is not valid here` }, 400));
    const r = await fetchSamNotice(cred, "N1");
    expect(r).toMatchObject({ ok: false, cls: "bad_request" });
    if (!r.ok) expect(r.error).not.toContain(KEY.slice(0, 8));
  });

  it("restricted and gone files are skipped for good; a server error is retried", async () => {
    stubFetch((url) => new Response("", { status: url.pathname.includes("cui") ? 403 : url.pathname.includes("gone") ? 404 : 503 }));
    // 403 on SAM.gov's own placeholder link: FORGE's key wasn't sent, so it isn't a key problem.
    expect(await downloadSamResource(cred, "https://sam.gov/files/cui/download?api_key=null&token=", 1024)).toMatchObject({ ok: false, cls: "restricted", permanent: true });
    expect(await downloadSamResource(cred, "https://sam.gov/files/gone/download", 1024)).toMatchObject({
      ok: false,
      cls: "not_found",
      permanent: true,
      error: "This attachment is no longer on SAM.gov (HTTP 404).",
    });
    expect(await downloadSamResource(cred, "https://sam.gov/files/busy/download", 1024)).toMatchObject({ ok: false, cls: "upstream", permanent: false });
  });

  it("never returns a thrown message (it can carry the URL and its key)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError(`Failed to parse URL from https://api.sam.gov/x?api_key=${KEY}`);
    }));
    const r = await fetchSamNotice(cred, "N1");
    expect(r).toMatchObject({ ok: false, cls: "network", error: "FORGE couldn't reach SAM.gov. Try again in a few minutes." });
    if (!r.ok) {
      expect(r.error).not.toContain(KEY);
      expect(r.error).not.toContain("api_key");
    }
  });

  it("treats a reply that isn't JSON as unreadable, and an empty search as no such notice", async () => {
    stubFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
    expect(await fetchSamNotice(cred, "N1")).toMatchObject({ ok: false, cls: "bad_response" });
    stubFetch(() => json({ totalRecords: 0, opportunitiesData: [] }));
    expect(await fetchSamNotice(cred, "N1")).toMatchObject({ ok: false, cls: "not_found", noSuchNotice: true });
  });

  it("never prints the key", () => {
    for (const shown of [JSON.stringify(cred), String(cred), inspect(cred), `${cred}`]) {
      expect(shown).not.toContain(KEY);
      expect(shown).toContain("abcd");
    }
    vi.stubEnv("SAMGOV_API_KEY", "  ");
    expect(platformSamCredential()).toBeNull();
    vi.stubEnv("SAMGOV_API_KEY", ` ${KEY} `);
    expect(platformSamCredential()?.revealForSamRequest()).toBe(KEY);
  });
});
