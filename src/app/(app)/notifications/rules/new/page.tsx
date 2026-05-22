import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { listOrgUsersForRecipientPickerAction } from "../actions";
import { RuleEditorForm } from "../RuleEditorForm";

export const dynamic = "force-dynamic";

export default async function NewNotificationRulePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const orgUsers = await listOrgUsersForRecipientPickerAction();

  return (
    <>
      <PageHeader
        eyebrow="Operations Management"
        title="New notification rule"
        subtitle="Bind a trigger event to a recipient strategy. Configure channels, frequency, and an optional SLA. The rule fires the next time the trigger matches once it's active."
        actions={
          <Link
            href="/notifications/rules"
            className="aur-btn aur-btn-ghost"
          >
            Back to rules
          </Link>
        }
      />
      <RuleEditorForm mode="create" initial={null} orgUsers={orgUsers} />
    </>
  );
}
