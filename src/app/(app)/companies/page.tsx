import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  RELATIONSHIPS,
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
} from "@/lib/company-types";
import { CompaniesClient } from "./CompaniesClient";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select()
    .from(companies)
    .where(eq(companies.organizationId, organizationId))
    .orderBy(desc(companies.updatedAt));

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Intel"
          title="Companies"
          subtitle="Track customers, primes, subcontractors, teaming partners, and competitors."
          actions={
            <>
              <Link
                href="/companies/search"
                className="aur-btn aur-btn-ghost"
              >
                Search SAM.gov
              </Link>
              <Link
                href="/companies/new"
                className="aur-btn aur-btn-primary"
              >
                + Add company
              </Link>
            </>
          }
        />
        <Panel title="No companies yet">
          <p className="text-sm text-muted">
            Add companies manually or pull their profile from SAM.gov. Tag each
            company with a relationship type so you can filter quickly.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/companies/search" className="aur-btn aur-btn-primary">
              Search SAM.gov
            </Link>
            <Link href="/companies/new" className="aur-btn aur-btn-ghost">
              Add manually
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.relationship] = (counts[r.relationship] ?? 0) + 1;

  return (
    <CompaniesClient
      relationships={RELATIONSHIPS}
      relationshipLabels={RELATIONSHIP_LABELS}
      relationshipColors={RELATIONSHIP_COLORS}
      counts={counts}
      companies={rows.map((c) => ({
        id: c.id,
        name: c.name,
        uei: c.uei,
        cageCode: c.cageCode,
        primaryNaics: c.primaryNaics,
        city: c.city,
        state: c.state,
        registrationStatus: c.registrationStatus,
        registrationExpirationDate: c.registrationExpirationDate
          ? c.registrationExpirationDate.toISOString()
          : null,
        relationship: c.relationship,
        sbaCertifications: c.sbaCertifications,
        updatedAt: c.updatedAt.toISOString(),
        syncSource: c.syncSource,
      }))}
    />
  );
}
