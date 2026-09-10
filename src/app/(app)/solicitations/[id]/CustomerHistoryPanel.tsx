import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { getCustomerIntelligence } from "@/lib/customer-intelligence";
import { formatMoney } from "@/lib/customer-patterns";

const STAGE_LABEL: Record<string, string> = {
  identified: "Identified",
  sources_sought: "Sources sought",
  qualification: "Qualification",
  capture: "Capture",
  pre_proposal: "Pre-proposal",
  writing: "Writing",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  no_bid: "No bid",
};

/**
 * BL-FB-SOL-CUSTOMER-PATTERN — what the org already knows about this
 * agency, shown the moment a solicitation arrives: pursuits and record,
 * what they buy from us, who beats us, award sizes, what their
 * evaluators said they value, and the model's PWin for the linked
 * opportunity.
 */
export async function CustomerHistoryPanel({
  organizationId,
  solicitationId,
  agency,
  naicsCode,
  linkedOpportunityId,
}: {
  organizationId: string;
  solicitationId: string;
  agency: string;
  naicsCode: string;
  linkedOpportunityId: string | null;
}) {
  if (!agency.trim()) return null;
  const intel = await getCustomerIntelligence({
    organizationId,
    agency,
    excludeSolicitationId: solicitationId,
    linkedOpportunityId,
    naicsCode,
  }).catch(() => null);
  if (!intel) return null;

  const { history: h, market, modelPwin } = intel;
  const seenBefore = h.pursuits > 0 || h.solicitationsSeen > 0;

  return (
    <Panel
      title="Customer history"
      eyebrow={
        seenBefore
          ? `${h.agency} · ${h.pursuits} pursuit${h.pursuits === 1 ? "" : "s"} · ${h.solicitationsSeen} prior solicitation${h.solicitationsSeen === 1 ? "" : "s"}`
          : `${h.agency} · first time`
      }
      actions={
        modelPwin ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Model PWin{" "}
            <span className="text-text">{modelPwin.pwin}%</span>
            <span className="ml-1 lowercase">({modelPwin.confidence} confidence)</span>
            {linkedOpportunityId ? (
              <Link
                href={`/opportunities/${linkedOpportunityId}`}
                className="ml-2 normal-case tracking-normal text-teal underline"
              >
                why →
              </Link>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {!seenBefore ? (
        <p className="font-body text-[13px] leading-relaxed text-muted">
          No prior pursuits or solicitations with {h.agency} in this workspace. Once
          you pursue and decide bids here, this panel shows your record with the
          agency, who beats you, award sizes and what their evaluators said they
          value.
          {market ? " Market view below comes from USAspending." : ""}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat
            label="Win rate vs agency"
            value={h.winRate === null ? "—" : `${Math.round(h.winRate * 100)}%`}
            sub={h.won + h.lost > 0 ? `${h.won} won / ${h.lost} lost` : "no decided pursuits"}
            tone={h.winRate === null ? "muted" : h.winRate >= 0.4 ? "good" : h.winRate >= 0.2 ? "warn" : "bad"}
          />
          <Stat
            label="Open pursuits"
            value={String(h.open)}
            sub={`${h.pursuits} total at this agency`}
            tone="muted"
          />
          <Stat
            label="Avg award (our losses/wins)"
            value={formatMoney(h.avgAward)}
            sub={h.avgEstimate ? `our estimates avg ${formatMoney(h.avgEstimate)}` : undefined}
            tone="muted"
          />
          <Stat
            label="Who beat us"
            value={h.winners[0] ? h.winners[0].name : "—"}
            sub={
              h.winners.length > 1
                ? `+${h.winners.length - 1} other${h.winners.length - 1 === 1 ? "" : "s"}`
                : h.winners[0]
                  ? `${h.winners[0].count} loss${h.winners[0].count === 1 ? "" : "es"}`
                  : "no named winners"
            }
            tone={h.winners[0] ? "bad" : "muted"}
          />
        </div>
      )}

      {seenBefore ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              What they buy from us
            </div>
            {h.naicsMix.length === 0 && h.setAsideMix.length === 0 ? (
              <p className="font-body text-[12px] text-muted">No NAICS or set-aside recorded on these pursuits.</p>
            ) : (
              <ul className="space-y-1 font-mono text-[11px]">
                {h.naicsMix.map((n) => (
                  <li key={n.code} className="flex justify-between gap-2">
                    <span className="text-text">NAICS {n.code}</span>
                    <span className="text-muted">{n.count}</span>
                  </li>
                ))}
                {h.setAsideMix.map((s) => (
                  <li key={s.setAside} className="flex justify-between gap-2">
                    <span className="text-text">{s.setAside}</span>
                    <span className="text-muted">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              Evaluator priorities (past Section M)
            </div>
            {h.evaluatorPriorities.length === 0 ? (
              <p className="font-body text-[12px] text-muted">
                No parsed Section M summaries from prior solicitations at this agency.
              </p>
            ) : (
              <ul className="space-y-2">
                {h.evaluatorPriorities.map((e) => (
                  <li key={e.solicitationId} className="rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
                    <Link
                      href={`/solicitations/${e.solicitationId}`}
                      className="font-display text-[12px] text-text hover:underline"
                    >
                      {e.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-4 font-body text-[11px] leading-relaxed text-muted">
                      {e.summary}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              Your record
            </div>
            {h.recentPursuits.length === 0 ? (
              <p className="font-body text-[12px] text-muted">No pursuits yet.</p>
            ) : (
              <ul className="space-y-1">
                {h.recentPursuits.map((p) => (
                  <li key={p.opportunityId} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/opportunities/${p.opportunityId}`}
                      className="truncate font-body text-[12px] text-text hover:underline"
                    >
                      {p.title}
                    </Link>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                        p.outcome === "won"
                          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                          : p.outcome === "lost"
                            ? "border-rose/40 bg-rose/10 text-rose"
                            : "border-white/15 text-muted"
                      }`}
                    >
                      {p.outcome ?? STAGE_LABEL[p.stage] ?? p.stage}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {market ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Market view · USAspending · last {market.yearsBack} years
            {naicsCode ? ` · NAICS ${naicsCode}` : ""}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <span>
              <span className="text-muted">Awards:</span>{" "}
              <span className="text-text">{market.awards}</span>
            </span>
            <span>
              <span className="text-muted">Obligated:</span>{" "}
              <span className="text-text">{formatMoney(market.totalObligated)}</span>
            </span>
          </div>
          {market.topRecipients.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
              {market.topRecipients.map((r) => (
                <li key={r.name} className="flex justify-between gap-2">
                  <span className="truncate text-text">{r.name}</span>
                  <span className="shrink-0 text-muted">
                    {formatMoney(r.amount)} · {r.awards}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "warn" | "bad" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "bad"
          ? "text-rose"
          : "text-text";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-display text-[18px] font-semibold ${color}`}>{value}</div>
      {sub ? <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{sub}</div> : null}
    </div>
  );
}
