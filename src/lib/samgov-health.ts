import "server-only";
import { createHash } from "node:crypto";
import { samGetText } from "@/lib/samgov";
import { samErrorMessage } from "@/lib/samgov-errors";
import { platformSamCredential } from "@/lib/samgov-key";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { log } from "@/lib/log";

/**
 * BL-STAB-10b — the public SAM.gov health probe (`/api/samgov/health`,
 * open for uptime monitors). Each live probe is one request on FORGE's
 * shared key, so an anonymous caller could use up the key's daily limit
 * for every company that relies on it. Now: the same answer for 60 s per
 * server; at most one live probe per 30-minute window across servers, per
 * key (a short hash of it, so a replaced key is probed at once); between
 * probes, the last answer for that key (platform_setting) marked `cached`.
 * Reachability and status only, never the upstream body or the key.
 */
export type SamHealth = {
  keyConfigured: boolean;
  apiReachable: boolean | null;
  status?: number;
  totalRecords?: number | null;
  message?: string;
  checkedAt?: string;
  cached?: boolean;
};

const SAM_BASE = "https://api.sam.gov/entity-information/v4/entities";
const LIVE_EVERY_SECONDS = 1800;
const SETTING = "samgov.health_last";
let memo: { at: number; key: string; body: SamHealth } | null = null;

/** For tests: forget this server's remembered answer. */
export function resetSamHealthMemo(): void {
  memo = null;
}

export async function samHealth(): Promise<SamHealth> {
  const cred = platformSamCredential({ audience: "operator" });
  if (!cred) {
    return { keyConfigured: false, apiReachable: false, message: samErrorMessage({ cls: "missing_key", source: "platform", audience: "operator" }) };
  }
  // Turns and answers belong to the key that was probed: a replaced key is probed at once.
  const key = createHash("sha256").update(cred.revealForSamRequest()).digest("hex").slice(0, 8);
  if (memo && memo.key === key && Date.now() - memo.at < 60_000) return { ...memo.body, cached: true };

  // One live probe per 30-minute window across servers. enforceRateLimit lets
  // a call through when its database fails (remaining = limit): not a turn.
  const turn = await enforceRateLimit({ key: `samgov:health-probe:${key}`, limit: 1, windowSeconds: LIVE_EVERY_SECONDS });
  if (!turn.ok || turn.remaining !== 0) {
    let last: (SamHealth & { key?: string }) | null = null;
    try {
      last = JSON.parse(await getPlatformSetting(SETTING, "null")) as (SamHealth & { key?: string }) | null;
    } catch {
      last = null;
    }
    const message = turn.ok
      ? "Live check skipped: FORGE couldn't reach its own database."
      : "A live check is running on another FORGE server; try again in a minute.";
    const { key: lastKey, ...stored } = last ?? {};
    const body: SamHealth = last && lastKey === key ? (stored as SamHealth) : { keyConfigured: true, apiReachable: null, message };
    memo = { at: Date.now(), key, body };
    return { ...body, cached: true };
  }

  const url = new URL(SAM_BASE);
  url.search = new URLSearchParams({ samRegistered: "Yes", registrationStatus: "A", page: "0", size: "1" }).toString();
  const r = await samGetText(cred, url, "health");
  let body: SamHealth;
  if (!r.ok) body = { keyConfigured: true, apiReachable: false, ...(r.status ? { status: r.status } : {}) };
  else {
    let totalRecords: number | null = null;
    try {
      const parsed: unknown = JSON.parse(r.text);
      const n = typeof parsed === "object" && parsed !== null && "totalRecords" in parsed ? (parsed as { totalRecords: unknown }).totalRecords : null;
      totalRecords = typeof n === "number" ? n : null;
    } catch {
      // Non-JSON upstream body — reachability is all we report.
    }
    body = { keyConfigured: true, apiReachable: true, status: r.status, totalRecords };
  }
  body.checkedAt = new Date().toISOString();
  memo = { at: Date.now(), key, body };
  try {
    await setPlatformSetting(SETTING, JSON.stringify({ ...body, key }), null);
  } catch (err) {
    log.warn("[samgov-health]", "could not keep the last answer", { error: err });
  }
  return body;
}
