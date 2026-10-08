/**
 * BL-STAB-2 — what the browser does when an upload straight to storage
 * goes wrong, and how its progress reads. Pure (no DOM, no network) so it
 * is unit-tested; `upload-client.ts` drives the request itself.
 */

export type PutOutcome = "retry" | "renew" | "network_or_cors" | "fatal_signature" | "fatal_too_large";

/**
 * Classify a failed PUT to a presigned URL.
 * - Status 0: the request never got an answer. Either the network dropped
 *   or the storage bucket refused the browser (CORS); retry with backoff,
 *   then report it so the server can check the bucket's CORS rule.
 * - 403 for an expired link (by the body, or by the clock with 30 s of
 *   slack): ask for one fresh link.
 * - Any other 403: the signature does not match (wrong type or length, a
 *   clock far off): not worth retrying.
 * - 413: too large for storage.
 * - 5xx / 429 / 408: storage is busy; retry with backoff.
 */
export function classifyPutFailure(i: { status: number; bodyText: string; expiresAt: string; now: number }): PutOutcome {
  if (i.status === 0) return "network_or_cors";
  if (i.status === 413) return "fatal_too_large";
  if (i.status === 403) {
    const expiresAt = Date.parse(i.expiresAt);
    const expired = /request has expired|expiredtoken|expired/i.test(i.bodyText) || (Number.isFinite(expiresAt) && i.now >= expiresAt - 30_000);
    return expired ? "renew" : "fatal_signature";
  }
  if (i.status === 408 || i.status === 429 || i.status >= 500) return "retry";
  return "fatal_signature";
}

/** Wait before retry number `attempt` (1-based): 1 s, 4 s, 10 s, then give up (null). */
export function nextBackoffMs(attempt: number): number | null {
  const steps = [1_000, 4_000, 10_000];
  return attempt >= 1 && attempt <= steps.length ? steps[attempt - 1]! : null;
}

export type ProgressSnap = { loaded: number; total: number; at: number; bytesPerSec: number | null; etaSec: number | null };

/**
 * Progress with a smoothed speed and time left. The speed is an
 * exponential average of the rate since the previous snapshot, so a
 * single slow or fast tick does not swing the estimate.
 */
export function progressSnapshot(prev: ProgressSnap | null, loaded: number, total: number, now: number): ProgressSnap {
  let bytesPerSec = prev?.bytesPerSec ?? null;
  if (prev && now > prev.at && loaded >= prev.loaded) {
    const rate = ((loaded - prev.loaded) * 1000) / (now - prev.at);
    bytesPerSec = bytesPerSec === null ? rate : bytesPerSec * 0.7 + rate * 0.3;
  }
  const remaining = Math.max(0, total - loaded);
  const etaSec = bytesPerSec && bytesPerSec > 0 ? Math.ceil(remaining / bytesPerSec) : null;
  return { loaded, total, at: now, bytesPerSec, etaSec };
}

/** The message a person sees for a failed upload. */
export function describeUploadFailure(code: string): string {
  switch (code) {
    case "network_or_cors":
      return "The file did not reach storage. Your network or the storage setup (CORS) may be blocking it; an administrator can check Admin → Jobs → File storage.";
    case "fatal_signature":
      return "Storage refused the upload link. Try again; if it keeps happening, an administrator can check Admin → Jobs → File storage.";
    case "fatal_too_large":
      return "Storage refused the file as too large.";
    case "renew":
      return "The upload link expired before the file finished. Try again.";
    case "retry":
      return "Storage was busy and the upload did not finish. Try again.";
    case "cancelled":
      return "Upload cancelled.";
    default:
      return "The upload did not finish. Try again.";
  }
}

/** "12.4 MB" — decimal megabytes, as people read file sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
