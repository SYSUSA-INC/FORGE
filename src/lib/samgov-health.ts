import "server-only";
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
 * server; at most one live probe per 30 minutes across servers; between
 * probes, the last answer (stored in platform_setting) marked `cached`.
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
let memo: { at: number; body: SamHealth } | null = null;

/** For tests: forget this server's remembered answer. */
export function resetSamHealthMemo(): void {
  memo = null;
}

export async function samHealth(): Promise<SamHealth> {
  const cred = platformSamCredential({ audience: "operator" });
  if (!cred) {
    return { keyConfigured: false, apiReachable: false, message: samErrorMessage({ cls: "missing_key", source: "platform", audience: "operator" }) };
  }
  if (memo && Date.now() - memo.at < 60_000) return { ...memo.body, cached: true };

  // One live probe per window across servers. enforceRateLimit lets a call
  // through when its database fails (remaining = limit): that is not a turn.
  const turn = await enforceRateLimit({ key: "samgov:health-probe", limit: 1, windowSeconds: LIVE_EVERY_SECONDS });
  if (!turn.ok || turn.remaining !== 0) {
    let last: SamHealth | null = null;
    try {
      last = JSON.parse(await getPlatformSetting(SETTING, "null")) as SamHealth | null;
    } catch {
      last = null;
    }
    return { ...(last ?? { keyConfigured: true, apiReachable: null, message: "Checked recently; the next live check is within 30 minutes." }), cached: true };
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
  memo = { at: Date.now(), body };
  try {
    await setPlatformSetting(SETTING, JSON.stringify(body), null);
  } catch (err) {
    log.warn("[samgov-health]", "could not keep the last answer", { error: err });
  }
  return body;
}
