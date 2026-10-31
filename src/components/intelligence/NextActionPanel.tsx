import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { syncNextActions, type NextActionView } from "@/lib/next-action-sync";
import { daysUntil, mayDecideNextAction, NEXT_ACTION_PRIORITY_LABELS } from "@/lib/next-actions";
import { safeQuery } from "@/lib/schema-resilience";
import { NextActionButtons } from "./NextActionButtons";

/**
 * BL-NEXT-ACTION phase 5a — the next action FORGE proposes for this
 * pursuit, with the reason and where it is done, then the two after it.
 * Opening the page runs the rules, so the panel is never older than the
 * state it reads. Renders nothing when nothing is proposed.
 */
export async function NextActionPanel({ opportunityId }: { opportunityId: string }) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await safeQuery(() => syncNextActions(organizationId, opportunityId), null, { tag: "next-actions.panel" });
  if (!res || res.actions.length === 0) return null;
  const canDecide = mayDecideNextAction(user, res.ownerUserId);
  const [first, ...rest] = res.actions;
  const now = new Date();

  return (
    <Panel title="Next action" eyebrow={eyebrowFor(first!, now)} accent={first!.priority === "now" ? "gold" : undefined}>
      <div className="font-display text-[17px] font-semibold leading-snug text-text">{first!.title}</div>
      <p className="mt-1 font-body text-[13px] leading-[1.5] text-muted">{first!.reason}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={first!.href} className="aur-btn aur-btn-primary">
          Go
        </Link>
        {canDecide ? <NextActionButtons id={first!.id} /> : null}
      </div>
      {rest.length > 0 ? (
        <ul className="mt-4 flex flex-col divide-y divide-layer/10 border-t border-layer/10">
          {rest.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline gap-2 py-2 font-body text-[13px]">
              <span className="font-mono text-[10px] uppercase tracking-label text-muted">{NEXT_ACTION_PRIORITY_LABELS[a.priority]}</span>
              <Link href={a.href} className="aur-link min-w-0 flex-1 text-text" title={a.reason}>
                {a.title}
              </Link>
              {canDecide ? <NextActionButtons id={a.id} compact /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function eyebrowFor(a: NextActionView, now: Date): string {
  const d = daysUntil(a.dueBy, now);
  const due = d === null ? null : d < 0 ? `${-d} day${d === -1 ? "" : "s"} past due` : d === 0 ? "due today" : `due in ${d} day${d === 1 ? "" : "s"}`;
  return [NEXT_ACTION_PRIORITY_LABELS[a.priority], due].filter(Boolean).join(" · ");
}
