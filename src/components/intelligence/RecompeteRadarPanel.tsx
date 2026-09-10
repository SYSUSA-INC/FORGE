import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { formatMoney } from "@/lib/customer-patterns";
import { reasonLabel } from "@/lib/loss-patterns";
import { confidenceLabel, type RecompeteMatch } from "@/lib/recompete-match";
import {
  getRecompeteForOpportunity,
  getRecompeteForSolicitation,
} from "@/lib/recompete-radar";

/**
 * BL-FB-WIN-RECOMPETE — "you have bid this before". Renders nothing when
 * the radar finds no prior pursuit, so it only speaks when it has
 * something to say. Server component; the loader scopes by org.
 */
export async function RecompeteRadarPanel({
  organizationId,
  target,
  className,
}: {
  organizationId: string;
  target: { kind: "solicitation" | "opportunity"; id: string };
  className?: string;
}) {
  const matches = await (
    target.kind === "solicitation"
      ? getRecompeteForSolicitation({ organizationId, solicitationId: target.id })
      : getRecompeteForOpportunity({ organizationId, opportunityId: target.id })
  ).catch(() => [] as RecompeteMatch[]);
  if (matches.length === 0) return null;

  const top = matches[0]!;
  const lostTop = top.prior.outcome === "lost";

  return (
    <Panel
      title="Recompete radar"
      eyebrow={`${confidenceLabel(top.confidence)} · ${matches.length} prior pursuit${matches.length === 1 ? "" : "s"}`}
      accent={lostTop ? "rose" : "emerald"}
      className={className}
    >
      <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
        {lostTop
          ? "This looks like work you bid and lost before. The record, the debrief and the winner analysis are below so the team starts from what it learned, not from scratch."
          : "This looks like work you have won before. Your record and what the evaluators credited are below; plan the incumbent defence around them."}
      </p>
      <ul className="space-y-3">
        {matches.map((m) => (
          <MatchCard key={m.prior.proposalId} m={m} />
        ))}
      </ul>
    </Panel>
  );
}

function MatchCard({ m }: { m: RecompeteMatch }) {
  const p = m.prior;
  const lost = p.outcome === "lost";
  const decided = p.decidedAt ? p.decidedAt.slice(0, 10) : null;
  const gaps = p.winnerAnalysis?.gapsWeHad.trim() ?? "";
  const recs = p.winnerAnalysis?.recommendations.trim() ?? "";
  const improvements = p.debrief?.improvements.trim() ?? "";
  const weaknesses = p.debrief?.weaknesses.trim() ?? "";
  const strengths = p.debrief?.strengths.trim() ?? "";
  const lessons = p.lessonsLearned.trim();

  return (
    <li className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
            lost
              ? "border-rose/40 bg-rose/10 text-rose"
              : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          }`}
        >
          {lost ? "Lost" : "Won"}
        </span>
        <Link
          href={`/proposals/${p.proposalId}/outcome`}
          className="min-w-0 truncate font-display text-[13px] font-semibold text-text hover:underline"
        >
          {p.title}
        </Link>
        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
          {Math.round(m.score * 100)}% match{decided ? ` · ${decided}` : ""}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.signals.map((s) => (
          <span
            key={`${s.kind}-${s.label}`}
            className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted"
          >
            {s.label}
          </span>
        ))}
      </div>

      <div className="mt-2 font-mono text-[11px] text-muted">
        {lost ? (
          <>
            {p.awardedTo.trim() ? (
              <>
                Awarded to <span className="text-text">{p.awardedTo.trim()}</span>
              </>
            ) : (
              "Winner not recorded"
            )}
            {p.awardValue ? (
              <>
                {" · "}
                <span className="text-text">{formatMoney(p.awardValue)}</span>
              </>
            ) : null}
            {p.reasons.length > 0 ? ` · ${p.reasons.map(reasonLabel).join(", ")}` : ""}
          </>
        ) : (
          <>
            You won this
            {p.awardValue ? (
              <>
                {" · "}
                <span className="text-text">{formatMoney(p.awardValue)}</span>
              </>
            ) : null}
          </>
        )}
      </div>

      {lost ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Note label="Lessons learned" text={lessons} empty="No lessons recorded on the outcome." />
          <Note
            label="Debrief: what to fix"
            text={improvements || weaknesses}
            empty="No debrief notes captured."
          />
          {gaps || recs ? (
            <>
              <Note label={`Why ${p.winnerAnalysis?.competitorName.trim() || "the winner"} won`} text={gaps} empty="" />
              <Note label="Before the next bid" text={recs} empty="" />
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Note label="What the evaluators credited" text={strengths} empty="No debrief strengths captured." />
          <Note label="Lessons learned" text={lessons} empty="No lessons recorded on the outcome." />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-widest">
        <Link href={`/proposals/${p.proposalId}/outcome`} className="text-teal hover:underline">
          Open outcome →
        </Link>
        <Link href={`/opportunities/${p.opportunityId}`} className="text-muted hover:text-text">
          Opportunity →
        </Link>
      </div>
    </li>
  );
}

function Note({ label, text, empty }: { label: string; text: string; empty: string }) {
  if (!text && !empty) return null;
  return (
    <div>
      <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">{label}</div>
      {text ? (
        <p className="line-clamp-4 whitespace-pre-line font-body text-[12px] leading-relaxed text-text">
          {text}
        </p>
      ) : (
        <p className="font-body text-[12px] text-muted">{empty}</p>
      )}
    </div>
  );
}
