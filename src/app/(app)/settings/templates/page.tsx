import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { listTemplatesAction } from "./actions";
import { TemplatesList } from "./TemplatesList";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const templates = await listTemplatesAction();

  return (
    <>
      <PageHeader
        eyebrow="Settings · Templates"
        title="Proposal templates"
        subtitle="Branded section structures used when authors create a new proposal. Set one as the default to preselect it on /proposals/new."
        actions={
          <Link
            href="/settings/templates/new"
            className="aur-btn aur-btn-primary"
          >
            + New template
          </Link>
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
