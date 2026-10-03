"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { VOICE_LIMITS, sampleWordCount } from "@/lib/voice-logic";
import { addMyVoiceSampleAction, rebuildMyVoiceAction, removeMyVoiceSampleAction, updateMyVoiceSettingsAction } from "./voice-actions";

type Profile = { enabled: boolean; traits: string[]; guidance: string; customGuidance: string; sampleCount: number; sampleWords: number; builtAt: string | null } | null;
type Sample = { id: string; title: string; words: number; createdAt: string };

/**
 * BL-FB-GEN-VOICE — "My writing voice": what the drafter and chat know
 * about how this author writes, built from their own sections and the
 * samples they paste here; a switch and a notes field to steer it.
 */
export function VoicePanel({ profile, samples, authorName }: { profile: Profile; samples: Sample[]; authorName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [notes, setNotes] = useState(profile?.customGuidance ?? "");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);
  const words = sampleWordCount(text);

  function run(fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, done?: (r: Record<string, unknown>) => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      done?.(res);
      router.refresh();
    });
  }

  function addSample(e: FormEvent) {
    e.preventDefault();
    run(
      () => addMyVoiceSampleAction({ title, text }),
      (r) => {
        setTitle("");
        setText("");
        setNotice(`Sample saved (${String(r.words)} words). Rebuild to fold it into your voice.`);
      },
    );
  }

  return (
    <Panel
      title="My writing voice"
      eyebrow={profile?.builtAt ? `Built ${new Date(profile.builtAt).toLocaleString()} · ${profile.sampleCount} sample${profile.sampleCount === 1 ? "" : "s"} · ${profile.sampleWords.toLocaleString()} words` : "Not built yet"}
      accent="plum"
      actions={
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => rebuildMyVoiceAction(), (r) => setNotice(`Voice rebuilt from ${String(r.sections)} section${r.sections === 1 ? "" : "s"} and ${String(r.pasted)} pasted sample${r.pasted === 1 ? "" : "s"}.`))}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50"
        >
          {pending ? "Reading…" : profile?.builtAt ? "Rebuild from my writing" : "Build my voice"}
        </button>
      }
    >
      <p className="font-body text-[12px] leading-relaxed text-muted">
        When the drafter or chat works a section you own, it writes the way you write: sentence length and rhythm, active or passive, plain or technical words, &quot;we&quot; or &quot;you&quot;,
        contractions, numbers, lists, your openers and phrases. It learns from the sections authored by you in this organization (at least {VOICE_LIMITS.minSampleWords} words each) and anything you paste below.
      </p>
      {error ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      {notice ? <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">{notice}</div> : null}

      {profile?.traits.length ? (
        <div className="mt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">How {authorName} writes</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {profile.traits.map((t) => (
              <li key={t} className="rounded border border-plum-400/40 bg-plum-400/10 px-2 py-0.5 font-body text-[11px] text-plum-300">
                {t}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setShowGuidance((v) => !v)} className="mt-2 font-mono text-[9px] uppercase tracking-widest text-subtle hover:text-text">
            {showGuidance ? "Hide" : "Show"} what the AI is told
          </button>
          {showGuidance ? <pre className="mt-1 whitespace-pre-wrap rounded-md border border-layer/10 bg-layer/[0.02] p-3 font-mono text-[11px] leading-relaxed text-muted">{profile.guidance}</pre> : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-layer/10 bg-layer/[0.02] p-3">
          <label className="flex cursor-pointer items-center gap-2 font-body text-[12px] text-text">
            <input type="checkbox" className="accent-teal-400" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Write my sections in my voice
          </label>
          <label className="aur-label mt-3">Notes for the AI (optional)</label>
          <textarea
            className="aur-input text-[12px]"
            rows={3}
            maxLength={VOICE_LIMITS.maxCustomChars}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "Never use leverage or synergy. Open sections with the customer’s outcome, not our history."'
          />
          <button type="button" disabled={pending} onClick={() => run(() => updateMyVoiceSettingsAction({ enabled, customGuidance: notes }), () => setNotice("Voice settings saved."))} className="aur-btn aur-btn-ghost mt-2 text-[11px] disabled:opacity-50">
            Save settings
          </button>
        </div>
        <form onSubmit={addSample} className="rounded-md border border-layer/10 bg-layer/[0.02] p-3">
          <label className="aur-label">Paste something you wrote</label>
          <input className="aur-input text-[12px]" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={VOICE_LIMITS.maxTitleChars} placeholder="Title (optional) — e.g. Past performance write-up, 2025" />
          <textarea className="aur-input mt-2 text-[12px]" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={VOICE_LIMITS.maxSampleChars} placeholder="A section, a white paper, an email thread you are proud of…" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={`font-mono text-[10px] ${words >= VOICE_LIMITS.minSampleWords ? "text-emerald" : "text-subtle"}`}>
              {words} / {VOICE_LIMITS.minSampleWords} words
            </span>
            <button type="submit" disabled={pending || words < VOICE_LIMITS.minSampleWords} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50">
              Add sample
            </button>
          </div>
          {samples.length > 0 ? (
            <ul className="mt-3 divide-y divide-layer/5 border-t border-layer/10">
              {samples.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 font-mono text-[11px] text-muted">
                  <span className="min-w-0 truncate">
                    {s.title || "Untitled sample"} · {s.words} words · {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                  <button type="button" disabled={pending} onClick={() => run(() => removeMyVoiceSampleAction(s.id))} className="shrink-0 uppercase tracking-widest hover:text-rose-300">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
      </div>
    </Panel>
  );
}
