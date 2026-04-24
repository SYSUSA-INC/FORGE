import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SearchClient } from "./SearchClient";

export const dynamic = "force-dynamic";

export default async function CompanySearchPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [org] = await db
    .select({
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const defaultNaics = org?.primaryNaics ?? "";
  const orgNaicsList = Array.from(
    new Set(
      [org?.primaryNaics ?? "", ...(org?.naicsList ?? [])].filter(
        (s) => s && s.trim(),
      ),
    ),
  );

  return (
    <>
      <PageHeader
        eyebrow="Intel"
        title="Search SAM.gov entities"
        subtitle="Find registered companies by name, UEI, CAGE, or NAICS. Prefilled with your org's NAICS codes; swap in any value to broaden or narrow."
        actions={
          <Link href="/companies" className="aur-btn aur-btn-ghost">
            Back to companies
          </Link>
        }
      />
      <Panel title="Entity search">
        <SearchClient
          defaultNaics={defaultNaics}
          orgNaicsList={orgNaicsList}
        />
      </Panel>
    </>
  );
}
