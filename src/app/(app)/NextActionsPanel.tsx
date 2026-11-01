import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listOpenNextActionsForOrg, type OrgNextAction } from "@/lib/next-action-read";
import { daysUntil, NEXT_ACTION_PRIORITY_LABELS } from "@/lib/next-actions";
import { STAGE_LABELS } from "@/lib/opportunity-types";
import { safeQuery } from "@/lib/schema-resilience";

const MAX = 8;

/**
 * BL-NEXT-ACTION phase 5b — the Command Center's Next actions: the open
 * actions across the organisation, the signed-in user's own pursuits
 * first, grouped by pursuit with its stage and days to due. Renders
 * nothing when nothing is proposed.
 */
export async function NextActionsPanel() {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rows = await safeQuery(() => listOpenNextActionsForOrg(organizationId, { userId: user.id, max: MAX }), [] as OrgNextAction[], { tag: "command-center.nextActions" });
  if (rows.length === 0) return null;
  const now = new Date();
  const groups: { opportunityId: string; title: string; stage: string; dueBy: Date | null; own: boolean; actions: OrgNextAction[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.opportunityId === r.opportunityId);
    if (g) g.actions.push(r);
    else groups.push({ opportunityId: r.opportunityId, title: r.opportunityTitle, stage: STAGE_LABELS[r.stage] ?? r.stage, dueBy: r.dueBy, own: r.ownerUserId === user.id, actions: [r] });
  }
  const atRisk = rows.filter((r) => r.kind === "at_risk").length;
  const eyebrow = [`${rows.length} proposed`, atRisk > 0 ? `${atRisk} at risk` : null, `${groups.length} pursuit${groups.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return (
    <section className="mb-6">
      <Panel
        title="Next actions"
        eyebrow={eyebrow}
        accent={atRisk > 0 ? "gold" : undefined}
        actions={
          <Link href="/opportunities" className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
            All pursuits →
          </Link>
        }
      >
        <ul className="flex flex-col divide-y divide-layer/10">
          {groups.map((g) => {
            const d = daysUntil(g.dueBy, now);
            return (
              <li key={g.opportunityId} className="py-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/opportunities/${g.opportunityId}`} className="aur-link font-body text-[13px] font-medium text-text">
                    {g.title}
                  </Link>
                  <span className="font-mono text-[10px] uppercase tracking-label text-muted">
                    {g.stage}
                    {d !== null ? ` · ${d < 0 ? `${-d}d past due` : d === 0 ? "due today" : `due in ${d}d`}` : ""}
                    {g.own ? " · yours" : ""}
                  </span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {g.actions.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-2 font-body text-[13px]">
                      <span className={`font-mono text-[10px] uppercase tracking-label ${a.kind === "at_risk" ? "text-rose" : "text-muted"}`}>{a.kind === "at_risk" ? "At risk" : NEXT_ACTION_PRIORITY_LABELS[a.priority]}</span>
                      <Link href={a.href} className="aur-link min-w-0 flex-1 text-text" title={a.reason}>
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </Panel>
    </section>
  );
}
