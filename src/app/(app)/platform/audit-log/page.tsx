import { requireSuperadmin } from "@/lib/auth-helpers";
import { ComingSoonStub } from "@/components/ui/ComingSoonStub";

export const dynamic = "force-dynamic";

export default async function PlatformAuditLogPage() {
  await requireSuperadmin();

  return (
    <ComingSoonStub
      eyebrow="Platform Administration"
      title="Platform Audit Log"
      scheduledIn="Chapter 16"
      description="Cross-tenant audit feed for the platform operator. Filter by tenant, event type, actor, and time window. Distinct from each tenant's per-org Audit Log under Operations Management — this view spans every customer."
      backHref="/admin"
      backLabel="Back to Platform admin"
    />
  );
}
