import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { burnDown, featureRoutingRows } from "@/lib/ai-control";
import { getAiControlState, getTenantAiUsage, type AiControlState, type TenantAiUsage } from "@/lib/ai-engine-control";
import { SECTION_DRAFT_PROMPT_VERSION } from "@/lib/ai-prompts";
import { listEvalRuns, listGoldenCases } from "@/lib/golden-eval";
import { BRAIN_RETRIEVAL_VERSION } from "@/lib/brain-rank";
import { listRetrievalEvalRuns } from "@/lib/retrieval-eval";
import type { RetrievalCaseResult, RetrievalSummary } from "@/lib/retrieval-eval-logic";
import { safeQuery } from "@/lib/schema-resilience";
import { getAIEngineStatus } from "@/lib/settings-status";
import { AIEngineTab } from "../AIEngineTab";
import { AiControlPanel } from "./AiControlPanel";
import { GoldenEvalPanel } from "./GoldenEvalPanel";
import { RetrievalEvalPanel } from "./RetrievalEvalPanel";

export const dynamic = "force-dynamic";

// Mirrors requireOrgAdmin's role list (the action re-checks server-side).
const ORG_ADMIN_ROLES = ["admin"];

const EMPTY_STATE: AiControlState = {
  hasSubscription: false,
  tierName: null,
  platformTokenCap: 0,
  platformRequestCap: 0,
  effectiveTokenCap: 0,
  effectiveRequestCap: 0,
  budget: {},
  aiModels: {},
  tokensUsed: 0,
  requestsUsed: 0,
  provider: "stub",
  routingOn: true,
};

export default async function AiEnginePage() {
  const { user, organizationId } = await requireCurrentOrg();
  const isAdmin = user.isSuperadmin || (!!user.role && ORG_ADMIN_ROLES.includes(user.role));

  const aiStatus = getAIEngineStatus();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // BL-AIP-7c — the control panel's state and this month's usage;
  // BL-AIP-5b — golden eval history and the size of the golden set.
  const [state, usage, runs, cases, retrievalRuns] = await Promise.all([
    safeQuery<AiControlState>(() => getAiControlState({ organizationId }), EMPTY_STATE, { tag: "ai-engine.state" }),
    safeQuery<TenantAiUsage>(
      () => getTenantAiUsage({ organizationId, since: monthStart }),
      { byFeature: [], daily: [] },
      { tag: "ai-engine.usage" },
    ),
    safeQuery(() => listEvalRuns({ organizationId, limit: 12 }), [], { tag: "ai-engine.evalRuns" }),
    safeQuery(() => listGoldenCases({ organizationId, limit: 50 }), [], { tag: "ai-engine.goldenCases" }),
    safeQuery(() => listRetrievalEvalRuns({ organizationId, limit: 8 }), [], { tag: "ai-engine.retrievalRuns" }),
  ]);

  const monthLabel = monthStart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="AI Engine"
        subtitle="What the AI does for your organization this month, what it may spend, and which model class each feature runs in."
        actions={
          <Link href="/settings" className="aur-btn aur-btn-ghost">
            ← Settings
          </Link>
        }
        meta={[
          { label: "Tokens this month", value: state.tokensUsed.toLocaleString("en-US") },
          {
            label: "Token cap",
            value: state.effectiveTokenCap === 0 ? "∞" : state.effectiveTokenCap.toLocaleString("en-US"),
          },
          { label: "Requests this month", value: state.requestsUsed.toLocaleString("en-US") },
          { label: "Tier", value: state.tierName ?? "—" },
        ]}
      />
      <AiControlPanel
        tierName={state.tierName}
        hasSubscription={state.hasSubscription}
        monthLabel={monthLabel}
        tokens={burnDown({ used: state.tokensUsed, cap: state.effectiveTokenCap, now })}
        requests={burnDown({ used: state.requestsUsed, cap: state.effectiveRequestCap, now })}
        platformTokenCap={state.platformTokenCap}
        platformRequestCap={state.platformRequestCap}
        budget={state.budget}
        daily={usage.daily}
        usageByFeature={usage.byFeature.map((f) => ({
          feature: f.feature,
          calls: f.calls,
          tokens: f.inputTokens + f.outputTokens,
          errors: f.errors,
          refused: f.quotaRefused,
        }))}
        routing={featureRoutingRows(state.aiModels, state.provider)}
        provider={state.provider}
        routingOn={state.routingOn}
        isAdmin={isAdmin}
      />
      <div className="mt-4">
        <AIEngineTab status={aiStatus} />
      </div>
      <div className="mt-4">
        <GoldenEvalPanel
          runs={runs.map((r) => ({
            id: r.id,
            promptVersion: r.promptVersion,
            model: r.model,
            caseCount: r.caseCount,
            meanScore: r.meanScore,
            stubbed: r.stubbed,
            createdAt: r.createdAt.toISOString(),
            results: r.results,
          }))}
          goldenCases={cases.length}
          currentPromptVersion={SECTION_DRAFT_PROMPT_VERSION}
          isAdmin={isAdmin}
        />
      </div>
      <div className="mt-4">
        <RetrievalEvalPanel
          runs={retrievalRuns.map((r) => ({
            id: r.id,
            retrievalVersion: r.retrievalVersion,
            embeddingProvider: r.embeddingProvider,
            caseCount: r.caseCount,
            stubbed: r.stubbed,
            createdAt: r.createdAt.toISOString(),
            summary: r.summary as RetrievalSummary,
            results: r.results as RetrievalCaseResult[],
          }))}
          currentVersion={BRAIN_RETRIEVAL_VERSION}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}
