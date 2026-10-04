import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { templateAuthoringRefusal } from "@/lib/template-gate";
import { STARTER_TEMPLATES } from "@/lib/template-types";
import { NewTemplateForm } from "./NewTemplateForm";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const locked = await templateAuthoringRefusal(organizationId);

  return (
    <>
      <PageHeader
        eyebrow="Settings · Templates"
        title="Create a template"
        subtitle="Start from a built-in baseline, then edit cover / header / footer / page CSS / section seed on the next screen."
      />
      {locked ? (
        <Panel title="Custom templates aren't in your plan" eyebrow="Plan">
          <p className="font-body text-[14px] leading-relaxed text-muted">{locked}</p>
          <Link href="/settings/billing" className="aur-btn aur-btn-primary mt-3 inline-block">
            Open billing
          </Link>
        </Panel>
      ) : (
        <NewTemplateForm
          starters={STARTER_TEMPLATES.map((s, i) => ({
            index: i,
            name: s.name,
            description: s.description,
            sectionCount: s.sectionSeed.length,
            brandPrimary: s.brandPrimary,
            brandAccent: s.brandAccent,
          }))}
        />
      )}
    </>
  );
}
