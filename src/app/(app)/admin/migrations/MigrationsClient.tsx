"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markMigrationsAppliedThroughAction,
  runMigrationsAction,
  type MigrationStatusResult,
  type RunMigrationsActionResult,
} from "./actions";

type SyncResult =
  | { ok: true; markedFilenames: string[]; alreadyPresentFilenames: string[] }
  | { ok: false; error: string };

export function MigrationsClient({
  initialStatus,
}: {
  initialStatus: MigrationStatusResult;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();
  const [lastResult, setLastResult] = useState<RunMigrationsActionResult | null>(
    null,
  );
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const appliedSet = new Set(initialStatus.appliedFiles);

  // "Sync ledger" affordance shows only when the ledger looks
  // suspiciously empty for a long-lived DB — specifically when we
  // see *multiple* pending migrations sitting before the newest one.
  // A single pending migration is the normal post-deploy state; that
  // hides the affordance so it's not a footgun in steady-state.
  const orphanCandidates = useMemo(() => {
    if (initialStatus.pendingFiles.length < 2) return [];
    // All pending files EXCEPT the latest. The latest is presumed to
    // be a genuinely-new migration the operator wants to run normally;
    // everything before it is the orphan tail.
    const sorted = [...initialStatus.pendingFiles].sort();
    return sorted.slice(0, -1);
  }, [initialStatus.pendingFiles]);

  const [throughChoice, setThroughChoice] = useState<string>(
    orphanCandidates[orphanCandidates.length - 1] ?? "",
  );
  const [confirmText, setConfirmText] = useState("");
  const confirmExpected = "I VERIFIED";

  function apply() {
    setLastResult(null);
    startTransition(async () => {
      const result = await runMigrationsAction();
      setLastResult(result);
      router.refresh();
    });
  }

  function syncLedger() {
    if (!throughChoice) return;
    setLastSync(null);
    startSync(async () => {
      const result = await markMigrationsAppliedThroughAction(throughChoice);
      setLastSync(result);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {orphanCandidates.length > 0 ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/[0.06] p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="font-display text-[13px] font-semibold text-amber-200">
              Ledger sync needed?
            </div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300">
              {orphanCandidates.length} orphan candidate
              {orphanCandidates.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="font-mono text-[11px] text-muted">
            {orphanCandidates.length} migration
            {orphanCandidates.length === 1 ? " is" : "s are"} marked pending
            but the schema already includes their tables — typical of a DB
            populated via <code>scripts/apply-schema.mjs</code> or drizzle-kit
            before the runtime ledger existed. Re-running them is risky for
            any file with non-idempotent UPDATE statements (
            <strong>0013</strong> would clobber rich-text formatting on
            proposal sections). Sync the ledger first, then apply just the
            genuinely-new migration.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">
                Mark applied through (inclusive)
              </span>
              <select
                className="aur-input min-w-[280px]"
                value={throughChoice}
                onChange={(e) => setThroughChoice(e.target.value)}
              >
                {orphanCandidates.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/80">
                Type <code className="rounded bg-white/5 px-1">{confirmExpected}</code> to confirm
              </span>
              <input
                className="aur-input min-w-[160px]"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmExpected}
              />
            </label>
            <button
              type="button"
              onClick={syncLedger}
              disabled={
                syncing ||
                !throughChoice ||
                confirmText.trim().toUpperCase() !== confirmExpected
              }
              className="aur-btn aur-btn-primary text-[12px] disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync ledger"}
            </button>
          </div>
          {lastSync ? (
            <div
              className={`mt-3 rounded-md border px-3 py-2 font-mono text-[11px] ${
                lastSync.ok
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : "border-rose/40 bg-rose/10 text-rose"
              }`}
            >
              {lastSync.ok ? (
                <>
                  Marked {lastSync.markedFilenames.length} as applied.
                  {lastSync.alreadyPresentFilenames.length > 0 ? (
                    <span className="ml-2 text-muted">
                      · {lastSync.alreadyPresentFilenames.length} were already
                      in the ledger.
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <strong>Failed:</strong> {lastSync.error}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={apply}
          disabled={pending || initialStatus.pendingFiles.length === 0}
          className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
        >
          {pending
            ? "Applying…"
            : initialStatus.pendingFiles.length === 0
              ? "Nothing to apply"
              : `Apply ${initialStatus.pendingFiles.length} pending migration${initialStatus.pendingFiles.length === 1 ? "" : "s"}`}
        </button>
        {initialStatus.pendingFiles.length === 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">
            ● Schema in sync
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-rose">
            ● Schema behind
          </span>
        )}
      </div>

      {lastResult ? (
        <div
          className={`rounded-md border px-3 py-2 font-mono text-[11px] ${
            lastResult.ok
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : "border-rose/40 bg-rose/10 text-rose"
          }`}
        >
          {lastResult.ok ? (
            <>
              {lastResult.appliedFilenames.length === 0
                ? "No new migrations to apply (already in sync)."
                : `Applied ${lastResult.appliedFilenames.length}: ${lastResult.appliedFilenames.join(", ")}`}
              {lastResult.skippedFilenames.length > 0 ? (
                <span className="ml-2 text-muted">
                  · {lastResult.skippedFilenames.length} already applied
                </span>
              ) : null}
            </>
          ) : (
            <>
              <strong>Failed:</strong> {lastResult.error}
              {lastResult.appliedFilenames.length > 0 ? (
                <div className="mt-1 text-muted">
                  Successfully applied before failure: {lastResult.appliedFilenames.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-white/[0.02]">
        <div className="border-b border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
          Migrations
        </div>
        <ul className="flex flex-col">
          {initialStatus.expectedFiles.length === 0 ? (
            <li className="px-3 py-3 font-mono text-[11px] text-muted">
              No migration files found. The drizzle/ folder may not be bundled
              into the deployed function — confirm next.config.mjs includes
              <code className="mx-1">outputFileTracingIncludes</code> for
              <code className="mx-1">drizzle/*.sql</code>.
            </li>
          ) : (
            initialStatus.expectedFiles.map((file) => {
              const applied = appliedSet.has(file);
              return (
                <li
                  key={file}
                  className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 font-mono text-[11px] last:border-0"
                >
                  <span className="text-text">{file}</span>
                  <span
                    className={
                      applied
                        ? "text-emerald-300"
                        : "text-amber-300"
                    }
                  >
                    {applied ? "● applied" : "○ pending"}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
