import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitationDocuments, solicitations } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { describeSource } from "@/lib/requirement-provenance";
import {
  docKeyOf,
  originalOf,
  reviewCounts,
  reviewKeyOf,
  sourceSnippet,
  verifyOrder,
  type ReviewedRequirement,
} from "@/lib/requirement-review";
import { VerifyClient, type VerifyItem } from "./VerifyClient";

export const dynamic = "force-dynamic";

/**
 * BL-AIX Phase 2c — verify and correct a solicitation's extracted
 * requirements: confirm, edit or reject each against the document text
 * around it, or add one the extraction missed.
 */
export default async function VerifyRequirementsPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [s] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      rawText: solicitations.rawText,
      extractedRequirements: solicitations.extractedRequirements,
    })
    .from(solicitations)
    .where(and(eq(solicitations.id, params.id), eq(solicitations.organizationId, organizationId)))
    .limit(1);
  if (!s) notFound();

  const docs = await db
    .select({ id: solicitationDocuments.id, fileName: solicitationDocuments.fileName, rawText: solicitationDocuments.rawText })
    .from(solicitationDocuments)
    .where(and(eq(solicitationDocuments.solicitationId, s.id), eq(solicitationDocuments.organizationId, organizationId)));
  const docById = new Map(docs.map((d) => [d.id, d]));

  const list = (s.extractedRequirements ?? []) as ReviewedRequirement[];
  const items: VerifyItem[] = verifyOrder(list).map((r) => {
    const doc = r.sourceDocId ? docById.get(r.sourceDocId) : undefined;
    const original = originalOf(r);
    return {
      docKey: docKeyOf(r),
      originalKey: reviewKeyOf(r),
      kind: r.kind,
      text: r.text,
      ref: r.ref,
      original: r.review?.original ?? null,
      status: r.review?.status ?? null,
      quote: r.source?.quote ?? null,
      where: describeSource(r.source),
      snippet: sourceSnippet(doc ? doc.rawText : s.rawText, r.source?.at, original.text.length),
      docName: doc?.fileName ?? "",
    };
  });
  const counts = reviewCounts(list);
  const verbatimToConfirm = list.filter((r) => !r.review && r.source?.quote === "exact").length;

  return (
    <>
      <PageHeader
        eyebrow="Verify requirements"
        title={s.title || "Solicitation"}
        subtitle={`${list.length} requirements · ${counts.unreviewed} to review (${counts.notFound} not found in source) · ${counts.confirmed} confirmed · ${counts.edited} edited · ${counts.rejected} rejected · ${counts.added} added`}
        actions={
          <Link href={`/solicitations/${s.id}`} className="aur-btn aur-btn-ghost">
            ← Back to solicitation
          </Link>
        }
      />
      <Panel title="Requirements" eyebrow="Confirm, edit or reject each against the document">
        <p className="mb-3 font-body text-[12px] leading-relaxed text-muted">
          Rejected requirements leave the compliance matrix seed, the drafter and the health scan; edits replace the wording
          everywhere. Matrix rows already created are not changed. Your verdicts are kept for this organization only and are applied
          again if the solicitation is re-parsed.
        </p>
        <VerifyClient solicitationId={s.id} items={items} verbatimToConfirm={verbatimToConfirm} />
      </Panel>
    </>
  );
}
