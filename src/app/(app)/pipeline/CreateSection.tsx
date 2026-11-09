import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { resolvePolicy } from "@/lib/upload-policy";
import { listOpportunityOwners } from "@/app/(app)/opportunities/actions";
import { OpportunityForm, type InitialOpportunity } from "@/app/(app)/opportunities/OpportunityForm";
import { UploadSolicitationForm } from "@/app/(app)/solicitations/new/UploadSolicitationForm";
import { ParseWaiter } from "./ParseWaiter";

function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * BL-NAV-LIFECYCLE 1a (FORGE II, footnote 4) — Create: New opportunity and
 * New solicitation on one page. Start from a document (it is read, the
 * form is filled from it, and saving creates the opportunity with the
 * document linked) or fill in by hand. Either way it lands in the
 * pipeline.
 */
export async function CreateSection({
  from,
  wait,
  afterCreate,
}: {
  from?: string;
  wait: boolean;
  afterCreate?: "proposal";
}) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const userId = user.id;
  const owners = await listOpportunityOwners();
  const maxBytes = resolvePolicy("document", process.env).maxBytes;

  // ── Created from a document: read it, then the form filled from it.
  if (from) {
    const [doc] = await db
      .select({
        id: solicitations.id,
        fileName: solicitations.fileName,
        parseStatus: solicitations.parseStatus,
        parseError: solicitations.parseError,
        opportunityId: solicitations.opportunityId,
        title: solicitations.title,
        agency: solicitations.agency,
        office: solicitations.office,
        solicitationNumber: solicitations.solicitationNumber,
        noticeId: solicitations.noticeId,
        naicsCode: solicitations.naicsCode,
        setAside: solicitations.setAside,
        responseDueDate: solicitations.responseDueDate,
        postedDate: solicitations.postedDate,
      })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, from)))
      .limit(1);

    if (!doc) {
      return (
        <Panel title="Document not found" eyebrow="Create">
          <p className="font-body text-[13px] text-muted">
            That document is not in this workspace.{" "}
            <Link href="/pipeline/identify?tab=create" className="font-medium text-cobalt hover:underline">
              Start again
            </Link>
            .
          </p>
        </Panel>
      );
    }
    if (doc.opportunityId) {
      return (
        <Panel title="Already in the pipeline" eyebrow={doc.fileName || "Document"}>
          <p className="font-body text-[13px] text-muted">This document already belongs to an opportunity.</p>
          <Link href={`/opportunities/${doc.opportunityId}`} className="aur-btn aur-btn-primary mt-3 inline-flex">
            Open the opportunity
          </Link>
        </Panel>
      );
    }

    const reading = doc.parseStatus === "uploaded" || doc.parseStatus === "parsing";
    if (reading && wait) {
      return (
        <Panel title="Reading the document…" eyebrow={doc.fileName || "Document"}>
          <ParseWaiter />
          <p className="font-body text-[13px] leading-[1.5] text-muted">
            FORGE is reading it for the title, agency, solicitation number, NAICS, set-aside and due date, and for its requirements and Sections L and M. The form opens filled in when it is done; a large document can take a few minutes.
          </p>
          <Link href={`/pipeline/identify?tab=create&from=${doc.id}&wait=0`} className="aur-link mt-3">
            Don&apos;t wait: fill in the rest by hand
          </Link>
        </Panel>
      );
    }

    const initial: InitialOpportunity = {
      title: doc.title || doc.fileName.replace(/\.[^.]+$/, ""),
      agency: doc.agency,
      office: doc.office,
      solicitationNumber: doc.solicitationNumber,
      noticeId: doc.noticeId,
      naicsCode: doc.naicsCode,
      setAside: doc.setAside,
      responseDueDate: day(doc.responseDueDate),
      releaseDate: day(doc.postedDate),
      stage: "identified",
    };
    return (
      <Panel title="Check what FORGE read, then add it" eyebrow={doc.fileName || "Document"}>
        <p className="mb-4 font-body text-[13px] leading-[1.5] text-muted">
          {doc.parseStatus === "parsed"
            ? "Filled in from the document. Correct anything that is off; saving adds the opportunity to the pipeline with the document linked, so its requirements and Sections L and M are already there for Evaluate."
            : doc.parseStatus === "failed"
              ? `FORGE could not read the document${doc.parseError ? ` (${doc.parseError})` : ""}. Fill in the fields; the document is still linked when you save.`
              : "Still reading the document. Fill in what you know; the document is linked when you save, and its reading finishes on the opportunity."}
        </p>
        <OpportunityForm mode="create" owners={owners} defaultOwnerUserId={userId} afterCreate={afterCreate} initial={initial} solicitationId={doc.id} />
      </Panel>
    );
  }

  // ── The two ways in.
  return (
    <>
      <Panel title="Start from a document" eyebrow="RFP · RFI · RFQ · Sources Sought">
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          Drop the solicitation. FORGE reads it, fills in the opportunity for you to check, and keeps the document on it, with its requirements and Sections L and M.
        </p>
        <UploadSolicitationForm maxBytes={maxBytes} then="create" />
      </Panel>
      <div className="mt-6">
        <Panel title="Or fill in by hand" eyebrow="A lead, an RFI, a pre-RFP notice">
          <OpportunityForm mode="create" owners={owners} defaultOwnerUserId={userId} afterCreate={afterCreate} />
        </Panel>
      </div>
    </>
  );
}
