/**
 * BL-STAB-7a — how FORGE talks to SAM.gov, with fetch stubbed: the
 * owner's 401 page comes back as a plain message; the key is sent only to
 * SAM.gov hosts and never appears in an error; SAM.gov's own attachment
 * links keep their placeholder; every call has a deadline; description
 * lookups stop after a rejected key or when their budget runs out; the
 * credential never prints its key.
 */
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSamResource, fetchSamNotice, searchSamGovOpportunities } from "@/lib/samgov";
import { SamCredential, platformSamCredential } from "@/lib/samgov-key";

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
const op = (i: number, description: string) => ({ noticeId: `N${i}`, title: `Notice ${i}`, active: "Yes", description });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("BL-STAB-7a — SAM.gov transport", () => {
  it("turns the owner's 401 page into the plain message, with the status and class", async () => {
    const calls = stubFetch(() => new Response(OWNER_BODY, { status: 401 }));
    const r = await searchSamGovOpportunities(cred, { keyword: "cyber" });
    expect(r).toEqual({
      ok: false,
      cls: "key_invalid",
      status: 401,
      error: "SAM.gov rejected FORGE's shared SAM.gov key: it is invalid or has expired. This has been logged for FORGE support; try again later. (SAM.gov API_KEY_INVALID, HTTP 401)",
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
    const calls = stubFetch((url) =>
      url.pathname.endsWith("/search") ? json({ totalRecords: 4, opportunitiesData: foreign.map((d, i) => op(i, d)) }) : json({ description: "leaked" }),
    );
    const r = await searchSamGovOpportunities(cred, { naicsCodes: ["541512"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.opportunities.map((o) => o.description)).toEqual(["", "", "", ""]);
    expect(calls).toHaveLength(1);
  });

  it("stops description lookups after a rejected key instead of trying every one", async () => {
    const ops = Array.from({ length: 20 }, (_, i) => op(i, `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=N${i}`));
    const calls = stubFetch((url) =>
      url.pathname.endsWith("/search") ? json({ totalRecords: 20, opportunitiesData: ops }) : new Response(OWNER_BODY, { status: 401 }),
    );
    const r = await searchSamGovOpportunities(cred, { naicsCodes: ["541512"] });
    expect(r.ok).toBe(true);
    const descCalls = calls.filter((c) => c.url.includes("noticedesc"));
    // At most the four already in flight when the first 401 lands.
    expect(descCalls.length).toBeLessThanOrEqual(4);
    if (r.ok) expect(r.opportunities.every((o) => o.description === "")).toBe(true);
  });

  it("stops description lookups when their time budget runs out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ops = Array.from({ length: 12 }, (_, i) => op(i, `https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=N${i}`));
    const calls = stubFetch((url) => {
      if (url.pathname.endsWith("/search")) return json({ totalRecords: 12, opportunitiesData: ops });
      vi.setSystemTime(Date.now() + 15_000); // each lookup "takes" 15 s
      return json({ description: "text" });
    });
    const r = await searchSamGovOpportunities(cred, { naicsCodes: ["541512"] });
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.url.includes("noticedesc")).length).toBeLessThan(12);
    if (r.ok) expect(r.opportunities.filter((o) => o.description === "").length).toBeGreaterThan(0);
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

  it("marks a gone attachment permanent and a server error retryable", async () => {
    stubFetch((url) => new Response("", { status: url.pathname.includes("gone") ? 404 : 503 }));
    const gone = await downloadSamResource(cred, "https://sam.gov/files/gone/download", 1024);
    expect(gone).toMatchObject({ ok: false, cls: "not_found", permanent: true, error: "This attachment is no longer on SAM.gov (HTTP 404)." });
    const busy = await downloadSamResource(cred, "https://sam.gov/files/busy/download", 1024);
    expect(busy).toMatchObject({ ok: false, cls: "upstream", permanent: false });
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
