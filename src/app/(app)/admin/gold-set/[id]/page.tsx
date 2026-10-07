import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { getGoldDoc } from "@/lib/gold-set";
import { canApproveGoldDoc } from "@/lib/gold-set-logic";
import { AiDraftPanel } from "./AiDraftPanel";
import { GoldReviewClient } from "./GoldReviewClient";

export const dynamic = "force-dynamic";

/** BL-AIX Phase 1e — review one gold document's annotations. */
export default async function GoldDocPage({ params }: { params: { id: string } }) {
  await requireSuperadmin();
  const got = await getGoldDoc(params.id);
  if (!got) notFound();
  const { doc, items, progress } = got;
  const approvable = canApproveGoldDoc(progress);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Extraction gold set"
        title={doc.title}
        subtitle={[
          doc.solicitationNumber,
          doc.noticeId ? `notice ${doc.noticeId}` : "",
          `${Math.round(doc.rawText.length / 1000)}k characters`,
          `status: ${doc.status.replace("_", " ")}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href="/admin/gold-set" className="aur-btn aur-btn-ghost text-[11px]">
            All documents
          </Link>
        }
      />
      <Panel title="Source files" eyebrow={doc.sourceUrl ? doc.sourceUrl : undefined}>
        <ul className="flex flex-col gap-1 font-mono text-[11px]">
          {doc.files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex flex-wrap justify-between gap-2">
              <span className="text-text">{f.name}</span>
              <span className={f.note ? "text-gold" : "text-muted"}>
                {f.chars.toLocaleString()} chars{f.note ? ` · ${f.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {doc.notes ? <p className="mt-2 font-mono text-[11px] text-gold">{doc.notes}</p> : null}
      </Panel>
      <div className="mt-4">
        <AiDraftPanel docId={doc.id} state={doc.aiDraft} approved={doc.status === "approved"} />
      </div>
      <div className="mt-4">
        <GoldReviewClient
          docId={doc.id}
          status={doc.status}
          items={items.map((i) => ({
            id: i.id,
            kind: i.kind,
            ref: i.ref,
            text: i.text,
            value: i.value,
            position: i.position,
            origin: i.origin,
            status: i.status,
          }))}
          approveBlockedReason={approvable.ok ? null : approvable.reason}
        />
      </div>
    </>
  );
}
