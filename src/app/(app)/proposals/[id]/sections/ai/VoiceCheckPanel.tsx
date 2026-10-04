"use client";

import { useEffect, useState } from "react";
import { VOICE_LIMITS, buildVoiceFixHint, compareVoice, measureVoice, voiceCheckSummary, type VoiceFinding } from "@/lib/voice-logic";
import { sectionVoiceProfileAction } from "./voice-check-actions";

type Metrics = NonNullable<ReturnType<typeof measureVoice>>;
type Profile = { author: string; metrics: Metrics };

const DEBOUNCE_MS = 800;

/**
 * BL-FB-GEN-VOICE Slice 2 — does this draft read like its author? The
 * author's measured profile is fetched once; the draft is measured in
 * the browser as they type and compared against it (no model call).
 * **Fix with AI** opens Improve mode with the differences as guidance.
 * Renders nothing when the author has no enabled voice profile.
 */
export function VoiceCheckPanel({
  sectionId,
  text,
  enabled,
  onFix,
  fixBusy,
}: {
  sectionId: string;
  /** The section as plain text, updated on every keystroke. */
  text: string;
  /** False when the section's author has no voice profile: no fetch, no panel. */
  enabled: boolean;
  onFix: (hint: string) => void;
  fixBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  /** null = the draft is too short to compare. */
  const [findings, setFindings] = useState<VoiceFinding[] | null>(null);

  useEffect(() => {
    if (!enabled) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    sectionVoiceProfileAction(sectionId)
      .then((p) => {
        if (!cancelled) setProfile(p ? { author: p.author, metrics: p.metrics } : null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sectionId, enabled]);

  useEffect(() => {
    if (!profile) return;
    const t = setTimeout(() => {
      const m = measureVoice(text);
      setFindings(m ? compareVoice(m, profile.metrics) : null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, profile]);

  if (!profile || !text.trim()) return null;
  const worst = findings === null ? "none" : findings.some((f) => f.severity === "high") ? "high" : findings.length > 0 ? "medium" : "none";
  const frame = worst === "high" ? "border-rose-400/30 bg-rose-400/5" : worst === "medium" ? "border-amber-400/30 bg-amber-400/5" : "border-plum-400/30 bg-plum-400/5";
  const accent = worst === "high" ? "text-rose-300" : worst === "medium" ? "text-amber-200" : "text-plum-300";
  const hint = findings ? buildVoiceFixHint(findings, profile.author) : "";

  return (
    <div className={`rounded-lg border ${frame}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className={`font-mono text-[10px] uppercase tracking-[0.22em] ${accent}`}>
          ✦ Voice · {findings === null ? `${VOICE_LIMITS.checkMinWords}+ words to compare with ${profile.author}` : voiceCheckSummary(findings, profile.author)}
        </span>
        <span className="font-mono text-[10px] text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-layer/10 px-3 py-2">
          {findings === null ? (
            <p className="font-body text-[12px] text-muted">Keep writing; the draft is compared with {profile.author}&apos;s profile once it is {VOICE_LIMITS.checkMinWords} words long.</p>
          ) : findings.length === 0 ? (
            <p className="font-body text-[12px] text-muted">Sentence length, voice, vocabulary and register all sit where {profile.author} usually writes.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {findings.map((f) => (
                <li key={f.kind} className="flex items-start gap-2">
                  <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${f.severity === "high" ? "bg-rose-400" : "bg-amber-400"}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{f.label}</span>
                    <div className="font-body text-[12px] leading-relaxed text-text">{f.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="font-body text-[11px] text-muted">Checked in your browser against {profile.author}&apos;s voice profile as you type.</span>
            {hint ? (
              <button
                type="button"
                className="aur-btn aur-btn-ghost shrink-0 text-[11px]"
                disabled={fixBusy}
                onClick={() => onFix(hint)}
                title={`Open Improve mode with these differences as guidance; the result arrives as tracked changes in ${profile.author}'s voice.`}
              >
                {fixBusy ? "Fixing…" : `✨ Rewrite in ${profile.author.split(" ")[0]}'s voice`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
