import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  users,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import {
  ACTIVITY_KIND_COLORS,
  ACTIVITY_KIND_LABELS,
} from "@/lib/evaluation-types";
import { AddActivityForm } from "./AddActivityForm";
import { DeleteActivityButton } from "./DeleteActivityButton";

export const dynamic = "force-dynamic";

export default async function OpportunityActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!opp) notFound();

  const rows = await db
    .select({
      id: opportunityActivities.id,
      kind: opportunityActivities.kind,
      title: opportunityActivities.title,
      body: opportunityActivities.body,
      createdAt: opportunityActivities.createdAt,
      userId: opportunityActivities.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(opportunityActivities)
    .leftJoin(users, eq(users.id, opportunityActivities.userId))
    .where(eq(opportunityActivities.opportunityId, params.id))
    .orderBy(desc(opportunityActivities.createdAt));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
      <Panel title="Timeline" eyebrow={`${rows.length} events`}>
        {rows.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No activity yet. Record notes, meetings, or actions in the panel to
            the right.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((a) => {
              const color = ACTIVITY_KIND_COLORS[a.kind];
              const label = ACTIVITY_KIND_LABELS[a.kind];
              const isMine = a.userId === actor.id;
              return (
                <li
                  key={a.id}
                  className="relative grid grid-cols-[24px_1fr] items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <span
                    className="mt-1.5 h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-md px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                        style={{
                          color,
                          backgroundColor: `${color}1A`,
                          border: `1px solid ${color}40`,
                        }}
                      >
                        {label}
                      </span>
                      {a.title ? (
                        <span className="font-display text-[13px] font-semibold text-text">
                          {a.title}
                        </span>
                      ) : null}
                    </div>
                    {a.body ? (
                      <div className="mt-1.5 whitespace-pre-wrap font-mono text-[12px] text-text">
                        {a.body}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted">
                        {(a.userName ?? a.userEmail ?? "System")} ·{" "}
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                      {isMine ? (
                        <DeleteActivityButton
                          opportunityId={params.id}
                          activityId={a.id}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Record activity" eyebrow="Note, meeting, or action">
        <AddActivityForm opportunityId={params.id} />
      </Panel>
    </div>
  );
}
