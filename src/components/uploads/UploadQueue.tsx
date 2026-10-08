"use client";

import { formatBytes } from "@/lib/upload-client-logic";
import type { UploadItem } from "./useUploadQueue";

const PHASE_LABEL: Record<UploadItem<unknown>["phase"], string> = {
  queued: "Waiting",
  uploading: "Uploading",
  verifying: "Checking",
  saving: "Saving",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function eta(sec: number | null): string {
  if (sec === null) return "";
  return sec >= 60 ? `${Math.round(sec / 60)} min left` : `${sec} s left`;
}

/** BL-STAB-2c — one row per file: name, size, progress, speed, time left, and retry / cancel / remove. */
export function UploadQueue<R>({
  items,
  onRetry,
  onCancel,
  onRemove,
}: {
  items: UploadItem<R>[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => {
        const pct = it.total > 0 ? Math.min(100, Math.round((it.loaded / it.total) * 100)) : 0;
        const active = it.phase === "uploading" || it.phase === "verifying" || it.phase === "saving";
        const failed = it.phase === "failed";
        return (
          <li key={it.id} className={`rounded-md border px-3 py-2 ${failed ? "border-rose/40 bg-rose/[0.05]" : "border-layer/15 bg-layer/[0.02]"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-[12px] text-text" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="font-mono text-[10px] text-muted">
                {formatBytes(it.file.size)} · {PHASE_LABEL[it.phase]}
                {it.phase === "uploading" && it.bytesPerSec ? ` · ${formatBytes(it.bytesPerSec)}/s · ${eta(it.etaSec)}` : ""}
              </span>
            </div>
            {it.phase !== "done" && it.phase !== "cancelled" ? (
              <div
                role="progressbar"
                aria-label={`Upload of ${it.file.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-layer/10"
              >
                <div className={`h-full ${failed ? "bg-rose" : "bg-teal"} transition-[width]`} style={{ width: `${failed ? 100 : pct}%` }} />
              </div>
            ) : null}
            {it.error ? <p className="mt-1 font-mono text-[11px] text-rose">{it.error}</p> : null}
            <div className="mt-1.5 flex gap-2">
              {failed || it.phase === "cancelled" ? (
                <button type="button" className="aur-btn aur-btn-ghost text-[10px]" onClick={() => onRetry(it.id)}>
                  Retry
                </button>
              ) : null}
              {active || it.phase === "queued" ? (
                <button type="button" className="aur-btn aur-btn-ghost text-[10px]" onClick={() => onCancel(it.id)}>
                  Cancel
                </button>
              ) : null}
              {!active ? (
                <button type="button" className="aur-btn aur-btn-ghost text-[10px]" onClick={() => onRemove(it.id)}>
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
