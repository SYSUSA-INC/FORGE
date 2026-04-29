import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { getTemplateForEditAction } from "../actions";
import { EditTemplateClient } from "./EditTemplateClient";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const t = await getTemplateForEditAction(params.id);
  if (!t) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Settings · Templates"
        title={t.name}
        subtitle={
          t.description || "Edit branding tokens, section seed, and HTML/CSS."
        }
      />
      <EditTemplateClient
        id={t.id}
        initial={{
          name: t.name,
          description: t.description,
          kind: t.kind,
          coverHtml: t.coverHtml,
          headerHtml: t.headerHtml,
          footerHtml: t.footerHtml,
          pageCss: t.pageCss,
          docxFileName: t.docxFileName,
          docxFileSize: t.docxFileSize,
          docxUploadedAt: t.docxUploadedAt
            ? t.docxUploadedAt.toISOString()
            : null,
          variablesDetected: t.variablesDetected ?? [],
          sectionSeed: t.sectionSeed ?? [],
          brandPrimary: t.brandPrimary,
          brandAccent: t.brandAccent,
          fontDisplay: t.fontDisplay,
          fontBody: t.fontBody,
          logoUrl: t.logoUrl,
          isDefault: t.isDefault,
          archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
        }}
      />
    </>
  );
}
