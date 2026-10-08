"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { runJobsCron, type JobsCronSummary } from "@/lib/jobs";
import { getStorageProvider } from "@/lib/storage";
import { probeCorsForOrigin, probeStorage, uploadOrigins, type CorsProbe, type StorageProbe } from "@/lib/storage-diagnostics";

/**
 * BL-AIP-4c — run one jobs-cron tick on demand from the admin page
 * (preview deployments have no Vercel Cron; production operators can
 * drain the queue without waiting five minutes). Platform-wide by
 * design; the audit row lands on the superadmin's current org.
 */
export async function runJobsNowAction(): Promise<
  { ok: true; summary: JobsCronSummary } | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  try {
    const summary = await runJobsCron({ maxJobs: 5 });
    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email ?? null },
        action: "admin.jobs.run_now",
        resourceType: "background_job",
        metadata: { ...summary },
      });
    }
    revalidatePath("/admin/jobs");
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Run failed." };
  }
}

/** The browser's origin for this request, when it sent one. */
function requestOrigin(): string {
  return (headers().get("origin") ?? "").trim().replace(/\/+$/, "");
}

/**
 * BL-STAB-2 — check file storage from the server: credentials, presigned
 * uploads, and the bucket's CORS rule for the configured origins and the
 * origin this page is open on.
 */
export async function probeStorageAction(): Promise<{ ok: true; probe: StorageProbe } | { ok: false; error: string }> {
  const actor = await requireSuperadmin();
  try {
    const origins = Array.from(new Set([...uploadOrigins(), requestOrigin()].filter(Boolean)));
    const probe = await probeStorage({ origins });
    if (actor.organizationId) {
      await recordAudit({
        organizationId: actor.organizationId,
        actor: { userId: actor.id, email: actor.email ?? null },
        action: "admin.storage.probe",
        resourceType: "storage",
        metadata: { provider: probe.provider, ready: probe.ready, signedLengthEnforced: probe.signedLengthEnforced, origins },
      });
    }
    return { ok: true, probe };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Storage check failed." };
  }
}

const SELF_TEST_BYTES = 1024;
const SELF_TEST_KEY = /^tmp\/diagnostic\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * BL-STAB-2 — the browser self-test, step 1: a presigned link for a
 * 1 KB text file under `tmp/diagnostic/`, which this page then uploads
 * from the browser exactly as a user's upload would travel.
 */
export async function startStorageSelfTestAction(): Promise<
  | { ok: true; key: string; url: string; headers: Record<string, string>; expiresAt: string; bytes: number }
  | { ok: false; error: string }
> {
  const actor = await requireSuperadmin();
  const key = `tmp/diagnostic/${randomUUID()}`;
  const direct = getStorageProvider().presignPut({ key, contentType: "text/plain", byteSize: SELF_TEST_BYTES, expiresSeconds: 300 });
  if (!direct) {
    return { ok: false, error: "Storage is the in-memory fallback here: browsers upload through the app, so there is no direct link to test. Set the R2 variables first." };
  }
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email ?? null },
      action: "admin.storage.self_test",
      resourceType: "storage",
      metadata: { phase: "start", origin: requestOrigin() },
    });
  }
  return { ok: true, key, url: direct.url, headers: direct.headers, expiresAt: direct.expiresAt.toISOString(), bytes: SELF_TEST_BYTES };
}

/**
 * BL-STAB-2 — the browser self-test, step 2: did the file arrive whole?
 * When the browser got no answer (status 0), check the bucket's CORS rule
 * for this page's origin to say why. The test file is deleted either way.
 */
export async function finishStorageSelfTestAction(input: { key: string; putStatus: number }): Promise<
  { ok: true; detail: string } | { ok: false; error: string; cors?: CorsProbe }
> {
  const actor = await requireSuperadmin();
  if (!SELF_TEST_KEY.test(input.key)) return { ok: false, error: "That is not a self-test file." };
  const storage = getStorageProvider();
  const head = await storage.head(input.key).catch(() => null);
  await storage.delete(input.key).catch(() => undefined);
  let result: { ok: true; detail: string } | { ok: false; error: string; cors?: CorsProbe };
  const answered = input.putStatus >= 200 && input.putStatus < 300;
  if (head && head.byteSize === SELF_TEST_BYTES && answered) {
    result = { ok: true, detail: "This browser uploaded straight to storage, and the file arrived whole." };
  } else if (head && head.byteSize === SELF_TEST_BYTES) {
    // Stored, but the browser could not read storage's answer: real uploads
    // would report a failure. The CORS rule must apply to the PUT's response too.
    result = {
      ok: false,
      error: `The file arrived, but this browser could not read storage's answer (status ${input.putStatus}). Check the bucket's CORS rule lists this site's origin and the PUT method.`,
    };
  } else if (input.putStatus === 0) {
    const origin = requestOrigin();
    const cors = origin ? await probeCorsForOrigin(origin) : undefined;
    result = {
      ok: false,
      error: cors && !cors.ok ? cors.detail : "The browser got no answer from storage: a network filter may be blocking the storage host, or the bucket's CORS rule refuses this origin.",
      cors,
    };
  } else {
    result = { ok: false, error: `Storage answered ${input.putStatus}${head ? `, and holds ${head.byteSize} bytes instead of ${SELF_TEST_BYTES}` : " and the file is not there"}.` };
  }
  if (actor.organizationId) {
    await recordAudit({
      organizationId: actor.organizationId,
      actor: { userId: actor.id, email: actor.email ?? null },
      action: "admin.storage.self_test",
      resourceType: "storage",
      metadata: { phase: "finish", ok: result.ok, putStatus: input.putStatus, origin: requestOrigin() },
    });
  }
  return result;
}
