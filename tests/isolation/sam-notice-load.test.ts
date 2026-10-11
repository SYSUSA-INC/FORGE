/**
 * BL-STAB-10b — the nightly load of SAM.gov's public notice file into
 * FORGE's copy, against Postgres with the download stubbed: only the fixed
 * public URL is fetched, with no key; an unchanged file costs a 304 and no
 * writes; changed rows are rewritten, missing ones marked gone (and purged
 * after 30 days), returning ones restored; a cut or malformed file marks
 * nothing gone and isn't remembered as loaded; the switch pauses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { platformSettings, samNoticeLoadRuns, samNotices } from "@/db/schema";
import { SAM_NOTICE_FILE, runSamNoticeLoad } from "@/lib/sam-notice-load";
import { GET as cronGet } from "@/app/api/cron/sam-notices/route";

const id = (n: number) => n.toString(16).padStart(32, "0");
const HEADER = '"NoticeId","Title","PostedDate","Active","Description"';
const line = (n: number, description: string) => `"${id(n)}","Notice ${n}","2026-10-0${n}","Yes","${description}"`;
const file = (rows: string[]) => Buffer.from([HEADER, ...rows].join("\r\n"), "latin1");

type Call = { url: string; init: RequestInit };
function stub(answer: (init: RequestInit) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return answer(init);
    }),
  );
  return calls;
}
const ok = (body: Buffer, etag: string) =>
  new Response(new Uint8Array(body), { status: 200, headers: { etag, "content-length": String(body.length), "last-modified": new Date().toUTCString() } });
const stored = async () =>
  Object.fromEntries((await db.select().from(samNotices)).map((r) => [r.noticeId, [r.state, r.description, r.goneOn !== null]]));

describe("BL-STAB-10b — the nightly copy of SAM.gov's notice descriptions", () => {
  const clear = async () => {
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    await db.delete(platformSettings).where(eq(platformSettings.key, "sam_notice.load"));
  };
  beforeEach(clear);
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await clear();
  });

  it("loads the public file (no key), skips an unchanged one, and keeps the copy in step", async () => {
    const first = file([line(1, "ServiceNow ITSM"), line(2, ""), line(3, "Help desk")]);
    let calls = stub(() => ok(first, '"v1"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "ok", rowsSeen: 3, rowsWritten: 3, rowsGone: 0 });
    expect(calls.map((c) => c.url)).toEqual([SAM_NOTICE_FILE]);
    expect(JSON.stringify(calls[0]!.init.headers)).not.toMatch(/api_key|x-api-key/i);
    expect(await stored()).toEqual({ [id(1)]: ["text", "ServiceNow ITSM", false], [id(2)]: ["none", null, false], [id(3)]: ["text", "Help desk", false] });

    calls = stub(() => new Response(null, { status: 304 }));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "unchanged", rowsWritten: 0 });
    expect((calls[0]!.init.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');

    // 1 changed, 2 left the file, 4 is new: only those are written.
    stub(() => ok(file([line(1, "ServiceNow ITSM and ITOM"), line(3, "Help desk"), line(4, "Zero trust")]), '"v2"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "ok", rowsWritten: 2, rowsGone: 1 });
    expect(await stored()).toMatchObject({ [id(1)]: ["text", "ServiceNow ITSM and ITOM", false], [id(2)]: ["none", null, true], [id(4)]: ["text", "Zero trust", false] });

    // 2 comes back; 3 has been gone for 40 days and is purged.
    await db.update(samNotices).set({ goneOn: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10) }).where(eq(samNotices.noticeId, id(3)));
    stub(() => ok(file([line(1, "ServiceNow ITSM and ITOM"), line(2, ""), line(4, "Zero trust")]), '"v3"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "ok", rowsPurged: 1 });
    expect(Object.keys(await stored()).sort()).toEqual([id(1), id(2), id(4)]);
    expect((await stored())[id(2)]![2]).toBe(false);
  });

  it("a cut or malformed file marks nothing gone and isn't remembered as loaded", async () => {
    stub(() => ok(file([line(1, "One"), line(2, "Two")]), '"v1"'));
    await runSamNoticeLoad({ minRows: 1 });

    // Cut inside a quoted field: partial, nothing marked gone, and the next run downloads again.
    const cut = file([line(1, "One")]).toString("latin1") + '\r\n"' + id(5) + '","Notice 5","2026-10-05","Yes","Unfinished';
    stub(() => ok(Buffer.from(cut, "latin1"), '"v2"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "partial", rowsGone: 0 });
    expect((await stored())[id(2)]![2]).toBe(false);
    const calls = stub(() => new Response(null, { status: 304 }));
    await runSamNoticeLoad({ minRows: 1 });
    expect((calls[0]!.init.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');

    // Too few rows for a whole file: also partial. A renamed column: rejected, nothing written.
    stub(() => ok(file([line(1, "One")]), '"v3"'));
    expect(await runSamNoticeLoad({ minRows: 30_000 })).toMatchObject({ status: "partial", rowsGone: 0 });
    stub(() => ok(Buffer.from('"Id","Title"\r\n"x","y"', "latin1"), '"v4"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "rejected", rowsWritten: 0, error: "SAM.gov's notice file is missing the column(s) NoticeId, PostedDate, Active, Description" });
  });

  it("the switch pauses the load, and the cron route needs CRON_SECRET", async () => {
    await db.insert(platformSettings).values({ key: "sam_notice.load", value: "off" });
    const calls = stub(() => ok(file([line(1, "One")]), '"v1"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "paused" });
    expect(calls).toHaveLength(0);

    vi.stubEnv("CRON_SECRET", "");
    expect((await cronGet(new NextRequest("http://localhost/api/cron/sam-notices"))).status).toBe(500);
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cronGet(new NextRequest("http://localhost/api/cron/sam-notices", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
