"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { harvestProposalToCorpusAction } from "./harvest-actions";
import type { BrainMineStatus } from "./brain-actions";

const OUTCOME_TONE: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  won: {
    label: "WON",
    color: "#34d399",
    bg: "rgba(52,211,153,0.08)",
    border: "rgba(52,211,153,0.30)",
  },
  lost: {
    label: "LOST",
    color: "#f87171",
    bg: "rgba(248,113,113,0.08)",
    border: "rgba(248,113,113,0.30)",
  },
  no_bid: {
    label: "NO BID",
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.06)",
    border: "rgba(148,163,184,0.30)",
  },
  withdrawn: {
    label: "WITHDRAWN",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.08)",
    border: "rgba(251,191,36,0.30)",
  },
  none: {
    label: "UNTAGGED",
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.06)",
    border: "rgba(148,163,184,0.30)",
  },
};

export function BrainMinePanel({
  proposalId,
  initial,
}: {
  proposalId: string;
  initial: BrainMineStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<BrainMineStatus>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function mineNow() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await harvestProposalToCorpusAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `${res.reused ? "Re-harvested" : "Harvested"} into the Brain — ${res.candidateCount} candidate entr${res.candidateCount === 1 ? "y" : "ies"} ready for review, ${res.embeddedChunks} chunks embedded.`,
      );
      setStatus((prev) => ({
        ...prev,
        mined: true,
        artifactId: res.artifactId,
        candidateCount: res.candidateCount,
        harvestedAt: new Date().toISOString(),
      }));
      router.refresh();
    });
  }

  const outcomeIsWin = status.outcomeType === "won";
  const outcomeTone =
    OUTCOME_TONE[status.outcomeLabel] ?? OUTCOME_TONE.none!;

  return (
    <Panel
      title="Brain mining"
      eyebrow={
        status.mined
          ? "Indexed for future retrieval"
          : outcomeIsWin
            ? "Promote this win into the Brain"
            : "Submit or mark won to feed the Brain"
      }
      actions={
        <button
          type="button"
          onClick={mineNow}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          title={
            status.mined
              ? "Re-run the harvest to pick up new content edits."
              : "Index this proposal's content into the Brain so future drafts can retrieve from it."
          }
        >
          {pending
            ? "Mining…"
            : status.mined
              ? "Re-mine"
              : "Mine into Brain"}
        </button>
      }
    >
      <p className="font-body text-[12px] leading-relaxed text-muted">
        FORGE&apos;s Brain learns from your past proposals. Mining indexes
        this proposal&apos;s sections so future section drafts and Brain
        Suggest can retrieve from actual content you&apos;ve already
        delivered — not generic prose. Outcome-tagged content (won /
        lost) further steers drafts toward proven-winning patterns.
      </p>

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Mined" value={status.mined ? "Yes" : "No"} />
        <Stat
          label="Outcome label"
          value={outcomeTone.label}
          color={outcomeTone.color}
        />
        <Stat label="Candidates" value={String(status.candidateCount)} />
        <Stat label="Promoted" value={String(status.promotedCount)} />
      </dl>

      {status.harvestedAt ? (
        <div className="mt-3 font-mono text-[10px] text-subtle">
          Last harvested {new Date(status.harvestedAt).toLocaleString()}
        </div>
      ) : null}

      {status.artifactId ? (
        <div className="mt-3">
          <Link
            href={`/knowledge-base/import/${status.artifactId}`}
            className="font-mono text-[10px] uppercase tracking-widest text-teal underline hover:text-text"
          >
            View artifact + candidates →
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-subtle">
        {label}
      </div>
      <div
        className="mt-1 font-mono text-[12px] tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
