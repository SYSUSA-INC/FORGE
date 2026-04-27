"use client";

import { useState, useTransition } from "react";
import type { TipTapDoc } from "@/db/schema";
import {
  generateSectionDraftAction,
  type SectionDraftResult,
} from "./actions";
import type { SectionDraftMode } from "@/lib/ai-prompts";

type Success = Extract<SectionDraftResult, { ok: true }>;

type Props = {
  sectionId: string;
  hasContent: boolean;
  onAccept: (bodyDoc: TipTapDoc, plain: string, words: number) => void;
};

const MODES: { key: SectionDraftMode; label: string; description: string }[] = [
  {
    key: "draft",
    label: "Draft",
    description: "Generate a first draft from the proposal context.",
  },
  {
    key: "improve",
    label: "Improve",
    description:
      "Tighten prose, surface themes, fix weak phrasing — keep facts.",
  },
  {
    key: "tighten",
    label: "Tighten",
    description: "Cut to fit the section's page cap. Keep every fact.",
  },
];

export function AiAssistantPanel({ sectionId, hasContent, onAccept }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Success | null>(null);
  const [mode, setMode] = useState<SectionDraftMode>(
    hasContent ? "improve" : "draft",
  );

  function generate(forMode: SectionDraftMode) {
    setError(null);
    setResult(null);
    setMode(forMode);
    startTransition(async () => {
      const res = await generateSectionDraftAction({
        sectionId,
        mode: forMode,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
  }

  function accept() {
    if (!result) return;
    const words = result.text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    onAccept(result.bodyDoc, result.text, words);
    setOpen(false);
    setResult(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="aur-btn aur-btn-ghost text-[11px]"
      >
        ✨ AI assist
      </button>
    );
  }

  return (
    <div className="rounded-md border border-teal/40 bg-teal/[0.04] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
          ✨ AI assist
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
            setError(null);
          }}
          className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
        >
          Close
        </button>
      </div>

      {!result ? (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            {MODES.map((m) => {
              const disabled =
                pending ||
                ((m.key === "improve" || m.key === "tighten") && !hasContent);
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => generate(m.key)}
                  className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                    pending && mode === m.key
                      ? "border-teal/60 bg-teal/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <span className="font-display text-[13px] font-semibold text-text">
                    {m.label}
                  </span>
                  <span className="font-body text-[11px] leading-relaxed text-muted">
                    {m.description}
                  </span>
                </button>
              );
            })}
          </div>
          {pending ? (
            <div className="mt-2 font-mono text-[10px] text-muted">
              Generating…
            </div>
          ) : null}
          {error ? (
            <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
            {MODES.find((m) => m.key === result.mode)?.label} preview ·{" "}
            {result.text.split(/\s+/).filter(Boolean).length} words
          </div>
          <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-white/10 bg-canvas px-3 py-2 font-body text-[13px] leading-relaxed text-text">
            {result.text}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-subtle">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {result.stubbed ? (
                <span className="text-rose">stub mode</span>
              ) : null}
              <span>{result.provider}</span>
              <span>{result.model}</span>
              {typeof result.inputTokens === "number" ? (
                <span>in {result.inputTokens}</span>
              ) : null}
              {typeof result.outputTokens === "number" ? (
                <span>out {result.outputTokens}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => generate(result.mode)}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={accept}
                className="aur-btn aur-btn-primary text-[11px]"
              >
                Replace section with this
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
