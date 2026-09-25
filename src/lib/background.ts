/**
 * BL-AIP-4 — durable fire-and-forget for server actions and RSC pages.
 *
 * The codebase kicked off parses, harvests and scans with a bare
 * `void promise.catch(log)`. On Vercel the function instance can be
 * frozen or reclaimed as soon as the response is sent, so that work
 * sometimes died mid-flight (solicitations stuck in "parsing", won
 * proposals never harvested). Vercel exposes `waitUntil` through a
 * request context on `globalThis`; when it is there we hand the promise
 * to it so the instance stays alive until the work settles. Elsewhere
 * (local dev, tests, other hosts) the behaviour is the old one.
 *
 * This is the same mechanism `@vercel/functions` wraps; reading the
 * symbol directly avoids adding the dependency for one call.
 */
import "server-only";

import { log } from "@/lib/log";

type WaitUntil = (promise: Promise<unknown>) => void;

type RequestContext = { waitUntil?: WaitUntil };

const CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

function vercelWaitUntil(): WaitUntil | null {
  const holder = (globalThis as unknown as Record<symbol, unknown>)[CONTEXT_SYMBOL] as
    | { get?: () => RequestContext | undefined }
    | undefined;
  const fn = holder?.get?.()?.waitUntil;
  return typeof fn === "function" ? fn : null;
}

/** True when the host will keep the instance alive for background work. */
export function backgroundIsDurable(): boolean {
  return vercelWaitUntil() !== null;
}

/**
 * Run `work` after the response without blocking it. Never throws;
 * failures are logged under `label`.
 */
export function runInBackground(label: string, work: () => Promise<unknown>): void {
  let promise: Promise<unknown>;
  try {
    promise = work();
  } catch (err) {
    log.error(label, "background task threw synchronously", { error: err });
    return;
  }
  const guarded = promise.catch((err) => {
    log.error(label, "background task failed", { error: err });
  });
  const wait = vercelWaitUntil();
  if (wait) {
    try {
      wait(guarded);
      return;
    } catch (err) {
      log.warn(label, "waitUntil rejected the task; continuing detached", { error: err });
    }
  }
  void guarded;
}
