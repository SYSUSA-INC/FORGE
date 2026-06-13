import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { promotionCodes } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PromoCodeForm } from "../PromoCodeForm";

export const dynamic = "force-dynamic";

export default async function EditPromoCodePage({
  params,
}: {
  params: { id: string };
}) {
  await requireSuperadmin();

  const [row] = await db
    .select()
    .from(promotionCodes)
    .where(eq(promotionCodes.id, params.id))
    .limit(1);

  if (!row) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Promo codes"
        title={`Edit: ${row.code}`}
        subtitle="Update the discount, validity window, or status. The code string itself is editable but must stay unique."
        actions={
          <Link
            href="/admin/promo-codes"
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            ← All codes
          </Link>
        }
        meta={[
          {
            label: "Status",
            value: row.active ? "Active" : "Inactive",
            accent: row.active ? "emerald" : "rose",
          },
          {
            label: "Redemptions",
            value:
              row.maxUses === 0
                ? `${row.timesUsed} / unlimited`
                : `${row.timesUsed} / ${row.maxUses}`,
          },
          {
            label: "Created",
            value: row.createdAt.toLocaleDateString(),
          },
        ]}
      />

      <Panel title="Code details">
        <PromoCodeForm
          mode="edit"
          codeId={row.id}
          initial={{
            code: row.code,
            description: row.description,
            discountPercent: row.discountPercent,
            validFrom: row.validFrom?.toISOString() ?? null,
            validUntil: row.validUntil?.toISOString() ?? null,
            maxUses: row.maxUses,
            active: row.active,
          }}
        />
      </Panel>
    </>
  );
}
