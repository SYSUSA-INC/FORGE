import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, users } from "@/db/schema";
import { LifecycleChevron } from "@/components/lifecycle/LifecycleChevron";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { identifySource } from "@/lib/identify-sources";
import { lifecycleStage, type LifecycleKey } from "@/lib/lifecycle";
import { safeQuery } from "@/lib/schema-resilience";
import { ScoutSection } from "@/app/(app)/opportunities/scout/ScoutSection";
import { evaluateFilter } from "@/lib/opportunity-decision";
import { CreateSection } from "./CreateSection";
import { EvaluateSection } from "./EvaluateSection";
import { CaptureSection } from "./CaptureSection";
import { PlanSection } from "./PlanSection";
import { DevelopSection } from "./DevelopSection";
import { StageList, type StageListRow } from "./StageList";

/**
 * BL-NAV-LIFECYCLE (FORGE II) — a stage page under Pipeline (one static
 * route per stage, beside the funnel's own `[id]` redirect): the chevron
 * on top with this stage lit, the stage's purpose, and its work.
 * Identify holds Scout and Create as tabs; every other stage lists the
 * opportunities at the pipeline stages it covers. The stage behaviours
 * (Analyze, the decision, the plan, the draft, the submission) arrive
 * phase by phase on these pages.
 */
export type StageSearchParams = { tab?: string; afterCreate?: string; source?: string; from?: string; wait?: string; filter?: string };

export async function PipelineStagePage({ stageKey, searchParams }: { stageKey: LifecycleKey; searchParams: StageSearchParams }) {
  const stage = lifecycleStage(stageKey);
  if (!stage) notFound();
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  if (stage.key === "identify") {
    const tab = searchParams.tab === "create" ? "create" : "scout";
    const afterCreate = searchParams.afterCreate === "proposal" ? "proposal" : undefined;
    return (
      <>
        <PageHeader eyebrow="Pipeline" title="Identify" subtitle={stage.description} />
        <LifecycleChevron current="identify" />
        <nav aria-label="Identify sections" className="mb-6 flex items-center gap-1 border-b border-layer/10">
          {[
            { key: "scout", label: "Scout", href: "/pipeline/identify?tab=scout" },
            { key: "create", label: "Create", href: "/pipeline/identify?tab=create" },
          ].map((t) => (
            <Link
              key={t.key}
              href={t.href}
              aria-current={tab === t.key ? "page" : undefined}
              className={`relative inline-flex items-center px-4 py-3 font-mono text-[11px] uppercase tracking-label transition-colors ${tab === t.key ? "text-text" : "text-muted hover:text-text"}`}
            >
              {t.label}
              {tab === t.key ? <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-accent" /> : null}
            </Link>
          ))}
        </nav>
        {tab === "create" ? (
          <CreateSection
            from={searchParams.from}
            wait={searchParams.wait !== "0"}
            afterCreate={afterCreate}
          />
        ) : (
          <ScoutSection source={identifySource(searchParams.source)} />
        )}
      </>
    );
  }

  const rows = await safeQuery<StageListRow[]>(
    async () => {
      const found = await db
        .select({
          id: opportunities.id,
          title: opportunities.title,
          agency: opportunities.agency,
          stage: opportunities.stage,
          solicitationNumber: opportunities.solicitationNumber,
          source: opportunities.source,
          sourceUrl: opportunities.sourceUrl,
          responseDueDate: opportunities.responseDueDate,
          pWin: opportunities.pWin,
          ownerName: users.name,
          ownerEmail: users.email,
        })
        .from(opportunities)
        .leftJoin(users, eq(users.id, opportunities.ownerUserId))
        .where(and(eq(opportunities.organizationId, organizationId), inArray(opportunities.stage, stage.lists)))
        .orderBy(asc(opportunities.responseDueDate), asc(opportunities.title));
      return found.map((r) => ({
        id: r.id,
        title: r.title,
        agency: r.agency,
        stage: r.stage,
        solicitationNumber: r.solicitationNumber,
        source: r.source,
        sourceUrl: r.sourceUrl,
        responseDueDate: r.responseDueDate ? r.responseDueDate.toISOString() : null,
        pWin: r.pWin,
        owner: r.ownerName ?? r.ownerEmail ?? null,
      }));
    },
    [],
    { tag: `pipeline.${stage.key}` },
  );

  const links: Record<string, { href: string; label: string }[]> = {
    develop: [{ href: "/proposals", label: "Proposals in flight" }, { href: "/proposals/new", label: "New proposal" }],
    measure: [
      { href: "/reports", label: "Reports" },
      { href: "/intelligence/lessons", label: "Lessons" },
      { href: "/intelligence/losses", label: "Loss intelligence" },
    ],
  };
  const stageLinks = links[stage.key] ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title={stage.label}
        subtitle={stage.description}
        actions={
          stageLinks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stageLinks.map((l) => (
                <Link key={l.href} href={l.href} className="aur-btn aur-btn-ghost">
                  {l.label}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />
      <LifecycleChevron current={stage.key} />
      {stage.key === "evaluate" ? (
        <EvaluateSection rows={rows} filter={evaluateFilter(searchParams.filter)} />
      ) : stage.key === "capture" ? (
        <CaptureSection rows={rows} />
      ) : stage.key === "plan" ? (
        <PlanSection rows={rows} />
      ) : stage.key === "develop" ? (
        <DevelopSection rows={rows} />
      ) : (
        <StageList rows={rows} title={`In ${stage.label}`} empty={`Nothing is in ${stage.label} right now.`} />
      )}
    </>
  );
}
