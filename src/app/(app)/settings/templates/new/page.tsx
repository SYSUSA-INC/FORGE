import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { STARTER_TEMPLATES } from "@/lib/template-types";
import { NewTemplateForm } from "./NewTemplateForm";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  return (
    <>
      <PageHeader
        eyebrow="Settings · Templates"
        title="Create a template"
        subtitle="Start from a built-in baseline, then edit cover / header / footer / page CSS / section seed on the next screen."
      />
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
    </>
  );
}
