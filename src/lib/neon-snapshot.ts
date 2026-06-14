import { log } from "@/lib/log";

/**
 * BL-QC-auto-migrate — Neon branch snapshot helper.
 *
 * Before auto-applying migrations, snapshot the current production
 * branch so a failed apply or downstream-breaking change can be
 * rolled back by restoring the snapshot via the Neon dashboard.
 *
 * Two operating modes:
 *
 *   - **Configured**: `NEON_API_KEY` and `NEON_PROJECT_ID` are set
 *     (same env vars used by the per-PR Neon branch lifecycle).
 *     `tryCreateBranchSnapshot` calls the Neon API and returns the
 *     created branch's id. The branch acts as a point-in-time
 *     snapshot — it's a copy-on-write replica that can be restored
 *     by promoting it back to primary.
 *
 *   - **Not configured**: returns `null`. Auto-apply still runs;
 *     rollback in that case falls back on Neon's built-in
 *     point-in-time recovery (7-day window on Pro).
 *
 * Snapshots accumulate by default. Cleanup is left to the operator
 * — they're cheap on Neon (copy-on-write) but if drift grows large,
 * delete via the Neon dashboard. Future enhancement: auto-prune
 * snapshots older than N days, configurable via env.
 */

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const NEON_API_TIMEOUT_MS = 10_000;

export async function tryCreateBranchSnapshot(
  name: string,
): Promise<string | null> {
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) {
    log.info("[neon-snapshot]", "skipped — neon api not configured", {
      hasApiKey: !!apiKey,
      hasProjectId: !!projectId,
    });
    return null;
  }

  // Parent branch — usually the production branch. Operator can
  // override via env if their primary branch isn't named "main".
  const parentBranchName = process.env.NEON_BRANCH_PARENT || "main";

  try {
    // First, look up the parent branch's id so we can ask Neon to
    // copy from it specifically (the API supports both name + id).
    const branchListUrl = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches`;
    const listResp = await fetchWithTimeout(branchListUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!listResp.ok) {
      log.warn("[neon-snapshot]", "branch-list failed", {
        status: listResp.status,
        statusText: listResp.statusText,
      });
      return null;
    }
    const listJson = (await listResp.json()) as {
      branches?: { id: string; name: string; primary?: boolean }[];
    };
    const branches = listJson.branches ?? [];
    const parent =
      branches.find((b) => b.name === parentBranchName) ??
      branches.find((b) => b.primary);
    if (!parent) {
      log.warn("[neon-snapshot]", "parent branch not found", {
        looked_for: parentBranchName,
        branch_count: branches.length,
      });
      return null;
    }

    // Create the snapshot branch.
    const createUrl = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches`;
    const createResp = await fetchWithTimeout(createUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        branch: {
          name,
          parent_id: parent.id,
        },
      }),
    });
    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "");
      log.warn("[neon-snapshot]", "branch-create failed", {
        status: createResp.status,
        statusText: createResp.statusText,
        body: errText.slice(0, 500),
      });
      return null;
    }
    const createJson = (await createResp.json()) as {
      branch?: { id: string; name: string };
    };
    const snapshotId = createJson.branch?.id ?? null;
    if (snapshotId) {
      log.info("[neon-snapshot]", "created", {
        snapshotId,
        name,
        parent: parent.name,
      });
    }
    return snapshotId;
  } catch (err) {
    log.warn("[neon-snapshot]", "create-snapshot failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEON_API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
