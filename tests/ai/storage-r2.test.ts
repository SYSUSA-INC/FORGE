/**
 * BL-STAB-2 — the R2 adapter against a mocked fetch: size, type and
 * entity tag without a download, ranged reads, deletes, presigned links,
 * and a deadline that also covers reading a large body. The memory
 * fallback shares one cache across module copies. Pure: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { MemoryStorage, R2Storage, storageTimeoutMs } from "@/lib/storage";

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;

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

  it("asks for the bytes as stored on every request, without signing that header", async () => {
    respond = () => new Response(null, { status: 200, headers: { "content-length": "5" } });
    await r2().head("k");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["accept-encoding"]).toBe("identity");
    expect(headers.authorization).not.toContain("accept-encoding");
  });

  it("head never reads a missing or re-encoded length as 0: it asks for the size with a one-byte range", async () => {
    // Cloudflare compressed the answer: no length (or the compressed one), so it can't be the size.
    const answers: Record<string, string>[] = [{ "content-type": "text/plain" }, { "content-type": "text/plain", "content-encoding": "gzip", "content-length": "29" }];
    for (const headers of answers) {
      calls = [];
      respond = (call) =>
        call.init.method === "HEAD"
          ? new Response(null, { status: 200, headers: { ...headers, etag: 'W/"e1"' } })
          : new Response(new Uint8Array([0x61]), { status: 206, headers: { "content-range": "bytes 0-0/1024" } });
      expect(await r2().head("k")).toEqual({ byteSize: 1024, contentType: "text/plain", etag: "e1" });
      expect((calls[1]!.init.headers as Record<string, string>).range).toBe("bytes=0-0");
    }
    // An empty object answers the range with 416 and its size.
    respond = (call) => (call.init.method === "HEAD" ? new Response(null, { status: 200 }) : new Response(null, { status: 416, headers: { "content-range": "bytes */0" } }));
    expect((await r2().head("empty"))!.byteSize).toBe(0);
    // No size anywhere: an error, never a guess.
    respond = (call) => (call.init.method === "HEAD" ? new Response(null, { status: 200 }) : new Response("x", { status: 200 }));
    await expect(r2().head("k")).rejects.toThrow(/didn't report the size/);
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

  it("storageTimeoutMs grows with size and is capped; an unknown size gets the longest deadline", () => {
    expect(storageTimeoutMs(0)).toBe(30_000);
    expect(storageTimeoutMs(10 * 1024 * 1024)).toBe(50_000);
    expect(storageTimeoutMs(10 * 1024 * 1024 * 1024)).toBe(240_000);
    expect(storageTimeoutMs(Number.POSITIVE_INFINITY)).toBe(240_000);
  });

  it("a body without a content-length is read under the longest deadline, not the shortest", async () => {
    vi.useFakeTimers();
    let aborted = false;
    respond = (call) =>
      ({
        status: 200,
        ok: true,
        headers: new Headers({}),
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            call.init.signal!.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
            setTimeout(() => resolve(new ArrayBuffer(4)), 60_000);
          }),
      }) as unknown as Response;
    const pending = r2().get("chunked");
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await pending)?.bytes.byteLength).toBe(4);
    expect(aborted).toBe(false);
  });
});

/**
 * BL-STAB-2 — through the real fetch, against a stand-in that compresses
 * the way Cloudflare's edge does (200, a text type, 48 bytes or more, the
 * client accepts gzip: Content-Encoding set, Content-Length dropped). A
 * 1 KB text file used to read as 0 bytes, failing every .txt/.csv upload.
 */
describe("R2Storage behind an edge that compresses text", () => {
  let server: Server;
  let base = "";
  const objects: Record<string, Buffer> = { "/bucket/big.txt": Buffer.alloc(1024, 0x61), "/bucket/small.txt": Buffer.alloc(16, 0x61) };

  beforeEach(async () => {
    server = createServer((req, res) => {
      const body = objects[req.url ?? ""];
      if (!body) return void res.writeHead(404).end();
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (range) {
        const [start, end] = [Number(range[1]), Number(range[2])];
        res.writeHead(206, { "content-type": "text/plain", "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": String(end - start + 1) });
        return void res.end(body.subarray(start, end + 1));
      }
      const gzip = /gzip/.test(req.headers["accept-encoding"] ?? "") && body.length >= 48;
      res.writeHead(200, gzip ? { "content-type": "text/plain", "content-encoding": "gzip", etag: 'W/"e"' } : { "content-type": "text/plain", "content-length": String(body.length), etag: '"e"' });
      res.end(req.method === "HEAD" ? undefined : gzip ? gzipSync(body) : body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    // R2's host, sent to the stand-in instead; everything else is the real fetch.
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => realFetch(url.replace("https://acct.r2.cloudflarestorage.com", base), init));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise((resolve) => server.close(resolve));
  });

  it("reads a text file's real size, small or large, and its bytes", async () => {
    const storage = new R2Storage("acct", "bucket", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(await storage.head("big.txt")).toEqual({ byteSize: 1024, contentType: "text/plain", etag: "e" });
    expect((await storage.head("small.txt"))!.byteSize).toBe(16);
    expect((await storage.get("big.txt"))!.bytes.byteLength).toBe(1024);
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
