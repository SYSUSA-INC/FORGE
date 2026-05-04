import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { ComingSoonStub } from "@/components/ui/ComingSoonStub";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <ComingSoonStub
      eyebrow="Operations Management"
      title="Audit Log"
      scheduledIn="Chapter 16"
      description="Tenant-scoped activity timeline — who accessed what, when, and what they changed. Filterable by user, action type, and time window. Exportable to CSV for compliance reviews."
      backHref="/settings"
      backLabel="Back to Settings"
    />
  );
}
