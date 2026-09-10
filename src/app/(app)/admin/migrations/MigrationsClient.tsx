"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runMigrationsAction,
  type MigrationStatusResult,
  type RunMigrationsActionResult,
} from "./actions";

export function MigrationsClient({
  initialStatus,
}: {
  initialStatus: MigrationStatusResult;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<RunMigrationsActionResult | null>(
    null,
  );

  const [acknowledged, setAcknowledged] = useState(false);

  const appliedSet = new Set(initialStatus.appliedFiles);
  const needsAck = lastResult !== null && !lastResult.ok && lastResult.needsAcknowledgement === true;

  function apply(acknowledgeDestructive = false) {
    setLastResult(null);
    startTransition(async () => {
      const result = await runMigrationsAction({ acknowledgeDestructive });
      setLastResult(result);
      if (result.ok || !result.needsAcknowledgement) setAcknowledged(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => apply(false)}
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
              <strong>{needsAck ? "Acknowledgement required:" : "Failed:"}</strong> {lastResult.error}
              {lastResult.appliedFilenames.length > 0 ? (
                <div className="mt-1 text-muted">
                  Successfully applied before failure: {lastResult.appliedFilenames.join(", ")}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {needsAck && lastResult && !lastResult.ok && lastResult.destructive ? (
        <div className="rounded-md border border-rose/40 bg-rose/[0.06] p-3">
          <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-rose">
            Production — destructive operations pending
          </div>
          <ul className="flex flex-col gap-1 font-mono text-[11px] text-muted">
            {lastResult.destructive.map((d) => (
              <li key={d.filename}>
                <span className="text-text">{d.filename}</span>{" "}
                <span className="text-rose/80">contains: {d.matches.join(", ")}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 font-body text-[12px] leading-relaxed text-text">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-rose"
            />
            I have taken a Neon snapshot, reviewed each destructive migration
            above, and accept that this cannot be undone by rollback.
          </label>
          <button
            type="button"
            onClick={() => apply(true)}
            disabled={pending || !acknowledged}
            className="aur-btn mt-3 text-[12px] disabled:opacity-60"
          >
            {pending ? "Applying…" : "Apply with acknowledgement"}
          </button>
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
