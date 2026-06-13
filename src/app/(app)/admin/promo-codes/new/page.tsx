import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PromoCodeForm } from "../PromoCodeForm";

export const dynamic = "force-dynamic";

export default async function NewPromoCodePage() {
  await requireSuperadmin();

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Promo codes"
        title="New promotional code"
        subtitle="Create a discount code that customers can redeem at checkout. Codes are global — they apply across all tiers."
        actions={
          <Link
            href="/admin/promo-codes"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            ← All codes
          </Link>
        }
      />

      <Panel title="Code details">
        <PromoCodeForm mode="create" />
      </Panel>
    </>
  );
}
