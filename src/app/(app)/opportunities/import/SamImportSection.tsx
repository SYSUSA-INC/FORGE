import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { getSamKeyStatus } from "@/lib/samgov-key";
import { ImportClient } from "./ImportClient";

/**
 * BL-NAV-LIFECYCLE 1b — the SAM.gov search, as a section of the Scout
 * tab (it was the Import from SAM.gov page). The caller has passed the
 * org gate and hands in the organization.
 */
export async function SamImportSection({ organizationId }: { organizationId: string }) {
  const [org] = await db
    .select({
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const naics = Array.from(
    new Set(
      // Codes only: a stored entry may carry its title ("541512 - Computer Systems Design").
      [org?.primaryNaics ?? "", ...(org?.naicsList ?? [])].map((s) => (s ?? "").replace(/\D/g, "")).filter((s) => /^\d{2,6}$/.test(s)),
    ),
  );

  // BL-STAB-7d — don't search on arrival when SAM.gov would refuse; the Scout tab above already says why.
  const sam = await getSamKeyStatus(organizationId);
  const autoSearch = sam.usable && !(sam.inUse === "company" && sam.company?.status === "invalid");

  return (
    <>
      {naics.length === 0 ? (
        <Panel title="No NAICS codes configured">
          <p className="text-sm text-muted">
            Add your primary NAICS and any additional NAICS codes in{" "}
            <Link href="/settings" className="text-teal hover:underline">
              Settings → Classification
            </Link>
            , then come back here. You can also search by keyword below without NAICS codes.
          </p>
          <div className="mt-4">
            <ImportClient defaultNaics={[]} autoSearch={false} />
          </div>
        </Panel>
      ) : (
        <ImportClient defaultNaics={naics} autoSearch={autoSearch} />
      )}
    </>
  );
}
