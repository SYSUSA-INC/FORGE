import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationModels } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-COMPANY-MODEL phase 1b — the Command Center's nudge for org admins:
 * what changed since the company model was approved, or that no model
 * is approved yet. Renders nothing for members and when nothing is due.
 */
export async function CompanyModelNudgePanel({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  if (!isOrgAdmin) return null;
  const { organizationId } = await requireCurrentOrg();
  const row = await safeQuery(
    async () =>
      (
        await db
          .select({ approvedVersion: organizationModels.approvedVersion, staleReasons: organizationModels.staleReasons, hasDraft: organizationModels.draft })
          .from(organizationModels)
          .where(eq(organizationModels.organizationId, organizationId))
          .limit(1)
      )[0] ?? null,
    null,
    { tag: "command-center.companyModel" },
  );
  const approved = !!row && row.approvedVersion > 0;
  const reasons = row?.staleReasons ?? [];
  if (approved && reasons.length === 0) return null;

  return (
    <section className="mb-6">
      <Panel
        title="Company model"
        eyebrow={approved ? `${reasons.length} change${reasons.length === 1 ? "" : "s"} since approval` : "Not approved yet"}
        accent={approved ? "gold" : undefined}
        actions={
          <Link href="/settings/company-model" className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
            {approved ? "Review →" : row?.hasDraft ? "Review the draft →" : "Build it →"}
          </Link>
        }
      >
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          {approved
            ? `Since version ${row!.approvedVersion} was approved: ${reasons.join("; ")}. Rebuild from the evidence and approve the revision so the scout, the questionnaire and the drafter read the current company.`
            : "FORGE's account of what the company does is what the scout, the questionnaire and the drafter will read. Build it from the evidence and approve it."}
        </p>
      </Panel>
    </section>
  );
}
