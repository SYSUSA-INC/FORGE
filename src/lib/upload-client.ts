/**
 * BL-STAB-2 — the browser half of an upload straight to storage. Used only
 * from client components. Uses XMLHttpRequest rather than fetch because
 * fetch cannot report upload progress.
 *
 * The presigned URL is a credential for one object until it expires: it is
 * never logged or sent anywhere but storage.
 */

import { cancelUploadAction, completeUploadAction, requestUploadAction } from "@/app/(app)/uploads/actions";
import { classifyPutFailure, describeUploadFailure, nextBackoffMs } from "@/lib/upload-client-logic";
import { validateUploadRequest, type UploadPurpose, type UploadView } from "@/lib/upload-policy";

export type PutResult = { status: number; bodyText: string };

/**
 * PUT `body` to a presigned URL, reporting progress. Sends only the headers
 * the server signed (the browser sets Content-Length itself from the body)
 * and no cookies. Resolves with status 0 when the request got no answer
 * (network failure, or the bucket's CORS rule refused this origin);
 * rejects only when aborted through `signal`.
 */
export function putWithProgress(i: {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    if (i.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", i.url, true);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(i.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) i.onProgress?.(e.loaded, e.total);
    };
    const onAbort = () => xhr.abort();
    i.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (result: PutResult | null) => {
      i.signal?.removeEventListener("abort", onAbort);
      if (result) resolve(result);
      else reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.onload = () => finish({ status: xhr.status, bodyText: typeof xhr.responseText === "string" ? xhr.responseText.slice(0, 2_000) : "" });
    xhr.onerror = () => finish({ status: 0, bodyText: "" });
    xhr.ontimeout = () => finish({ status: 0, bodyText: "" });
    xhr.onabort = () => finish(null);
    xhr.send(i.body);
  });
}

export type UploadPhase = "queued" | "uploading" | "verifying" | "saving" | "done" | "failed" | "cancelled";

export type UploadFileResult =
  | { ok: true; uploadId: string; upload: UploadView }
  | { ok: false; error: string; cancelled?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The server's own message from a JSON error body (the through-the-app route answers in JSON). */
function serverError(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

/**
 * BL-STAB-2c — upload one file straight to storage and have the server
 * check it. Asks for a link, PUTs the bytes with progress (retrying a
 * busy store or dropped network, renewing an expired link once), then
 * confirms. Resolves with the upload's id for a typed action to file it.
 */
export async function uploadFile(
  file: File,
  opts: { purpose: UploadPurpose; onProgress?: (loaded: number, total: number) => void; onPhase?: (phase: UploadPhase) => void; signal?: AbortSignal },
): Promise<UploadFileResult> {
  const pre = validateUploadRequest({ purpose: opts.purpose, fileName: file.name, size: file.size });
  if (!pre.ok) return { ok: false, error: pre.error };

  for (let link = 0; link < 2; link++) {
    const intent = await requestUploadAction({ purpose: opts.purpose, fileName: file.name, size: file.size });
    if (!intent.ok) return { ok: false, error: intent.error };
    opts.onPhase?.("uploading");
    let put: PutResult | null = null;
    let renew = false;
    for (let attempt = 1; ; attempt++) {
      try {
        put = await putWithProgress({ url: intent.put.url, headers: intent.put.headers, body: file, onProgress: opts.onProgress, signal: opts.signal });
      } catch {
        await cancelUploadAction(intent.uploadId).catch(() => undefined);
        return { ok: false, error: describeUploadFailure("cancelled"), cancelled: true };
      }
      if (put.status >= 200 && put.status < 300) break;
      const outcome = classifyPutFailure({ status: put.status, bodyText: put.bodyText, expiresAt: intent.expiresAt, now: Date.now() });
      const wait = outcome === "retry" || outcome === "network_or_cors" ? nextBackoffMs(attempt) : null;
      if (wait !== null) {
        await sleep(wait);
        continue;
      }
      await cancelUploadAction(intent.uploadId).catch(() => undefined);
      if (outcome === "renew" && link === 0) {
        renew = true;
        break;
      }
      return { ok: false, error: serverError(put.bodyText) ?? describeUploadFailure(outcome) };
    }
    if (renew) continue;

    opts.onPhase?.("verifying");
    if (intent.transport === "proxy") {
      // The app stored and checked the file in the same request.
      try {
        const done = JSON.parse(put!.bodyText) as Awaited<ReturnType<typeof completeUploadAction>>;
        return done.ok ? { ok: true, uploadId: intent.uploadId, upload: done.upload } : { ok: false, error: done.error };
      } catch {
        return { ok: false, error: describeUploadFailure("other") };
      }
    }
    let done = await completeUploadAction(intent.uploadId);
    if (!done.ok && done.retryable) {
      await sleep(1_000);
      done = await completeUploadAction(intent.uploadId);
    }
    return done.ok ? { ok: true, uploadId: intent.uploadId, upload: done.upload } : { ok: false, error: done.error };
  }
  return { ok: false, error: describeUploadFailure("renew") };
}
