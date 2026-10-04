"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { VOICE_LIMITS, houseStyleGuidance } from "@/lib/voice-logic";
import { updateHouseStyleAction } from "./voice-actions";

/**
 * BL-FB-GEN-VOICE Slice 2 — the team's house style: one set of writing
 * rules the drafter and chat receive for every section, whoever the
 * author is, under each author's own voice. Tenant admins edit it;
 * everyone can read it and see exactly what the AI is told.
 */
export function HouseStylePanel({ initialText, orgName, canEdit, className }: { initialText: string; orgName: string; canEdit: boolean; className?: string }) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const [showGuidance, setShowGuidance] = useState(false);
  const guidance = houseStyleGuidance(orgName, text);

  function save() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await updateHouseStyleAction(text);
      if (!res.ok) return setStatus({ kind: "err", message: res.error });
      setText(res.houseStyle);
      setSaved(res.houseStyle);
      setStatus({ kind: "ok" });
    });
  }

  return (
    <Panel title="House style" eyebrow={saved.trim() ? "Applied to every section" : "Not set"} accent="plum" className={className}>
      <p className="font-body text-[12px] leading-relaxed text-muted">
        The rules every section follows whoever writes it: words the team never uses, how sections open, how the customer is named, how numbers are written. The drafter and chat receive them for every section, under each author&apos;s own voice. One rule per line; it changes how things are said, never the facts.
      </p>
      <textarea
        className="aur-input mt-3 text-[12px]"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canEdit || pending}
        maxLength={VOICE_LIMITS.maxHouseStyleChars}
        placeholder={'Never say "leverage", "synergy" or "best-in-class".\nOpen every section with the customer’s outcome, not our history.\nName the agency the way the solicitation does.\nWrite numbers as numerals; spell out "percent".'}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-subtle">
          {text.length} / {VOICE_LIMITS.maxHouseStyleChars} characters{canEdit ? "" : " · organization admins edit this"}
        </span>
        {canEdit ? (
          <button type="button" disabled={pending || text === saved} onClick={save} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
            {pending ? "Saving…" : saved.trim() && !text.trim() ? "Clear house style" : "Save house style"}
          </button>
        ) : null}
      </div>
      {status.kind === "err" ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{status.message}</div> : null}
      {status.kind === "ok" ? <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">House style saved. Every next draft and chat turn follows it.</div> : null}
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
