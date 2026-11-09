"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { MAX_WIN_THEMES } from "@/lib/plan-charter-logic";
import type { CharterPanelView } from "@/lib/plan-charter-store";
import { draftCharterAction, reopenCharterAction, saveCharterAction, signCharterAction } from "./charter-actions";

type Result = { ok: true; note?: string } | { ok: false; error: string };

/** BL-NAV-LIFECYCLE 4c-1 (P-2) — the charter: written or drafted by FORGE AI from cited records, edited, then signed. The page remounts it (key) when a draft or signature arrives. */
export function CharterPanel({ opportunityId, view }: { opportunityId: string; view: CharterPanelView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const c = view.charter;
  const signed = view.status === "signed";
  const [strategy, setStrategy] = useState(c.strategy ?? "");
  const [pricing, setPricing] = useState(c.pricingPosture ?? "");
  const [share, setShare] = useState(c.partnerShare ?? "");
  const [discriminators, setDiscriminators] = useState((c.discriminators ?? []).join("\n"));
  const initialThemes = (c.winThemes ?? []).length > 0 ? c.winThemes ?? [] : view.proposalThemes;
  const [themes, setThemes] = useState<{ title: string; statement: string }[]>(initialThemes);

  function collect() {
    return {
      strategy,
      pricingPosture: pricing,
      partnerShare: share,
      discriminators: discriminators.split("\n"),
      winThemes: themes.filter((t) => t.title.trim()),
    };
  }

  function run(fn: () => Promise<Result>, after?: () => void) {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.note) setNote(res.note);
      after?.();
      router.refresh();
    });
  }

  const eyebrow = signed ? `Signed${view.signedByName ? ` by ${view.signedByName}` : ""}${view.signedAt ? ` · ${view.signedAt.slice(0, 10)}` : ""}` : view.status === "draft" ? "In draft" : "Not started";

  return (
    <Panel title="The charter" eyebrow={eyebrow}>
      {error ? <p className="mb-2 font-body text-[12px] text-red">{error}</p> : null}
      {note ? <p className="mb-2 font-body text-[12px] text-muted">{note}</p> : null}
      <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
        How the team means to win, in one place. FORGE AI can draft it from the decision, the capability matrix and the partners&apos; answers, citing each; you edit it and sign it. A signed charter is one of the gates to Develop, and changing it withdraws the signature.
      </p>
      <fieldset disabled={pending || signed} className="grid gap-3">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Bid strategy
          <textarea className="aur-input min-h-[90px] font-body text-[13px] normal-case tracking-normal" value={strategy} maxLength={2000} onChange={(e) => setStrategy(e.target.value)} />
        </label>
        <div className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Win themes (up to {MAX_WIN_THEMES}){view.hasProposal ? " · written to the proposal when you sign, if it has none" : ""}
          </span>
          {themes.map((t, i) => (
            <div key={i} className="grid gap-1 border-t border-layer/10 pt-2 md:grid-cols-[1fr_2fr_auto]">
              <input className="aur-input" aria-label={`Win theme ${i + 1} title`} placeholder="Title" value={t.title} maxLength={300} onChange={(e) => setThemes(themes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="aur-input" aria-label={`Win theme ${i + 1} statement`} placeholder="One sentence" value={t.statement} maxLength={2000} onChange={(e) => setThemes(themes.map((x, j) => (j === i ? { ...x, statement: e.target.value } : x)))} />
              <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={() => setThemes(themes.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          {themes.length < MAX_WIN_THEMES ? (
            <button type="button" className="aur-link w-fit font-mono text-[10px] uppercase tracking-widest" onClick={() => setThemes([...themes, { title: "", statement: "" }])}>
              Add a win theme
            </button>
          ) : null}
        </div>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Discriminators (one per line)
          <textarea className="aur-input min-h-[70px] font-body text-[13px] normal-case tracking-normal" value={discriminators} onChange={(e) => setDiscriminators(e.target.value)} />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
          Pricing posture
          <textarea className="aur-input min-h-[60px] font-body text-[13px] normal-case tracking-normal" value={pricing} maxLength={2000} onChange={(e) => setPricing(e.target.value)} />
        </label>
        {view.isPartner ? (
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
            The partner&apos;s share
            <input className="aur-input font-body text-[13px] normal-case tracking-normal" value={share} maxLength={300} onChange={(e) => setShare(e.target.value)} />
          </label>
        ) : null}
      </fieldset>
      {(c.sources ?? []).length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted">What the draft rested on ({c.sources?.length})</summary>
          <ol className="mt-2 list-decimal pl-5 font-body text-[12px] leading-[1.5] text-muted">
            {(c.sources ?? []).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {!signed && view.blockers.length > 0 && view.status !== "none" ? <p className="mt-3 font-body text-[12px] text-brass">To sign: {view.blockers.join(" ")}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {signed ? (
          <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => run(() => reopenCharterAction({ opportunityId }))}>
            Reopen the charter
          </button>
        ) : (
          <>
            <button type="button" className="aur-btn aur-btn-primary" disabled={pending || view.blockers.length > 0} onClick={() => run(async () => ((await saveCharterAction({ opportunityId, charter: collect() })).ok ? signCharterAction({ opportunityId }) : { ok: false, error: "Could not save the charter." }))}>
              Sign the charter
            </button>
            <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => saveCharterAction({ opportunityId, charter: collect() }))}>
              Save
            </button>
            <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" disabled={pending} onClick={() => run(() => draftCharterAction({ opportunityId }))}>
              {pending ? "Working…" : "Draft with FORGE AI"}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}
