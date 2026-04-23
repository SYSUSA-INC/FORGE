import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { STAGE_COLORS, STAGE_LABELS } from "@/lib/opportunity-types";
import { OpportunityTabs } from "./OpportunityTabs";
import { DeleteOpportunityButton } from "./DeleteOpportunityButton";

export const dynamic = "force-dynamic";

export default async function OpportunityDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      opp: opportunities,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(opportunities)
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) notFound();
  const { opp } = row;
  const stageColor = STAGE_COLORS[opp.stage];
  const stageLabel = STAGE_LABELS[opp.stage];

  return (
    <>
      <PageHeader
        eyebrow="Opportunity"
        title={opp.title}
        subtitle={[opp.agency, opp.office].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Link href="/opportunities" className="aur-btn aur-btn-ghost">
              Back
            </Link>
            <DeleteOpportunityButton id={opp.id} title={opp.title} />
          </>
        }
        meta={[
          { label: "Stage", value: stageLabel },
          {
            label: "Value",
            value:
              opp.valueLow || opp.valueHigh
                ? `${opp.valueLow || "—"} – ${opp.valueHigh || "—"}`
                : "—",
          },
          {
            label: "PWin",
            value: `${opp.pWin}%`,
            accent:
              opp.pWin >= 60 ? "emerald" : opp.pWin >= 30 ? "gold" : undefined,
          },
          {
            label: "Owner",
            value: row.ownerName ?? row.ownerEmail ?? "Unassigned",
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: stageColor }}
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
          Current stage
        </div>
        <div
          className="rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.22em]"
          style={{
            color: stageColor,
            backgroundColor: `${stageColor}1A`,
            border: `1px solid ${stageColor}40`,
          }}
        >
          {stageLabel}
        </div>
      </div>

      <OpportunityTabs id={opp.id} />

      {children}
    </>
  );
}
