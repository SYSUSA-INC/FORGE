import { requireSuperadmin } from "@/lib/auth-helpers";
import { ComingSoonStub } from "@/components/ui/ComingSoonStub";

export const dynamic = "force-dynamic";

export default async function PlatformConfigurationPage() {
  await requireSuperadmin();

  return (
    <ComingSoonStub
      eyebrow="Platform Administration"
      title="Platform Configuration"
      scheduledIn="Chapter 16"
      description="Tier offerings (Bronze, Silver, Gold, Platinum, Custom) plus active promotions. Each tier specifies feature flags, seat counts, AI request quotas, storage caps, and pricing. Tenants are assigned a tier; runtime gates check the tenant's tier on every billable action."
      backHref="/admin"
      backLabel="Back to Platform admin"
    />
  );
}
