"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalPdfRenders,
  proposalSections,
  proposalTemplates,
  proposals,
  users,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getPdfProvider, getPdfProviderStatus } from "@/lib/pdf";
import {
  getStorageProvider,
  getStorageProviderStatus,
} from "@/lib/storage";
import { renderProposalHtml } from "@/lib/pdf-template-render";

export type PdfRenderResult =
  | {
      ok: true;
      id: string;
      contentType: string;
      provider: string;
      stubbed: boolean;
      byteSize: number;
      downloadUrl: string;
      renderedAt: string;
    }
  | { ok: false; error: string };

export async function renderProposalPdfAction(
  proposalId: string,
): Promise<PdfRenderResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // 1. Load proposal + its opportunity + template + sections + org.
  const [propRow] = await db
    .select({
      proposal: proposals,
      opportunityTitle: opportunities.title,
      opportunityAgency: opportunities.agency,
      opportunitySolicitation: opportunities.solicitationNumber,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!propRow) return { ok: false, error: "Proposal not found." };

  const [orgRow] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      uei: organizations.uei,
      cageCode: organizations.cageCode,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) return { ok: false, error: "Organization not found." };

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
      bodyDoc: proposalSections.bodyDoc,
      status: proposalSections.status,
      wordCount: proposalSections.wordCount,
      kind: proposalSections.kind,
      pageLimit: proposalSections.pageLimit,
      content: proposalSections.content,
      authorUserId: proposalSections.authorUserId,
      proposalId: proposalSections.proposalId,
      createdAt: proposalSections.createdAt,
      updatedAt: proposalSections.updatedAt,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  let template: typeof proposalTemplates.$inferSelect | null = null;
  if (propRow.proposal.templateId) {
    const [t] = await db
      .select()
      .from(proposalTemplates)
      .where(eq(proposalTemplates.id, propRow.proposal.templateId))
      .limit(1);
    template = t ?? null;
  }

  // 2. Compose the HTML document.
  const html = renderProposalHtml({
    organization: orgRow,
    proposal: {
      id: propRow.proposal.id,
      title: propRow.proposal.title,
      submittedAt: propRow.proposal.submittedAt,
      agency: propRow.opportunityAgency,
      solicitationNumber: propRow.opportunitySolicitation,
    },
    sections,
    template,
  });

  // 3. Render via the PDF provider (Browserless live, or stub returns HTML).
  let rendered;
  try {
    const provider = getPdfProvider();
    rendered = await provider.render(html);
  } catch (err) {
    console.error("[renderProposalPdfAction] provider.render failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PDF render failed.",
    };
  }

  // 4. Persist the bytes via the storage provider.
  const renderId = crypto.randomUUID();
  const storageKey = `org/${organizationId}/proposal/${proposalId}/render/${renderId}.${
    rendered.contentType === "application/pdf" ? "pdf" : "html"
  }`;
  let stored;
  try {
    const storage = getStorageProvider();
    stored = await storage.put({
      key: storageKey,
      bytes: rendered.bytes,
      contentType: rendered.contentType,
    });
  } catch (err) {
    console.error("[renderProposalPdfAction] storage.put failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Storage write failed.",
    };
  }

  // 5. Insert the render row. Download URL is our internal download
  //    route so we abstract over storage providers.
  const downloadUrl = `/api/proposals/${proposalId}/pdf/${renderId}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

  try {
    await db.insert(proposalPdfRenders).values({
      id: renderId,
      proposalId,
      organizationId,
      templateId: propRow.proposal.templateId,
      renderedByUserId: user.id,
      storagePath: stored.storagePath,
      contentType: rendered.contentType === "application/pdf" ? "pdf" : "html",
      byteSize: stored.byteSize,
      pageCount: rendered.pageCount,
      provider: rendered.provider,
      downloadUrl,
      expiresAt,
    });
  } catch (err) {
    console.error("[renderProposalPdfAction] insert failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to record render.",
    };
  }

  revalidatePath(`/proposals/${proposalId}`);
  return {
    ok: true,
    id: renderId,
    contentType: rendered.contentType,
    provider: rendered.provider,
    stubbed: rendered.stubbed,
    byteSize: stored.byteSize,
    downloadUrl,
    renderedAt: new Date().toISOString(),
  };
}

export type RecentRenderRow = {
  id: string;
  contentType: string;
  byteSize: number;
  pageCount: number;
  provider: string;
  downloadUrl: string;
  renderedAt: string;
  authorName: string | null;
  authorEmail: string | null;
};

export async function listRecentRendersAction(
  proposalId: string,
  limit = 10,
): Promise<RecentRenderRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: proposalPdfRenders.id,
      contentType: proposalPdfRenders.contentType,
      byteSize: proposalPdfRenders.byteSize,
      pageCount: proposalPdfRenders.pageCount,
      provider: proposalPdfRenders.provider,
      downloadUrl: proposalPdfRenders.downloadUrl,
      renderedAt: proposalPdfRenders.renderedAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(proposalPdfRenders)
    .leftJoin(users, eq(users.id, proposalPdfRenders.renderedByUserId))
    .where(
      and(
        eq(proposalPdfRenders.proposalId, proposalId),
        eq(proposalPdfRenders.organizationId, organizationId),
      ),
    )
    .orderBy(desc(proposalPdfRenders.renderedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    contentType: r.contentType,
    byteSize: r.byteSize,
    pageCount: r.pageCount,
    provider: r.provider,
    downloadUrl: r.downloadUrl,
    renderedAt: r.renderedAt.toISOString(),
    authorName: r.authorName,
    authorEmail: r.authorEmail,
  }));
}

export async function getProviderStatusAction() {
  await requireAuth();
  return {
    pdf: getPdfProviderStatus(),
    storage: getStorageProviderStatus(),
  };
}
