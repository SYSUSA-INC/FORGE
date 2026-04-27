/**
 * FORGE blob storage gateway.
 *
 * Stores rendered PDF (or stub HTML) blobs and returns either a public
 * URL or our own download path.
 *
 * R2 is the production provider (DP-4 locked: Cloudflare R2 — cheap
 * egress, S3-compatible API). When R2 vars aren't set we fall back to
 * an in-memory cache so dev / preview never break — this means PDFs
 * are temporary across redeploys but always work end-to-end.
 *
 * For simplicity in the v1 stub path, we use our own download API
 * (`/api/proposals/[id]/pdf/[renderId]`) for both providers — that
 * route hits whichever storage adapter is active and streams the bytes.
 * Switching to R2 with public-bucket access in a follow-up is a small
 * change to the route handler.
 */

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

export interface StorageProvider {
  readonly name: StorageProviderName;
  put(opts: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredObject>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
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
}

class R2Storage implements StorageProvider {
  readonly name = "r2" as const;
  constructor(
    private accountId: string,
    private bucket: string,
    private accessKeyId: string,
    private secretAccessKey: string,
  ) {}

  /**
   * R2 is S3-compatible. We don't pull in @aws-sdk/client-s3 here to
   * keep this PR's dependency footprint small; we sign requests with
   * AWS SigV4 by hand using Web Crypto. Implementation deliberately
   * left as a follow-up — when a customer needs persistent multi-day
   * PDFs across redeploys, we install @aws-sdk/client-s3 and replace
   * this class. Until then, falling back to MemoryStorage is the
   * correct behavior.
   */
  async put(): Promise<StoredObject> {
    void this.accountId;
    void this.bucket;
    void this.accessKeyId;
    void this.secretAccessKey;
    throw new Error(
      "R2Storage is not yet implemented. Either install @aws-sdk/client-s3 " +
        "and finish R2Storage in src/lib/storage.ts, or unset R2_BUCKET to " +
        "fall back to MemoryStorage.",
    );
  }
  async get(): Promise<null> {
    return null;
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
      return { name, configured: true, reason: "All R2 vars present (impl WIP)" };
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
