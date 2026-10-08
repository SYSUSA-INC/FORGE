/**
 * BL-STAB-2 — is file storage ready for uploads straight from the browser?
 *
 * Uploads go from the browser to Cloudflare R2 through presigned URLs, so
 * they depend on three things the app cannot see from a normal request:
 * the R2 credentials, R2 honouring the signed URL, and the bucket's CORS
 * rule allowing the app's origin. This probe checks each from the server
 * and says which is missing; the browser self-test on Admin → Jobs then
 * proves the whole path from a real browser. All objects it writes live
 * under `tmp/diagnostic/` and are deleted before it returns.
 *
 * Server-only. Platform-wide (not tenant data); callers have checked
 * requireSuperadmin().
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { resolveEnvLabel } from "@/lib/env-label";
import { getStorageProvider, getStorageProviderStatus, memoryStorageRefused, uploadTransport, type StorageProviderName } from "@/lib/storage";

export type ProbeStep = {
  name: string;
  /** null: informational, neither pass nor fail. */
  ok: boolean | null;
  detail: string;
};

export type CorsProbe = { origin: string; ok: boolean; detail: string };

export type StorageProbe = {
  provider: StorageProviderName;
  reason: string;
  environment: string;
  transport: "direct" | "proxy";
  steps: ProbeStep[];
  cors: CorsProbe[];
  /** Whether R2 refused a PUT whose length differs from the signed one; null when not tested. */
  signedLengthEnforced: boolean | null;
  /** Browser uploads will work here (every required step passed). */
  ready: boolean;
  checkedAt: string;
};

const REQUEST_TIMEOUT_MS = 15_000;

function bytesOf(n: number, fill = 0x61): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

/** Origins the app is served from: `UPLOAD_ALLOWED_ORIGINS` (comma-separated), else the app's base URL. */
export function uploadOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const listed = (env.UPLOAD_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return listed.length > 0 ? listed : [appBaseUrl(env)];
}

/** The URL of an object, without a signature, for a CORS preflight. */
function objectUrl(key: string): string | null {
  const presigned = getStorageProvider().presignPut({ key, contentType: "text/plain", byteSize: 1, expiresSeconds: 60 });
  if (!presigned) return null;
  const url = new URL(presigned.url);
  return `${url.origin}${url.pathname}`;
}

/**
 * Ask R2, as a browser would before an upload, whether `origin` may PUT
 * with a content-type header. Read from the preflight's answer headers.
 */
async function preflight(origin: string, url: string): Promise<CorsProbe> {
  try {
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const allowOrigin = res.headers.get("access-control-allow-origin") ?? "";
    const allowMethods = (res.headers.get("access-control-allow-methods") ?? "").toUpperCase();
    const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    const originOk = allowOrigin === "*" || allowOrigin === origin;
    const methodOk = !allowMethods || allowMethods.includes("PUT") || allowMethods.includes("*");
    const headerOk = !allowHeaders || allowHeaders.includes("content-type") || allowHeaders.includes("*");
    if (res.ok && originOk && methodOk && headerOk) return { origin, ok: true, detail: "The bucket allows uploads from this origin." };
    const missing = [
      !originOk && "this origin is not in AllowedOrigins",
      !methodOk && "PUT is not in AllowedMethods",
      !headerOk && "content-type is not in AllowedHeaders",
    ].filter(Boolean);
    return {
      origin,
      ok: false,
      detail: `The bucket's CORS rule refuses browser uploads (HTTP ${res.status}${missing.length ? `: ${missing.join("; ")}` : ""}). Add the rule from the admin manual (File storage).`,
    };
  } catch (err) {
    return { origin, ok: false, detail: `The CORS check could not reach storage: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const corsCache = new Map<string, { at: number; result: CorsProbe }>();

/** The CORS check for one origin, remembered for five minutes. */
export async function probeCorsForOrigin(origin: string): Promise<CorsProbe> {
  const clean = origin.trim().replace(/\/+$/, "");
  const hit = corsCache.get(clean);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.result;
  const url = objectUrl(`tmp/diagnostic/cors-${randomUUID()}`);
  const result = url ? await preflight(clean, url) : { origin: clean, ok: false, detail: "Storage is the in-memory fallback; browsers upload through the app here." };
  corsCache.set(clean, { at: Date.now(), result });
  return result;
}

async function step(name: string, fn: () => Promise<{ ok: boolean | null; detail: string }>): Promise<ProbeStep> {
  try {
    return { name, ...(await fn()) };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
}

async function putTo(url: string, body: Uint8Array, contentType: string): Promise<number> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: Buffer.from(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await res.arrayBuffer().catch(() => undefined);
  return res.status;
}

/**
 * Check storage end to end from the server: write, read, ranged read and
 * delete with the app's credentials; then a presigned upload, and whether
 * R2 refuses a different length or type than the URL was signed for; then
 * the bucket's CORS rule for each origin.
 */
export async function probeStorage(i: { origins: string[] }): Promise<StorageProbe> {
  const status = getStorageProviderStatus().active;
  const storage = getStorageProvider();
  const environment = resolveEnvLabel() ?? "local";
  const transport = uploadTransport();
  const steps: ProbeStep[] = [];
  const base = `tmp/diagnostic/${randomUUID()}`;
  const payload = bytesOf(16);

  steps.push(
    await step("Write a file", async () => {
      const put = await storage.put({ key: `${base}/server`, bytes: payload, contentType: "text/plain" });
      return { ok: put.byteSize === 16, detail: `Stored 16 bytes${put.etag ? ` (ETag ${put.etag.slice(0, 12)}…)` : ""}.` };
    }),
  );
  steps.push(
    await step("Read its size", async () => {
      const head = await storage.head(`${base}/server`);
      return head && head.byteSize === 16
        ? { ok: true, detail: `16 bytes, ${head.contentType}.` }
        : { ok: false, detail: head ? `Reported ${head.byteSize} bytes, expected 16.` : "The file just written was not found." };
    }),
  );
  steps.push(
    await step("Read part of it", async () => {
      const part = await storage.getRange(`${base}/server`, 0, 3);
      return part && part.byteLength === 4 ? { ok: true, detail: "Read bytes 0-3." } : { ok: false, detail: `Got ${part?.byteLength ?? "no"} bytes for a 4-byte range.` };
    }),
  );
  steps.push(
    await step("Delete it", async () => {
      await storage.delete(`${base}/server`);
      const gone = (await storage.head(`${base}/server`)) === null;
      return { ok: gone, detail: gone ? "Deleted." : "Still there after delete." };
    }),
  );

  let signedLengthEnforced: boolean | null = null;
  const cors: CorsProbe[] = [];
  if (status.name === "r2") {
    const key = `${base}/presigned`;
    const direct = storage.presignPut({ key, contentType: "text/plain", byteSize: 16, expiresSeconds: 300 });
    if (direct) {
      steps.push(
        await step("Upload through a presigned link", async () => {
          const code = await putTo(direct.url, payload, "text/plain");
          if (code < 200 || code >= 300) return { ok: false, detail: `R2 answered ${code} to a correctly signed upload (check the credentials and the server clock).` };
          const head = await storage.head(key);
          return { ok: head?.byteSize === 16, detail: head?.byteSize === 16 ? "R2 accepted the signed upload." : "R2 accepted the upload but the file is missing." };
        }),
      );
      steps.push(
        await step("Refuses a different size than signed", async () => {
          if (process.env.UPLOAD_SIGN_CONTENT_LENGTH === "0") return { ok: null, detail: "Not tested: UPLOAD_SIGN_CONTENT_LENGTH=0 leaves the size unsigned." };
          const code = await putTo(direct.url, bytesOf(17), "text/plain");
          signedLengthEnforced = code === 403;
          return {
            ok: null,
            detail: signedLengthEnforced
              ? "R2 refused it (403): the signed size is enforced."
              : `R2 answered ${code}: the signed size is not enforced; the server's size check after upload covers it.`,
          };
        }),
      );
      steps.push(
        await step("Refuses a different type than signed", async () => {
          const code = await putTo(direct.url, payload, "application/pdf");
          return {
            ok: null,
            detail: code === 403 ? "R2 refused it (403): the signed type is enforced." : `R2 answered ${code}: the signed type is not enforced; the server's type check after upload covers it.`,
          };
        }),
      );
      await storage.delete(key).catch(() => undefined);
      const url = objectUrl(`${base}/cors`);
      if (url) {
        for (const origin of i.origins) {
          const result = await preflight(origin, url);
          corsCache.set(origin, { at: Date.now(), result });
          cors.push(result);
        }
      }
    }
  } else {
    steps.push({
      name: "Uploads straight to storage",
      ok: memoryStorageRefused() ? false : null,
      detail: memoryStorageRefused()
        ? `This is ${environment}, but storage is the in-memory fallback: files would vanish on the next deploy. Set the R2 variables (${status.reason}).`
        : "Storage is the in-memory fallback: browsers upload through the app, limited to about 4 MB on Vercel. Set the R2 variables for full-size uploads.",
    });
  }

  const required = steps.filter((s) => s.ok !== null);
  const ready = required.every((s) => s.ok === true) && (status.name !== "r2" || (cors.length > 0 && cors.every((c) => c.ok)));
  return {
    provider: status.name,
    reason: status.reason,
    environment,
    transport,
    steps,
    cors,
    signedLengthEnforced,
    ready,
    checkedAt: new Date().toISOString(),
  };
}
