"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { relabelEnvMarkerAction, type EnvMarkerStatus } from "./actions";

/**
 * BL-ENV-SEP — relabel the database's environment marker. A cutover
 * tool, not a routine control: after relabelling, any deploy whose
 * runtime label differs from the marker refuses to boot.
 */
export function EnvMarkerClient({ status }: { status: EnvMarkerStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState<string>(status.marker?.expectedEnv ?? status.runtime ?? "staging");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<
    { ok: true; previous: string | null; label: string } | { ok: false; error: string } | null
  >(null);

  const unchanged = status.marker?.expectedEnv === label;
  const confirmed = confirmation.trim() === label.toUpperCase();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const r = await relabelEnvMarkerAction({ label, confirmation });
      setResult(r);
      if (r.ok) {
        setConfirmation("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/[0.04] p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200">
        Relabel marker (cutover only)
      </div>
      <p className="font-body text-[12px] leading-relaxed text-muted">
        Use this when a database changes hands between environments (for
        example a former production database becoming staging). After
        relabelling, the next boot of any deploy whose runtime label is
        not <strong>{label}</strong> will refuse to start.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          New label
          <select
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setConfirmation("");
            }}
            className="aur-input min-w-[10rem] font-mono text-[12px] normal-case tracking-normal"
          >
            {status.knownLabels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Type {label.toUpperCase()} to confirm
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={label.toUpperCase()}
            autoComplete="off"
            className="aur-input min-w-[12rem] font-mono text-[12px] normal-case tracking-normal"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending || unchanged || !confirmed}
          className="aur-btn text-[12px] disabled:opacity-60"
        >
          {pending ? "Relabelling…" : unchanged ? "Marker already set" : "Relabel marker"}
        </button>
      </div>
      {result ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 font-mono text-[11px] ${
            result.ok
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : "border-rose/40 bg-rose/10 text-rose"
          }`}
        >
          {result.ok
            ? `Marker set to ${result.label}${result.previous ? ` (was ${result.previous})` : ""}. Deploys labelled otherwise will refuse to boot.`
            : result.error}
        </div>
      ) : null}
    </div>
  );
}
