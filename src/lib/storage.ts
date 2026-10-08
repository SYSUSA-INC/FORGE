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

import { EMPTY_PAYLOAD_SHA256, presignUrl, sha256Hex, signRequest, uriEncodePath } from "@/lib/aws-sigv4";

export type StoredObject = {
  storagePath: string;
  byteSize: number;
  contentType: string;
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
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** BL-STAB-2 — an object's size and type without reading it; null when absent. */
  head(key: string): Promise<{ byteSize: number; contentType: string } | null>;
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

class MemoryStorage implements StorageProvider {
  readonly name = "memory" as const;
  /** Module-scoped cache keyed by storage path. */
  private static cache = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();

  async put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    MemoryStorage.cache.set(opts.key, {
      bytes: opts.bytes,
      contentType: opts.contentType,
    });
    return {
      storagePath: opts.key,
      byteSize: opts.bytes.byteLength,
      contentType: opts.contentType,
    };
  }

  async get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    return MemoryStorage.cache.get(key) ?? null;
  }

  async head(key: string): Promise<{ byteSize: number; contentType: string } | null> {
    const hit = MemoryStorage.cache.get(key);
    return hit ? { byteSize: hit.bytes.byteLength, contentType: hit.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    MemoryStorage.cache.delete(key);
  }

  presignPut(): DirectUpload | null {
    return null;
  }
}

/**
 * BL-AIP-4b — Cloudflare R2 through its S3-compatible API, signed with
 * SigV4 by hand (src/lib/aws-sigv4.ts) so no SDK is needed for PUT and
 * GET. Keys are stored as given; the object's content type rides on the
 * object metadata so `get` can return it. A missing object is `null`;
 * every other failure throws with the HTTP status so the caller's
 * existing error paths report it.
 */
class R2Storage implements StorageProvider {
  readonly name = "r2" as const;
  private static readonly TIMEOUT_MS = 30_000;

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

  private async send(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    body: Uint8Array | null,
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
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
    const timer = setTimeout(() => controller.abort(), R2Storage.TIMEOUT_MS);
    try {
      return await fetch(`https://${this.host}${path}`, {
        method,
        headers: signed.headers,
        body: body ? Buffer.from(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    const res = await this.send("PUT", opts.key, opts.bytes, {
      "content-type": opts.contentType || "application/octet-stream",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`R2 put failed (${res.status}) for ${opts.key}: ${detail}`);
    }
    return {
      storagePath: opts.key,
      byteSize: opts.bytes.byteLength,
      contentType: opts.contentType,
    };
  }

  async get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const res = await this.send("GET", key, null, {});
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`R2 get failed (${res.status}) for ${key}: ${detail}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }

  async head(key: string): Promise<{ byteSize: number; contentType: string } | null> {
    const res = await this.send("HEAD", key, null, {});
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 head failed (${res.status}) for ${key}`);
    return {
      byteSize: Number(res.headers.get("content-length") ?? "0"),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key, null, {});
    if (!res.ok && res.status !== 404) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`R2 delete failed (${res.status}) for ${key}: ${detail}`);
    }
  }

  /**
   * The type and exact size are signed, so R2 refuses a PUT of any other
   * type or length; the server still checks the stored object afterwards.
   */
  presignPut(opts: { key: string; contentType: string; byteSize: number; expiresSeconds: number }): DirectUpload {
    const now = new Date();
    const presigned = presignUrl({
      method: "PUT",
      host: this.host,
      path: this.path(opts.key),
      headers: { "content-type": opts.contentType, "content-length": String(opts.byteSize) },
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
