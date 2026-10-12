"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runSamNoticeLoadNowAction, setSamNoticeSwitchAction, spotCheckSamNoticesAction } from "./actions";

const SPOT_LABELS = {
  same: "same text",
  different: "different text",
  missing_in_file: "SAM.gov has text where the file is empty",
  not_at_sam: "SAM.gov has no description",
  unread: "couldn't be read",
} as const;

/** BL-STAB-10b — run the load now, flip the switches, spot-check against SAM.gov. */
export function SamNoticeControls({ switches }: { switches: { load: boolean; reads: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; text: string }>) =>
    start(async () => {
      setNote(null);
      try {
        setNote(await fn());
      } catch {
        setNote({ ok: false, text: "FORGE didn't answer in time. Check the runs below in a minute." });
      }
      router.refresh();
    });
  const toggle = (name: "load" | "reads", on: boolean) =>
    act(async () => {
      const r = await setSamNoticeSwitchAction({ name, on });
      return r.ok ? { ok: true, text: `${name === "load" ? "Nightly load" : "Search reads"} ${on ? "on" : "paused"}.` } : { ok: false, text: r.error };
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = await runSamNoticeLoadNowAction();
              if (!r.ok) return { ok: false, text: r.error };
              const s = r.result;
              return { ok: s.status === "ok" || s.status === "unchanged", text: `${s.status}: ${s.rowsSeen.toLocaleString("en-US")} notices read, ${s.rowsWritten.toLocaleString("en-US")} written${s.error ? ` — ${s.error}` : ""}` };
            })
          }
        >
          {pending ? "Working…" : "Run load now"}
        </button>
        <button
          type="button"
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
          disabled={pending}
          title="Reads 13 stored notices live from SAM.gov on the shared key (three times a day)"
          onClick={() =>
            act(async () => {
              const r = await spotCheckSamNoticesAction();
              if (!r.ok) return { ok: false, text: r.error };
              const parts = (Object.keys(SPOT_LABELS) as (keyof typeof SPOT_LABELS)[]).filter((k) => r.counts[k] > 0).map((k) => `${r.counts[k]} ${SPOT_LABELS[k]}`);
              return { ok: r.counts.same === r.sampled, text: `Spot-check of ${r.sampled}: ${parts.join(" · ")}` };
            })
          }
        >
          Spot-check against SAM.gov
        </button>
        <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={pending} onClick={() => toggle("load", !switches.load)}>
          {switches.load ? "Pause nightly load" : "Resume nightly load"}
        </button>
        <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={pending} onClick={() => toggle("reads", !switches.reads)}>
          {switches.reads ? "Stop searches reading the copy" : "Let searches read the copy"}
        </button>
      </div>
      {note ? <p className={`font-mono text-[11px] ${note.ok ? "text-emerald" : "text-rose"}`}>{note.text}</p> : null}
    </div>
  );
}
