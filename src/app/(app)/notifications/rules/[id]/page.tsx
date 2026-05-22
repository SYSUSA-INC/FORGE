import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import {
  getNotificationRuleAction,
  listOrgUsersForRecipientPickerAction,
} from "../actions";
import { RuleEditorForm } from "../RuleEditorForm";
import { TRIGGER_EVENT_KIND_LABELS } from "@/lib/notification-rules-types";
import type { NotificationTriggerEventKind } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function EditNotificationRulePage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [rule, orgUsers] = await Promise.all([
    getNotificationRuleAction(params.id),
    listOrgUsersForRecipientPickerAction(),
  ]);

  if (!rule) notFound();

  const triggerLabel =
    TRIGGER_EVENT_KIND_LABELS[
      rule.triggerEventKind as NotificationTriggerEventKind
    ] ?? rule.triggerEventKind;

  return (
    <>
      <PageHeader
        eyebrow="Operations Management"
        title={rule.name}
        subtitle={
          rule.description ||
          `Edits the rule that fires on "${triggerLabel}". Toggle Active in the Status panel to enable / disable; Delete is permanent.`
        }
        actions={
          <Link
            href="/notifications/rules"
            className="aur-btn aur-btn-ghost"
          >
            Back to rules
          </Link>
        }
        meta={[
          { label: "Trigger", value: triggerLabel },
          {
            label: "State",
            value: rule.active ? "Active" : "Inactive",
            accent: rule.active ? "emerald" : undefined,
          },
        ]}
      />
      <RuleEditorForm
        mode="edit"
        ruleId={rule.id}
        initial={rule}
        orgUsers={orgUsers}
      />
    </>
  );
}
