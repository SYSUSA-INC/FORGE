import { desc } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { promotionCodes } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * BL-16 Phase C-4 — promo code list.
 *
 * Superadmin-only. Lists every code with redemption stats. Click
 * any row to edit; click + New code to create. Redemption itself
 * lands with BL-17 billing integration.
 */
export default async function PromoCodesPage() {
  await requireSuperadmin();

  const rows = await db
    .select()
    .from(promotionCodes)
    .orderBy(desc(promotionCodes.createdAt));

  const totalCount = rows.length;
  const activeCount = rows.filter((r) => r.active).length;
  const totalRedemptions = rows.reduce((sum, r) => sum + r.timesUsed, 0);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Promo codes"
        title="Promotional codes"
        subtitle="Discount codes redeemable at checkout. Redemption flow ships with BL-17 (billing); for now this surface is CRUD."
        actions={
          <>
            <Link
              href="/admin/promo-codes/new"
              className="aur-btn aur-btn-primary text-[11px]"
            >
              + New code
            </Link>
            <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
              ← SuperAdmin portal
            </Link>
          </>
        }
        meta={[
          { label: "Codes", value: String(totalCount) },
          {
            label: "Active",
            value: String(activeCount),
            accent: "emerald",
          },
          { label: "Total redemptions", value: String(totalRedemptions) },
        ]}
      />

      <Panel title="All codes">
        {rows.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No promo codes yet. Click <strong>+ New code</strong> above to
            create one.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const expired = r.validUntil
                ? r.validUntil < new Date()
                : false;
              const exhausted = r.maxUses > 0 && r.timesUsed >= r.maxUses;
              const usable = r.active && !expired && !exhausted;
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/admin/promo-codes/${r.id}`}
                      className="flex items-baseline gap-3 hover:underline"
                    >
                      <span className="font-display text-[14px] font-semibold text-text">
                        {r.code}
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        {r.discountPercent}% off
                      </span>
                    </Link>
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                      {!r.active ? (
                        <span className="rounded bg-rose/20 px-1.5 py-0.5 text-rose">
                          Inactive
                        </span>
                      ) : null}
                      {expired ? (
                        <span className="rounded bg-rose/20 px-1.5 py-0.5 text-rose">
                          Expired
                        </span>
                      ) : null}
                      {exhausted ? (
                        <span className="rounded bg-rose/20 px-1.5 py-0.5 text-rose">
                          Maxed out
                        </span>
                      ) : null}
                      {usable ? (
                        <span className="rounded bg-emerald/20 px-1.5 py-0.5 text-emerald">
                          Usable
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {r.description ? (
                    <div className="mt-1 max-w-3xl font-mono text-[11px] text-muted">
                      {r.description}
                    </div>
                  ) : null}

                  <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] md:grid-cols-4">
                    <RowField
                      label="Valid from"
                      value={r.validFrom?.toLocaleDateString() ?? "—"}
                    />
                    <RowField
                      label="Valid until"
                      value={r.validUntil?.toLocaleDateString() ?? "—"}
                    />
                    <RowField
                      label="Uses"
                      value={
                        r.maxUses === 0
                          ? `${r.timesUsed} / unlimited`
                          : `${r.timesUsed} / ${r.maxUses}`
                      }
                    />
                    <RowField
                      label="Created"
                      value={r.createdAt.toLocaleDateString()}
                    />
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function RowField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-text">{value}</div>
    </div>
  );
}
