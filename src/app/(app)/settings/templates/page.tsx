import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { templateAuthoringRefusal } from "@/lib/template-gate";
import { listTemplatesAction } from "./actions";
import { TemplatesList } from "./TemplatesList";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [templates, locked] = await Promise.all([listTemplatesAction(), templateAuthoringRefusal(organizationId)]);

  return (
    <>
      <PageHeader
        eyebrow="Settings · Templates"
        title="Proposal templates"
        subtitle="Branded section structures used when authors create a new proposal. Set one as the default to preselect it on /proposals/new."
        actions={
          locked ? null : (
            <Link
              href="/settings/templates/new"
              className="aur-btn aur-btn-primary"
            >
              + New template
            </Link>
          )
        }
        meta={[
          { label: "Total", value: String(templates.length) },
          {
            label: "Default",
            value:
              templates.find((t) => t.isDefault)?.name ?? "Not set",
            accent:
              templates.find((t) => t.isDefault) ? "emerald" : undefined,
          },
        ]}
      />
      {locked ? (
        <Panel title="Custom templates aren't in your plan" eyebrow="Plan">
          <p className="font-body text-[14px] leading-relaxed text-muted">{locked}</p>
          <Link href="/settings/billing" className="aur-btn aur-btn-primary mt-3 inline-block">
            Open billing
          </Link>
        </Panel>
      ) : null}
      {templates.length === 0 ? (
        <Panel title="No templates yet" eyebrow="Empty state">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            Templates are branded section structures used when authors
            create a new proposal. They carry the cover-page HTML, page
            CSS, header / footer, brand palette, and a section seed list
            (kind + title + page cap).
          </p>
          <p className="mt-3 font-body text-[14px] leading-relaxed text-muted">
            Click <span className="text-text">+ New template</span> to
            create one from a starter (Civilian, DoD, or blank).
          </p>
        </Panel>
      ) : (
        <TemplatesList templates={templates} />
      )}
    </>
  );
}
