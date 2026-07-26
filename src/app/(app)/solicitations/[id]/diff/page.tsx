import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAmendmentDiffAction } from "../../actions";
import { DiffView } from "./DiffView";

export const dynamic = "force-dynamic";

/**
 * BL-FB-SOL-AMEND-DIFF — diff page for a single amendment.
 *
 * URL: /solicitations/[id]/diff?base=<baseId>
 *
 * Without `?base`, diffs against the amendment's parent. The base
 * param is here so an operator can compare against an arbitrary
 * ancestor (e.g. Amendment 0003 vs Amendment 0001 instead of the
 * original) — useful when the team wants to see only what's changed
 * since they last re-baselined their proposal.
 */
export default async function AmendmentDiffPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { base?: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Pre-flight: confirm the amendment exists in this org so we can
  // 404 cleanly instead of bubbling the action error.
  const [amendmentRow] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      amendmentNumber: solicitations.amendmentNumber,
      parentSolicitationId: solicitations.parentSolicitationId,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, params.id),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!amendmentRow) notFound();

  // If this solicitation isn't itself an amendment, send the operator
  // back to its detail page — there's nothing to diff against.
  if (!amendmentRow.parentSolicitationId && !searchParams.base) {
    redirect(`/solicitations/${params.id}`);
  }

  const res = await getAmendmentDiffAction(params.id, searchParams.base);

  return (
    <>
      <PageHeader
        eyebrow="Amendment diff"
        title={
          amendmentRow.amendmentNumber
            ? `Amendment ${amendmentRow.amendmentNumber}`
            : amendmentRow.title || "Amendment"
        }
        subtitle={
          res.ok
            ? `Comparing against ${res.base.label}`
            : "Side-by-side comparison vs the parent solicitation"
        }
        actions={
          <Link
            href={`/solicitations/${params.id}`}
            className="aur-btn aur-btn-ghost"
          >
            ← Back to solicitation
          </Link>
        }
      />

      {!res.ok ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-4 py-3 font-mono text-[12px] text-rose">
          {res.error}
        </div>
      ) : (
        <DiffView
          baseLabel={res.base.label}
          amendmentLabel={res.amendment.label}
          diff={res.diff}
        />
      )}
    </>
  );
}
