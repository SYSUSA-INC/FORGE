import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { SECTION_DRAFT_PROMPT_VERSION } from "@/lib/ai-prompts";
import { listEvalRuns, listGoldenCases } from "@/lib/golden-eval";
import { safeQuery } from "@/lib/schema-resilience";
import { getAIEngineStatus } from "@/lib/settings-status";
import { AIEngineTab } from "../AIEngineTab";
import { GoldenEvalPanel } from "./GoldenEvalPanel";

export const dynamic = "force-dynamic";

// Mirrors requireOrgAdmin's role list (the action re-checks server-side).
const ORG_ADMIN_ROLES = ["admin"];

export default async function AiEnginePage() {
  const { user, organizationId } = await requireCurrentOrg();

  const aiStatus = getAIEngineStatus();

  // BL-AIP-5b — golden eval history and the size of the golden set.
  const [runs, cases] = await Promise.all([
    safeQuery(() => listEvalRuns({ organizationId, limit: 12 }), [], { tag: "ai-engine.evalRuns" }),
    safeQuery(() => listGoldenCases({ organizationId, limit: 50 }), [], { tag: "ai-engine.goldenCases" }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="AI Engine"
        subtitle="Status of configured AI providers and how the platform routes drafts, evaluations, and reviews across them."
        actions={
          <Link href="/settings" className="aur-btn aur-btn-ghost">
            ← Settings
          </Link>
        }
      />
      <AIEngineTab status={aiStatus} />
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
          isAdmin={user.isSuperadmin || (!!user.role && ORG_ADMIN_ROLES.includes(user.role))}
        />
      </div>
    </>
  );
}
