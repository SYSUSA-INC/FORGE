import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
} from "@/lib/company-types";
import { CompanyForm } from "../CompanyForm";
import { CompanyDetailActions } from "./CompanyDetailActions";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [c] = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.id, params.id),
        eq(companies.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!c) notFound();

  const relColor = RELATIONSHIP_COLORS[c.relationship];
  const relLabel = RELATIONSHIP_LABELS[c.relationship];

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title={c.name}
        subtitle={[c.city, c.state].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <Link href="/companies" className="aur-btn aur-btn-ghost">
              Back
            </Link>
            <CompanyDetailActions id={c.id} hasUei={!!c.uei} name={c.name} />
          </>
        }
        meta={[
          { label: "Relationship", value: relLabel },
          { label: "UEI", value: c.uei || "—" },
          { label: "CAGE", value: c.cageCode || "—" },
          {
            label: "SAM status",
            value: c.registrationStatus || "—",
            accent:
              c.registrationStatus?.toLowerCase() === "active"
                ? "emerald"
                : undefined,
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: relColor }}
        />
        <div
          className="rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.22em]"
          style={{
            color: relColor,
            backgroundColor: `${relColor}1A`,
            border: `1px solid ${relColor}40`,
          }}
        >
          {relLabel}
        </div>
        {c.syncSource === "samgov" && c.lastSyncedAt ? (
          <span className="ml-auto font-mono text-[10px] text-muted">
            Last SAM.gov sync: {new Date(c.lastSyncedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      <Panel title="Edit company">
        <CompanyForm
          mode="edit"
          id={c.id}
          initial={{
            name: c.name,
            uei: c.uei,
            cageCode: c.cageCode,
            dunsNumber: c.dunsNumber,
            website: c.website,
            email: c.email,
            phone: c.phone,
            contactName: c.contactName,
            contactTitle: c.contactTitle,
            addressLine1: c.addressLine1,
            addressLine2: c.addressLine2,
            city: c.city,
            state: c.state,
            zip: c.zip,
            country: c.country,
            primaryNaics: c.primaryNaics,
            relationship: c.relationship,
            notes: c.notes,
          }}
        />
      </Panel>
    </>
  );
}
