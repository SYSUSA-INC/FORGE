import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { SamKeyNotice } from "@/components/ui/SamKeyNotice";
import { getSamKeyStatus } from "@/lib/samgov-key";
import { samKeyNotice } from "@/lib/samgov-key-logic";
import { ImportClient } from "./ImportClient";
import { listOwnSourceRequestsAction } from "./source-requests/actions";
import { SourceRequestPanel } from "./source-requests/SourceRequestPanel";

export const dynamic = "force-dynamic";
// BL-STAB-10 — a search is one SAM.gov request per NAICS code (up to 10) plus a few description reads.
export const maxDuration = 300;

export default async function ImportPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [org] = await db
    .select({
      primaryNaics: organizations.primaryNaics,
      naicsList: organizations.naicsList,
      setAsides: organizations.socioEconomic,
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

  const ownRequests = await listOwnSourceRequestsAction();
  // BL-STAB-7d — say why SAM.gov searches would fail, and don't search on arrival when they would.
  const sam = await getSamKeyStatus(organizationId);
  const samNotice = samKeyNotice(sam);
  const autoSearch = sam.usable && !(sam.inUse === "company" && sam.company?.status === "invalid");

  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="Import from SAM.gov"
        subtitle="Search live solicitations from SAM.gov matching your organization's NAICS codes and pull them into your opportunities."
        actions={
          <>
            <Link
              href="/opportunities/import/ebuy"
              className="aur-btn aur-btn-ghost"
              title="Paste an eBuy RFQ. eBuy isn't on SAM.gov."
            >
              Paste from eBuy
            </Link>
            <Link
              href="/opportunities/import/gsa"
              className="aur-btn aur-btn-ghost"
              title="Paste any forwarded GSA opportunity email — RFP, RFQ, sources sought. Optionally attach the RFP file."
            >
              Paste GSA email
            </Link>
            <Link href="/opportunities" className="aur-btn aur-btn-ghost">
              Back to opportunities
            </Link>
          </>
        }
      />

      <SamKeyNotice notice={samNotice} />
      {naics.length === 0 ? (
        <Panel title="No NAICS codes configured">
          <p className="text-sm text-muted">
            Add your primary NAICS and any additional NAICS codes in{" "}
            <Link href="/settings" className="text-teal hover:underline">
              Settings → Classification
            </Link>
            , then come back here. You can also search by keyword below without
            NAICS codes.
          </p>
          <div className="mt-4">
            <ImportClient defaultNaics={[]} autoSearch={false} />
          </div>
        </Panel>
      ) : (
        <ImportClient defaultNaics={naics} autoSearch={autoSearch} />
      )}

      <div className="mt-6">
        <SourceRequestPanel initialOwnRequests={ownRequests} />
      </div>
    </>
  );
}
