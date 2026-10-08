/**
 * FORGE blob storage gateway.
 *
 * Stores rendered PDF (or stub HTML) blobs and returns either a public
 * URL or our own download path.
 *
 * R2 is the production provider (DP-4 locked: Cloudflare R2 — cheap
 * egress, S3-compatible API; implemented in BL-AIP-4b with hand-rolled
 * SigV4). When R2 vars aren't set we fall back to an in-memory cache so
 * dev / preview never break — this means PDFs, solicitation files and
 * corpus uploads are temporary across redeploys but always work
 * end-to-end.
 *
 * For simplicity in the v1 stub path, we use our own download API
 * (`/api/proposals/[id]/pdf/[renderId]`) for both providers — that
 * route hits whichever storage adapter is active and streams the bytes.
 * Switching to R2 with public-bucket access in a follow-up is a small
 * change to the route handler.
 */

import "server-only";

import { createHash } from "node:crypto";
import { EMPTY_PAYLOAD_SHA256, presignUrl, sha256Hex, signRequest, uriEncodePath } from "@/lib/aws-sigv4";
import { resolveEnvLabel } from "@/lib/env-label";

export type StoredObject = {
  storagePath: string;
  byteSize: number;
  contentType: string;
  /** BL-STAB-2 — the object's entity tag, to tell later whether it changed. */
  etag: string;
};

export type StorageProviderName = "r2" | "memory";

export type StorageProviderStatus = {
  name: StorageProviderName;
  configured: boolean;
  reason: string;
};

/** BL-STAB-2 — a URL the browser sends one file to, straight to storage. */
export type DirectUpload = {
  url: string;
  method: "PUT";
  /** Headers the browser must send with exactly these values. */
  headers: Record<string, string>;
  expiresAt: Date;
};

export interface StorageProvider {
  readonly name: StorageProviderName;
  put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string; etag: string } | null>;
  /** BL-STAB-2 — an object's size, type and entity tag without reading it; null when absent. */
  head(key: string): Promise<{ byteSize: number; contentType: string; etag: string } | null>;
  /** BL-STAB-2 — bytes `start` to `endInclusive` of an object (fewer at its end); null when absent. */
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | null>;
  /** BL-STAB-2 — remove an object; removing one that is absent is not an error. */
  delete(key: string): Promise<void>;
  /**
   * BL-STAB-2 — a short-lived URL for the browser to PUT exactly one file
   * of this type and size to `key`. Null when the provider has no URL a
   * browser can reach (the memory fallback), so the caller uploads through
   * the app instead.
   */
  presignPut(opts: { key: string; contentType: string; byteSize: number; expiresSeconds: number }): DirectUpload | null;
}

/**
 * BL-STAB-2 — how long one storage request may take, body included:
 * 30 s plus 2 s per MiB, at most 4 minutes.
 */
export function storageTimeoutMs(bytes: number): number {
  const mib = Math.max(0, bytes) / (1024 * 1024);
  return Number.isFinite(mib) ? Math.min(240_000, Math.round(30_000 + 2_000 * mib)) : 240_000;
}

type MemoryEntry = { bytes: Uint8Array; contentType: string; etag: string };

/**
 * The memory cache lives on `globalThis`: Next builds route handlers and
 * server actions as separate module copies, and a static field would give
 * each its own cache, so a file one stored would be missing for the other.
 */
function memoryCache(): Map<string, MemoryEntry> {
  const g = globalThis as typeof globalThis & { __forgeMemoryStorage?: Map<string, MemoryEntry> };
  g.__forgeMemoryStorage ??= new Map();
  return g.__forgeMemoryStorage;
}

export class MemoryStorage implements StorageProvider {
  readonly name = "memory" as const;

  async put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    const etag = createHash("md5").update(opts.bytes).digest("hex");
    memoryCache().set(opts.key, { bytes: opts.bytes, contentType: opts.contentType, etag });
    return {
      storagePath: opts.key,
      byteSize: opts.bytes.byteLength,
      contentType: opts.contentType,
      etag,
    };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string; etag: string } | null> {
    return memoryCache().get(key) ?? null;
  }

  async head(key: string): Promise<{ byteSize: number; contentType: string; etag: string } | null> {
    const hit = memoryCache().get(key);
    return hit ? { byteSize: hit.bytes.byteLength, contentType: hit.contentType, etag: hit.etag } : null;
  }

  async getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | null> {
    const hit = memoryCache().get(key);
    return hit ? hit.bytes.subarray(start, endInclusive + 1) : null;
  }

  async delete(key: string): Promise<void> {
    memoryCache().delete(key);
  }

  presignPut(): DirectUpload | null {
    return null;
  }
}

/** An entity tag without its quotes (R2 returns `"abc…"`). */
function cleanEtag(raw: string | null): string {
  return (raw ?? "").replace(/^W\//, "").replace(/"/g, "");
}

/**
 * BL-AIP-4b — Cloudflare R2 through its S3-compatible API, signed with
 * SigV4 by hand (src/lib/aws-sigv4.ts) so no SDK is needed. Keys are
 * stored as given; the object's content type rides on the object
 * metadata so `get` can return it. A missing object is `null`; every
 * other failure throws with the HTTP status so the caller's existing
 * error paths report it.
 */
export class R2Storage implements StorageProvider {
  readonly name = "r2" as const;

  constructor(
    private accountId: string,
    private bucket: string,
    private accessKeyId: string,
    private secretAccessKey: string,
  ) {}

  private get host(): string {
    return `${this.accountId}.r2.cloudflarestorage.com`;
  }

  private path(key: string): string {
    return uriEncodePath(`/${this.bucket}/${key.replace(/^\/+/, "")}`);
  }

  /**
   * Send one signed request. The deadline is left running for the caller
   * to read the body under (BL-STAB-2: it used to be cleared once the
   * headers arrived, so a stalled body read of a large file never ended);
   * `done()` clears it, and `extend(bytes)` re-arms it for the body's size.
   */
  private async send(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    body: Uint8Array | null,
    extraHeaders: Record<string, string>,
  ): Promise<{ res: Response; extend(bytes: number): void; done(): void }> {
    const path = this.path(key);
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_SHA256;
    const signed = signRequest({
      method,
      host: this.host,
      path,
      headers: extraHeaders,
      payloadHash,
      region: "auto",
      service: "s3",
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      now: new Date(),
    });
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), storageTimeoutMs(body?.byteLength ?? 0));
    const done = () => clearTimeout(timer);
    const extend = (bytes: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), storageTimeoutMs(bytes));
    };
    try {
      const res = await fetch(`https://${this.host}${path}`, {
        method,
        headers: signed.headers,
        body: body ? Buffer.from(body) : undefined,
        signal: controller.signal,
      });
      return { res, extend, done };
    } catch (err) {
      done();
      throw err;
    }
  }

  async put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    const { res, done } = await this.send("PUT", opts.key, opts.bytes, {
      "content-type": opts.contentType || "application/octet-stream",
    });
    try {
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`R2 put failed (${res.status}) for ${opts.key}: ${detail}`);
      }
      return {
        storagePath: opts.key,
        byteSize: opts.bytes.byteLength,
        contentType: opts.contentType,
        etag: cleanEtag(res.headers.get("etag")),
      };
    } finally {
      done();
    }
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string; etag: string } | null> {
    const { res, extend, done } = await this.send("GET", key, null, {});
    try {
      if (res.status === 404) return null;
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`R2 get failed (${res.status}) for ${key}: ${detail}`);
      }
      // Size unknown (no content-length): allow the longest deadline rather than the shortest.
      const length = res.headers.get("content-length");
      extend(length ? Number(length) : Number.POSITIVE_INFINITY);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        bytes,
        contentType: res.headers.get("content-type") || "application/octet-stream",
        etag: cleanEtag(res.headers.get("etag")),
      };
    } finally {
      done();
    }
  }

  async head(key: string): Promise<{ byteSize: number; contentType: string; etag: string } | null> {
    const { res, done } = await this.send("HEAD", key, null, {});
    done();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 head failed (${res.status}) for ${key}`);
    return {
      byteSize: Number(res.headers.get("content-length") ?? "0"),
      contentType: res.headers.get("content-type") || "application/octet-stream",
      etag: cleanEtag(res.headers.get("etag")),
    };
  }

  async getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | null> {
    const { res, extend, done } = await this.send("GET", key, null, { range: `bytes=${start}-${endInclusive}` });
    try {
      if (res.status === 404) return null;
      // 416: the range starts past the end of the object.
      if (res.status === 416) return new Uint8Array(0);
      if (res.status !== 206 && res.status !== 200) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`R2 ranged get failed (${res.status}) for ${key}: ${detail}`);
      }
      extend(endInclusive - start + 1);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // A 200 is the whole object: keep only the bytes asked for.
      return res.status === 200 ? bytes.subarray(start, endInclusive + 1) : bytes;
    } finally {
      done();
    }
  }

  async delete(key: string): Promise<void> {
    const { res, done } = await this.send("DELETE", key, null, {});
    try {
      if (!res.ok && res.status !== 404) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`R2 delete failed (${res.status}) for ${key}: ${detail}`);
      }
    } finally {
      done();
    }
  }

  /**
   * The type is signed, and the exact length too unless
   * `UPLOAD_SIGN_CONTENT_LENGTH=0`. Whether R2 enforces a signed length is
   * recorded by the storage check on Admin → Jobs; either way the server
   * checks the stored object's size and type after the upload, which is
   * the control that counts.
   */
  presignPut(opts: { key: string; contentType: string; byteSize: number; expiresSeconds: number }): DirectUpload {
    const now = new Date();
    const signLength = readEnv("UPLOAD_SIGN_CONTENT_LENGTH") !== "0";
    const presigned = presignUrl({
      method: "PUT",
      host: this.host,
      path: this.path(opts.key),
      headers: {
        "content-type": opts.contentType,
        ...(signLength ? { "content-length": String(opts.byteSize) } : {}),
      },
      region: "auto",
      service: "s3",
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      now,
      expiresSeconds: opts.expiresSeconds,
    });
    return {
      url: presigned.url,
      method: "PUT",
      // Browsers set content-length themselves from the file; only the type is theirs to send.
      headers: { "content-type": opts.contentType },
      expiresAt: new Date(now.getTime() + opts.expiresSeconds * 1000),
    };
  }
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v : null;
}

function statusFor(name: StorageProviderName): StorageProviderStatus {
  switch (name) {
    case "r2": {
      const missing = [
        !readEnv("R2_BUCKET") && "R2_BUCKET",
        !readEnv("R2_ACCOUNT_ID") && "R2_ACCOUNT_ID",
        !readEnv("R2_ACCESS_KEY_ID") && "R2_ACCESS_KEY_ID",
        !readEnv("R2_SECRET_ACCESS_KEY") && "R2_SECRET_ACCESS_KEY",
      ].filter(Boolean) as string[];
      if (missing.length) {
        return { name, configured: false, reason: `Missing: ${missing.join(", ")}` };
      }
      return { name, configured: true, reason: "Cloudflare R2 (S3 API, SigV4)" };
    }
    case "memory":
      return {
        name,
        configured: true,
        reason: "Memory cache — non-persistent across deploys",
      };
  }
}

export function getStorageProviderStatus(): {
  active: StorageProviderStatus;
  all: StorageProviderStatus[];
} {
  const all: StorageProviderStatus[] = [statusFor("r2"), statusFor("memory")];
  const r2 = all.find((s) => s.name === "r2")!;
  const active: StorageProviderStatus =
    r2.configured && readEnv("STORAGE_PROVIDER") !== "memory"
      ? r2
      : statusFor("memory");
  return { active, all };
}

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const { active } = getStorageProviderStatus();
  if (active.name === "r2") {
    cached = new R2Storage(
      readEnv("R2_ACCOUNT_ID")!,
      readEnv("R2_BUCKET")!,
      readEnv("R2_ACCESS_KEY_ID")!,
      readEnv("R2_SECRET_ACCESS_KEY")!,
    );
  } else {
    cached = new MemoryStorage();
  }
  return cached;
}

/**
 * BL-STAB-2 — how a browser upload reaches storage: `direct` (a presigned
 * PUT to R2) or `proxy` (through the app, limited by the host's request
 * body cap). Proxy when storage is the memory fallback, or when the
 * operator sets `UPLOAD_TRANSPORT=proxy`.
 */
export function uploadTransport(env: Record<string, string | undefined> = process.env): "direct" | "proxy" {
  if (getStorageProviderStatus().active.name === "memory") return "proxy";
  return (env.UPLOAD_TRANSPORT || "").trim().toLowerCase() === "proxy" ? "proxy" : "direct";
}

/**
 * BL-STAB-2 — production and staging must not keep files in memory: they
 * would vanish on the next deploy or land on another server instance.
 */
export function memoryStorageRefused(env: Record<string, string | undefined> = process.env): boolean {
  const label = resolveEnvLabel(env);
  return getStorageProviderStatus().active.name === "memory" && (label === "production" || label === "staging");
}
