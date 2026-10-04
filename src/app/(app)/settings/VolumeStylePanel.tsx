"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { VOICE_LIMITS, VOLUME_KINDS, VOLUME_LABELS, volumeStyleGuidance, type VolumeKind } from "@/lib/voice-logic";
import { updateVolumeStyleAction } from "./voice-actions";

/**
 * BL-FB-GEN-VOICE Slice 3 — extra house-style rules for one volume (a
 * section kind): the price volume's conventions aren't the technical
 * volume's. They apply on top of the team's house style, before each
 * author's own voice. Tenant admins edit; everyone can read.
 */
export function VolumeStylePanel({
  initial,
  orgName,
  canEdit,
  className,
}: {
  initial: Partial<Record<VolumeKind, string>>;
  orgName: string;
  canEdit: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initial);
  const [volume, setVolume] = useState<VolumeKind>("technical");
  const [text, setText] = useState(initial.technical ?? "");
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const [showGuidance, setShowGuidance] = useState(false);
  const current = saved[volume] ?? "";
  const guidance = volumeStyleGuidance(orgName, volume, text);
  const setCount = VOLUME_KINDS.filter((k) => (saved[k] ?? "").trim()).length;

  function pick(next: VolumeKind) {
    setVolume(next);
    setText(saved[next] ?? "");
    setStatus({ kind: "idle" });
  }

  function save() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await updateVolumeStyleAction({ volume, text });
      if (!res.ok) return setStatus({ kind: "err", message: res.error });
      setSaved((s) => ({ ...s, [volume]: res.text }));
      setText(res.text);
      setStatus({ kind: "ok" });
    });
  }

  return (
    <Panel title="House style by volume" eyebrow={setCount > 0 ? `${setCount} volume${setCount === 1 ? "" : "s"} with extra rules` : "None set"} accent="plum" className={className}>
      <p className="font-body text-[12px] leading-relaxed text-muted">
        Extra rules for one volume only, on top of the house style above — the price volume&apos;s conventions aren&apos;t the technical volume&apos;s. A section&apos;s volume is its kind. One rule per line.
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {VOLUME_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            disabled={pending}
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] ${k === volume ? "border-plum/40 bg-plum/10 text-text" : "border-layer/10 text-muted hover:text-text"}`}
          >
            {VOLUME_LABELS[k]}
            {(saved[k] ?? "").trim() ? " •" : ""}
          </button>
        ))}
      </div>
      <textarea
        className="aur-input mt-3 text-[12px]"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canEdit || pending}
        maxLength={VOICE_LIMITS.maxHouseStyleChars}
        placeholder={volume === "pricing" ? "State every price as a firm, fully burdened figure.\nNever round labor rates." : "Lead with the evaluator's benefit, then the method.\nName every key person with their role."}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-subtle">
          {VOLUME_LABELS[volume]} · {text.length} / {VOICE_LIMITS.maxHouseStyleChars}
          {canEdit ? "" : " · organization admins edit this"}
        </span>
        {canEdit ? (
          <button type="button" disabled={pending || text === current} onClick={save} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
            {pending ? "Saving…" : current.trim() && !text.trim() ? `Clear ${VOLUME_LABELS[volume]} rules` : `Save ${VOLUME_LABELS[volume]} rules`}
          </button>
        ) : null}
      </div>
      {status.kind === "err" ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{status.message}</div> : null}
      {status.kind === "ok" ? <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">Saved. Drafts and chat in {VOLUME_LABELS[volume]} sections follow it.</div> : null}
      {guidance ? (
        <div className="mt-3">
          <button type="button" onClick={() => setShowGuidance((v) => !v)} className="font-mono text-[9px] uppercase tracking-widest text-subtle hover:text-text">
            {showGuidance ? "Hide" : "Show"} what the AI is told
          </button>
          {showGuidance ? <pre className="mt-1 whitespace-pre-wrap rounded-md border border-layer/10 bg-layer/[0.02] p-3 font-mono text-[11px] leading-relaxed text-muted">{guidance}</pre> : null}
        </div>
      ) : null}
    </Panel>
  );
}
