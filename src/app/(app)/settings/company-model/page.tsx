import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationModels } from "@/db/schema";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { loadCompanyModelInputs } from "@/lib/company-model-inputs";
import { safeQuery } from "@/lib/schema-resilience";
import { CompanyModelPanel, type CompanyModelView } from "./CompanyModelPanel";

export const dynamic = "force-dynamic";

// Mirrors requireOrgAdmin's role list (the actions re-check server-side).
const ORG_ADMIN_ROLES = ["admin"];

/**
 * BL-COMPANY-MODEL phase 1a — Settings → Company model: FORGE's account
 * of what the company does, drafted by FORGE, edited and approved by an
 * org admin. Members read the approved version.
 */
export default async function CompanyModelPage() {
  const { user, organizationId } = await requireCurrentOrg();
  const canEdit = user.isSuperadmin || (!!user.role && ORG_ADMIN_ROLES.includes(user.role));

  const [row, inputs] = await Promise.all([
    safeQuery(
      async () => (await db.select().from(organizationModels).where(eq(organizationModels.organizationId, organizationId)).limit(1))[0] ?? null,
      null,
      { tag: "company-model.row" },
    ),
    safeQuery(() => loadCompanyModelInputs(organizationId), null, { tag: "company-model.inputs" }),
  ]);

  const view: CompanyModelView | null = row
    ? {
        draft: row.draft,
        draftGeneratedAt: row.draftGeneratedAt ? row.draftGeneratedAt.toISOString() : null,
        draftEdited: !!row.draftEditedByUserId,
        draftRegistrationOnly: row.draftSources?.registrationOnly ?? false,
        approved: row.approved,
        approvedVersion: row.approvedVersion,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        staleReasons: row.staleReasons,
      }
    : null;
  const evidenceLabels: Record<string, string> = {};
  if (inputs) for (const [ref, e] of inputs.allowedEvidence) evidenceLabels[ref] = e.label;
  const basis = inputs
    ? { knowledge: inputs.sources.knowledgeEntryIds.length, pastPerformance: inputs.sources.pastPerformanceIds.length, bids: inputs.sources.proposalIds.length, answers: inputs.prompt.questionnaireAnswers.length }
    : { knowledge: 0, pastPerformance: 0, bids: 0, answers: 0 };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Company model"
        subtitle="FORGE's own account of what the company does, built from the profile, the Knowledge base, decided bids and confirmed questionnaires. An admin approves every version; the scout, the questionnaire and the drafter read the approved one."
      />
      <CompanyModelPanel model={view} canEdit={canEdit} evidenceLabels={evidenceLabels} basis={basis} />
    </>
  );
}
