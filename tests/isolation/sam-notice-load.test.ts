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
import { log } from "@/lib/log";
import { SAM_NOTICE_FILE, runSamNoticeLoad } from "@/lib/sam-notice-load";
import { GET as cronGet } from "@/app/api/cron/sam-notices/route";

const id = (n: number) => n.toString(16).padStart(32, "0");
const HEADER = '"NoticeId","Title","PostedDate","Active","Description"';
const line = (n: number, description: string, active = "Yes") => `"${id(n)}","Notice ${n}","2026-10-0${n % 9 || 1} 10:00:00","${active}","${description}"`;
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
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    // The half-read last row is never stored as if it were whole.
    expect((await stored())[id(5)]).toBeUndefined();
    // A body shorter than its Content-Length: the same, and it reaches /admin/errors.
    const errors = vi.spyOn(log, "error");
    const short = file([line(1, "One changed"), line(2, "Two")]);
    stub(() => new Response(new Uint8Array(short), { status: 200, headers: { etag: '"v2b"', "content-length": String(short.length + 10) } }));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "partial", rowsGone: 0 });
    // Rows that arrived whole are kept; nothing is marked gone.
    expect([(await stored())[id(1)]![1], (await stored())[id(2)]![2]]).toEqual(["One changed", false]);
    expect(errors.mock.calls.some(([, msg]) => /looked incomplete/.test(String(msg)))).toBe(true);
    const calls = stub(() => new Response(null, { status: 304 }));
    await runSamNoticeLoad({ minRows: 1 });
    expect((calls[0]!.init.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');

    // Too few rows for a whole file: also partial. A renamed column: rejected, nothing written.
    stub(() => ok(file([line(1, "One")]), '"v3"'));
    expect(await runSamNoticeLoad({ minRows: 30_000 })).toMatchObject({ status: "partial", rowsGone: 0 });
    stub(() => ok(Buffer.from('"Id","Title"\r\n"x","y"', "latin1"), '"v4"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "rejected", rowsWritten: 0, error: "SAM.gov's notice file is missing the column(s) NoticeId, PostedDate, Active, Description" });
    // One renamed column is named as the one missing.
    stub(() => ok(Buffer.from(`${HEADER.replace("Description", "Desc")}\r\n${line(1, "One")}`, "latin1"), '"v5"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "rejected", error: "SAM.gov's notice file is missing the column(s) Description" });
  });

  it("a malformed row isn't marked gone; inactive rows aren't stored; a 29-day gone row is kept; the time limit resumes next run", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => line(i + 1, `Text ${i + 1}`));
    stub(() => ok(file(rows), '"v1"'));
    await runSamNoticeLoad({ minRows: 1 });
    // Notice 2 has an extra field tonight (1 of 150, under 1%); notice 151 is inactive.
    const tonight = [...rows];
    tonight[1] = `${line(2, "Text 2")},"extra"`;
    await db.update(samNotices).set({ goneOn: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10) }).where(eq(samNotices.noticeId, id(150)));
    stub(() => ok(file([...tonight.slice(0, 149), line(151, "Old", "No")]), '"v2"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "ok", rowsSkipped: 1, rowsGone: 0, rowsPurged: 0 });
    const now = await stored();
    expect([now[id(2)]![2], now[id(151)], now[id(150)]![2]]).toEqual([false, undefined, true]);

    // The 250 s limit stops between chunks: partial, nothing marked gone; the next run finishes.
    await db.delete(samNotices);
    await db.delete(samNoticeLoadRuns);
    vi.useFakeTimers({ toFake: ["Date"] });
    const body = file(rows);
    const half = Math.floor(body.length / 2);
    stub(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new Uint8Array(body.subarray(0, half)));
              vi.setSystemTime(Date.now() + 260_000);
              c.enqueue(new Uint8Array(body.subarray(half)));
              c.close();
            },
          }),
          { status: 200, headers: { etag: '"v3"', "content-length": String(body.length) } },
        ),
    );
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "partial", rowsGone: 0 });
    vi.useRealTimers();
    stub(() => ok(body, '"v3"'));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "ok" });
    expect(Object.keys(await stored())).toHaveLength(150);
  });

  it("every 304 still asks with the last good etag, keeps the newest date, and flags a file that stopped changing", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toUTCString();
    const body = file([line(1, "One")]);
    stub(() => new Response(new Uint8Array(body), { status: 200, headers: { etag: '"v1"', "content-length": String(body.length), "last-modified": old } }));
    await runSamNoticeLoad({ minRows: 1 });
    const errors = vi.spyOn(log, "error");
    for (let i = 0; i < 2; i++) {
      const calls = stub(() => new Response(null, { status: 304 }));
      expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "unchanged" });
      expect((calls[0]!.init.headers as Record<string, string>)["if-none-match"]).toBe('"v1"');
    }
    expect(errors.mock.calls.filter(([, msg]) => msg === "file is stale")).toHaveLength(2);
    const runs = await db.select({ status: samNoticeLoadRuns.status, newest: samNoticeLoadRuns.newestPostedAt }).from(samNoticeLoadRuns);
    expect(runs.filter((r) => r.status === "unchanged").every((r) => r.newest?.toISOString() === "2026-10-01T10:00:00.000Z")).toBe(true);
    // A refused download fails the run and reaches /admin/errors.
    stub(() => new Response("no", { status: 503 }));
    expect(await runSamNoticeLoad({ minRows: 1 })).toMatchObject({ status: "failed", error: "SAM.gov's notice file answered HTTP 503" });
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
