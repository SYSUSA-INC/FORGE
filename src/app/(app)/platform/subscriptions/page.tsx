import { requireSuperadmin } from "@/lib/auth-helpers";
import { ComingSoonStub } from "@/components/ui/ComingSoonStub";

export const dynamic = "force-dynamic";

export default async function PlatformSubscriptionsPage() {
  await requireSuperadmin();

  return (
    <ComingSoonStub
      eyebrow="Platform Administration"
      title="Subscriptions"
      scheduledIn="Chapter 16"
      description="Active subscriptions, trials, subscription types, and upcoming expirations across all tenants. Filter by tier, status, and renewal window. Drill into a subscription to view usage against the tier's quotas."
      backHref="/admin"
      backLabel="Back to Platform admin"
    />
  );
}
