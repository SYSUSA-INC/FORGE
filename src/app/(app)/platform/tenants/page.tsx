import { requireSuperadmin } from "@/lib/auth-helpers";
import { ComingSoonStub } from "@/components/ui/ComingSoonStub";

export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage() {
  await requireSuperadmin();

  return (
    <ComingSoonStub
      eyebrow="Platform Administration"
      title="Tenant Administration"
      scheduledIn="Chapter 16"
      description="Customer account management — provision new tenants, assign tiers, suspend or restore access, transfer ownership, view per-tenant data isolation status. Strict multi-tenant boundary enforcement is the default."
      backHref="/admin"
      backLabel="Back to Platform admin"
    />
  );
}
