/**
 * BL-STAB-2 — the R2 adapter against a mocked fetch: size, type and
 * entity tag without a download, ranged reads, deletes, presigned links,
 * and a deadline that also covers reading a large body. The memory
 * fallback shares one cache across module copies. Pure: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { MemoryStorage, R2Storage, storageTimeoutMs } from "@/lib/storage";

type Call = { url: string; init: RequestInit };

function r2(): R2Storage {
  return new R2Storage("acct", "bucket", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
}

describe("R2Storage", () => {
  let calls: Call[] = [];
  let respond: (call: Call) => Response | Promise<Response>;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.UPLOAD_SIGN_CONTENT_LENGTH;
  });

  it("head reads size, type and entity tag; a missing object is null", async () => {
    respond = () => new Response(null, { status: 200, headers: { "content-length": "1048576", "content-type": "application/pdf", etag: '"abc123"' } });
    expect(await r2().head("org/1/uploads/x")).toEqual({ byteSize: 1048576, contentType: "application/pdf", etag: "abc123" });
    expect(calls[0]!.init.method).toBe("HEAD");
    expect(calls[0]!.url).toBe("https://acct.r2.cloudflarestorage.com/bucket/org/1/uploads/x");
    respond = () => new Response(null, { status: 404 });
    expect(await r2().head("org/1/uploads/missing")).toBeNull();
  });

  it("getRange signs a range header, accepts 206, and trims a whole-object 200", async () => {
    respond = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 206 });
    const part = await r2().getRange("k", 0, 3);
    expect(Array.from(part!)).toEqual([1, 2, 3, 4]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.range).toBe("bytes=0-3");
    expect(headers.authorization).toContain("range");
    respond = () => new Response(new Uint8Array([9, 8, 7, 6, 5]), { status: 200 });
    expect(Array.from((await r2().getRange("k", 1, 2))!)).toEqual([8, 7]);
  });

  it("delete treats 204 and 404 as done and throws on anything else", async () => {
    respond = () => new Response(null, { status: 204 });
    await expect(r2().delete("k")).resolves.toBeUndefined();
    respond = () => new Response(null, { status: 404 });
    await expect(r2().delete("k")).resolves.toBeUndefined();
    respond = () => new Response("denied", { status: 403 });
    await expect(r2().delete("k")).rejects.toThrow(/403/);
  });

  it("get carries the entity tag and gives up on a body that stalls past its deadline", async () => {
    respond = () => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "content-type": "text/plain", etag: '"e1"', "content-length": "2" } });
    expect(await r2().get("k")).toMatchObject({ contentType: "text/plain", etag: "e1" });

    vi.useFakeTimers();
    respond = (call) =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({ "content-length": String(10 * 1024 * 1024) }),
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_, reject) => {
            call.init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      }) as unknown as Response;
    const pending = r2().get("big").catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(storageTimeoutMs(10 * 1024 * 1024) + 10);
    expect(await pending).toBe("aborted");
  });

  it("a presigned upload link signs the type and size; the browser is told to send only the type", () => {
    const link = r2().presignPut({ key: "org/1/uploads/x", contentType: "application/pdf", byteSize: 5, expiresSeconds: 900 });
    expect(link.headers).toEqual({ "content-type": "application/pdf" });
    expect(link.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
    process.env.UPLOAD_SIGN_CONTENT_LENGTH = "0";
    expect(r2().presignPut({ key: "k", contentType: "text/plain", byteSize: 5, expiresSeconds: 60 }).url).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
  });

  it("storageTimeoutMs grows with size and is capped", () => {
    expect(storageTimeoutMs(0)).toBe(30_000);
    expect(storageTimeoutMs(10 * 1024 * 1024)).toBe(50_000);
    expect(storageTimeoutMs(10 * 1024 * 1024 * 1024)).toBe(240_000);
  });
});

describe("MemoryStorage", () => {
  it("shares one cache across instances (module copies), with an MD5 entity tag and ranges", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const put = await new MemoryStorage().put({ key: "tmp/x", bytes, contentType: "text/plain" });
    expect(put.etag).toBe(createHash("md5").update(bytes).digest("hex"));
    const other = new MemoryStorage();
    expect(await other.head("tmp/x")).toEqual({ byteSize: 11, contentType: "text/plain", etag: put.etag });
    expect(new TextDecoder().decode((await other.getRange("tmp/x", 0, 4))!)).toBe("hello");
    expect(other.presignPut()).toBeNull();
    await other.delete("tmp/x");
    expect(await new MemoryStorage().get("tmp/x")).toBeNull();
  });
});
