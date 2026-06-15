import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { productionErrors } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * BL-QC-errors — in-app production error capture.
 *
 * Replaces what an external observability backend (e.g., Sentry) would
 * give us. Called from:
 *   - `instrumentation.ts` onRequestError hook (server actions, route handlers, RSC)
 *   - `app/global-error.tsx` and `app/error.tsx` (client-side error boundaries)
 *   - Anywhere a catch block wants to escalate beyond the structured
 *     log line (`log.error(...)` only) into a persisted record an
 *     operator can triage at `/admin/errors`.
 *
 * Two design rules:
 *
 *   1. Never throw. A failure here means an operator can't see the
 *      original error — bad, but better than masking the user-facing
 *      action with an "error reporting failed" stack.
 *
 *   2. Dedupe aggressively. The fingerprint is a SHA-256 over the
 *      first 5 stack frames (with line/column numbers stripped). Same
 *      fingerprint → bump occurrenceCount + lastSeenAt, don't insert
 *      a new row.
 */

export type ErrorCaptureInput = {
  error: unknown;
  /**
   * Optional tag — typically the call-site identifier from
   * `log.error("[tag]", ...)`. Prepended to the stored message so
   * `/admin/errors` shows where the error came from.
   */
  tag?: string | null;
  /** "server" | "client" | "edge" — caller fills in based on context. */
  runtime?: "server" | "client" | "edge";
  organizationId?: string | null;
  userId?: string | null;
  requestPath?: string | null;
  requestMethod?: string | null;
  httpStatus?: number | null;
  userAgent?: string | null;
};

const MAX_MESSAGE_LEN = 1000;
const MAX_STACK_LEN = 8000;
const STACK_FRAMES_FOR_FINGERPRINT = 5;

/**
 * Capture a production error. Best-effort write — never throws.
 */
export async function captureProductionError(
  input: ErrorCaptureInput,
): Promise<void> {
  try {
    const { message: rawMessage, stack } = normalize(input.error);
    if (!rawMessage) return; // nothing to report

    if (shouldIgnore(rawMessage, stack)) return;

    // Prepend the tag (if any) so the stored message identifies the
    // call site. Tag becomes part of the fingerprint input via
    // computeFingerprint(message, stack) — same tag + same error
    // dedupe; same error from different tags get distinct rows
    // (intentional — different sites likely need different triage).
    const message = input.tag ? `${input.tag} ${rawMessage}` : rawMessage;

    const fingerprint = computeFingerprint(message, stack);

    const environment =
      process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
    const releaseSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";

    // Upsert: insert the row if fingerprint is new; otherwise bump the
    // counter + lastSeenAt + replace the latest message/stack (the
    // most recent occurrence wins so changing line numbers across
    // deploys don't break the latest view).
    await db
      .insert(productionErrors)
      .values({
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        fingerprint,
        message: message.slice(0, MAX_MESSAGE_LEN),
        stack: stack.slice(0, MAX_STACK_LEN),
        runtime: input.runtime ?? "server",
        environment: environment.slice(0, 64),
        requestPath: (input.requestPath ?? "").slice(0, 1024),
        requestMethod: (input.requestMethod ?? "").slice(0, 16),
        httpStatus: input.httpStatus ?? null,
        userAgent: (input.userAgent ?? "").slice(0, 512),
        releaseSha: releaseSha.slice(0, 64),
      })
      .onConflictDoUpdate({
        target: productionErrors.fingerprint,
        set: {
          lastSeenAt: sql`now()`,
          occurrenceCount: sql`${productionErrors.occurrenceCount} + 1`,
          message: sql`excluded.message`,
          stack: sql`excluded.stack`,
          runtime: sql`excluded.runtime`,
          environment: sql`excluded.environment`,
          requestPath: sql`excluded.request_path`,
          requestMethod: sql`excluded.request_method`,
          httpStatus: sql`excluded.http_status`,
          userAgent: sql`excluded.user_agent`,
          releaseSha: sql`excluded.release_sha`,
          // If the row had previously been resolved, a new occurrence
          // un-resolves it so the operator knows the bug came back.
          resolvedAt: sql`NULL`,
          resolvedByUserId: sql`NULL`,
        },
      });
  } catch (err) {
    // Best-effort: log the meta-failure but never let it propagate.
    log.error("[captureProductionError]", "failed to persist error", {
      error: err,
    });
  }
}

function normalize(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return {
      message: err.message || err.name || "Error",
      stack: err.stack ?? "",
    };
  }
  if (typeof err === "string") {
    return { message: err, stack: "" };
  }
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; stack?: unknown };
    const message =
      typeof obj.message === "string" ? obj.message : JSON.stringify(err);
    const stack = typeof obj.stack === "string" ? obj.stack : "";
    return { message, stack };
  }
  return { message: String(err ?? ""), stack: "" };
}

/**
 * Drop noise we don't want clogging the error inbox. Mirrors the
 * `ignoreErrors` pattern third-party SDKs use, but cheaper because
 * we filter pre-write rather than burning quota.
 */
function shouldIgnore(message: string, stack: string): boolean {
  // Next.js framework signals — control flow, not real errors.
  if (
    message === "NEXT_REDIRECT" ||
    message === "NEXT_NOT_FOUND" ||
    message === "NEXT_HTTP_ERROR_FALLBACK" ||
    message.startsWith("NEXT_REDIRECT;") ||
    message.startsWith("NEXT_NOT_FOUND;")
  ) {
    return true;
  }
  // Browser-extension noise (only relevant on client-side captures).
  if (
    stack.includes("chrome-extension://") ||
    stack.includes("moz-extension://") ||
    stack.includes("safari-extension://")
  ) {
    return true;
  }
  // Benign browser quirk that fires constantly on layout-heavy pages.
  if (/ResizeObserver loop/i.test(message)) {
    return true;
  }
  // Aborted fetch — user navigated away mid-request. Not actionable.
  if (message === "AbortError" || message.includes("The user aborted")) {
    return true;
  }
  return false;
}

function computeFingerprint(message: string, stack: string): string {
  // Strip absolute paths, hex line/column markers, and trailing
  // anonymous-function counters so the fingerprint is stable across
  // deploys (different file hashes in Vercel builds change the path
  // but not the underlying call).
  const frames = stack
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/:\d+:\d+/g, "") // strip ":line:col" markers
        .replace(/\/\.next\/[^/]+\//g, "/.next/") // collapse hashed build dirs
        .replace(/\/\.\/[^/]+\//g, "/")
        .replace(/^\s*at\s+/, ""),
    )
    .filter(Boolean)
    .slice(0, STACK_FRAMES_FOR_FINGERPRINT);

  const raw = `${message}\n${frames.join("\n")}`;
  return createHash("sha256").update(raw).digest("hex");
}
