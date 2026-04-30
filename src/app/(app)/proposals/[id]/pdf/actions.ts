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
import { renderProposalToDocx } from "@/lib/docx-render";
import {
  getDocxToPdfProvider,
  getDocxToPdfProviderStatus,
} from "@/lib/docx-to-pdf";

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

export type DocxRenderActionResult =
  | {
      ok: true;
      id: string;
      byteSize: number;
      downloadUrl: string;
      renderedAt: string;
    }
  | { ok: false; error: string };

/**
 * Generate a .docx export of the proposal using the template's
 * uploaded Word file (Phase 12a). docxtemplater fills the placeholders
 * and we persist + return a download URL through the existing
 * proposal_pdf_render row + /api/proposals/.../pdf/... route. The
 * route already content-type-switches by the row's `contentType`.
 */
export async function renderProposalDocxAction(
  proposalId: string,
): Promise<DocxRenderActionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Pull proposal + opportunity inline; we need the opportunity for
  // agency / NAICS / set-aside variables.
  const [propRow] = await db
    .select({ proposal: proposals, opportunity: opportunities })
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

  if (!propRow.proposal.templateId) {
    return {
      ok: false,
      error:
        "This proposal has no template assigned. Pick a Word template under Settings → Templates first.",
    };
  }

  const [template] = await db
    .select()
    .from(proposalTemplates)
    .where(eq(proposalTemplates.id, propRow.proposal.templateId))
    .limit(1);
  if (!template) return { ok: false, error: "Template not found." };

  if (template.kind !== "docx") {
    return {
      ok: false,
      error:
        "This template is in legacy HTML/CSS mode. Switch it to Word and upload a .docx, then try again.",
    };
  }
  if (!template.docxStoragePath) {
    return {
      ok: false,
      error:
        "Template has no .docx file uploaded yet. Upload one on the template settings page.",
    };
  }

  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) return { ok: false, error: "Organization not found." };

  const sections = await db
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  // Pull template bytes from storage. If the storage provider is the
  // memory stub and the bytes are gone (post-deploy), surface a clear
  // error rather than crashing.
  const storage = getStorageProvider();
  const templateObj = await storage.get(template.docxStoragePath);
  if (!templateObj) {
    return {
      ok: false,
      error:
        "Template file bytes are no longer in storage — re-upload the .docx on the template settings page. (Memory storage doesn't survive redeploys.)",
    };
  }

  // Render. Synchronous + cheap (docxtemplater runs in-memory).
  const result = renderProposalToDocx({
    template,
    templateBytes: templateObj.bytes,
    proposal: propRow.proposal,
    opportunity: propRow.opportunity,
    organization: orgRow,
    sections,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Persist to storage so downloads can be served via the same route.
  const renderId = crypto.randomUUID();
  const storageKey = `org/${organizationId}/proposal/${proposalId}/render/${renderId}.docx`;
  let stored;
  try {
    stored = await storage.put({
      key: storageKey,
      bytes: result.bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } catch (err) {
    console.error("[renderProposalDocxAction] storage.put failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Storage write failed.",
    };
  }

  const downloadUrl = `/api/proposals/${proposalId}/pdf/${renderId}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

  try {
    await db.insert(proposalPdfRenders).values({
      id: renderId,
      proposalId,
      organizationId,
      templateId: template.id,
      renderedByUserId: user.id,
      storagePath: stored.storagePath,
      contentType: "docx",
      byteSize: stored.byteSize,
      pageCount: 0, // Word doesn't expose final page count without rendering; left as 0.
      provider: "docxtemplater",
      downloadUrl,
      expiresAt,
    });
  } catch (err) {
    console.error("[renderProposalDocxAction] insert failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to record render.",
    };
  }

  revalidatePath(`/proposals/${proposalId}`);
  return {
    ok: true,
    id: renderId,
    byteSize: stored.byteSize,
    downloadUrl,
    renderedAt: new Date().toISOString(),
  };
}

export type DocxAsPdfResult =
  | {
      ok: true;
      id: string;
      contentType: "pdf" | "docx";
      byteSize: number;
      downloadUrl: string;
      renderedAt: string;
      provider: string;
      stubbed: boolean;
    }
  | { ok: false; error: string };

/**
 * Phase 12d — render the proposal through the Word template AND
 * convert the resulting .docx into a .pdf using the docx-to-pdf
 * provider gateway. Preserves all the Word fidelity (header, footer,
 * cover page, TOC, page numbering) since the conversion runs through
 * an Office-grade renderer (CloudConvert / LibreOffice).
 *
 * If the conversion provider is in stub mode, we record + return the
 * .docx bytes so the user still gets a usable file and the UI can
 * tell them to set CLOUDCONVERT_API_KEY.
 */
export async function renderProposalDocxAsPdfAction(
  proposalId: string,
): Promise<DocxAsPdfResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Reuse the same loaders as the docx render. Inline duplication
  // would be cleaner if extracted, but keeping symmetry with the
  // existing docx flow makes this PR small and reviewable.
  const [propRow] = await db
    .select({ proposal: proposals, opportunity: opportunities })
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

  if (!propRow.proposal.templateId) {
    return {
      ok: false,
      error:
        "This proposal has no template assigned. Pick a Word template under Settings → Templates first.",
    };
  }

  const [template] = await db
    .select()
    .from(proposalTemplates)
    .where(eq(proposalTemplates.id, propRow.proposal.templateId))
    .limit(1);
  if (!template) return { ok: false, error: "Template not found." };
  if (template.kind !== "docx") {
    return {
      ok: false,
      error:
        "This template is in legacy HTML/CSS mode. Use the regular Generate button for HTML→PDF.",
    };
  }
  if (!template.docxStoragePath) {
    return {
      ok: false,
      error:
        "Template has no .docx file uploaded yet. Upload one on the template settings page.",
    };
  }

  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) return { ok: false, error: "Organization not found." };

  const sections = await db
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  // Pull the template .docx bytes and render the proposal-as-docx.
  const storage = getStorageProvider();
  const templateObj = await storage.get(template.docxStoragePath);
  if (!templateObj) {
    return {
      ok: false,
      error:
        "Template file bytes are no longer in storage — re-upload the .docx on the template settings page.",
    };
  }

  const docxResult = renderProposalToDocx({
    template,
    templateBytes: templateObj.bytes,
    proposal: propRow.proposal,
    opportunity: propRow.opportunity,
    organization: orgRow,
    sections,
  });
  if (!docxResult.ok) return { ok: false, error: docxResult.error };

  // Hand the rendered .docx to the conversion provider.
  let converted;
  try {
    const provider = getDocxToPdfProvider();
    converted = await provider.convert({
      docxBytes: docxResult.bytes,
      fileName: `${proposalId}.docx`,
    });
  } catch (err) {
    console.error("[renderProposalDocxAsPdfAction] convert failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "DOCX→PDF conversion failed.",
    };
  }

  // Persist whichever bytes we got. Stub mode returns the .docx —
  // we mark contentType accordingly so the download endpoint serves
  // it with the right MIME + extension.
  const isPdf = converted.contentType === "application/pdf";
  const renderId = crypto.randomUUID();
  const ext = isPdf ? "pdf" : "docx";
  const storageKey = `org/${organizationId}/proposal/${proposalId}/render/${renderId}.${ext}`;

  let stored;
  try {
    stored = await storage.put({
      key: storageKey,
      bytes: converted.bytes,
      contentType: converted.contentType,
    });
  } catch (err) {
    console.error("[renderProposalDocxAsPdfAction] storage.put failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Storage write failed.",
    };
  }

  const downloadUrl = `/api/proposals/${proposalId}/pdf/${renderId}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

  try {
    await db.insert(proposalPdfRenders).values({
      id: renderId,
      proposalId,
      organizationId,
      templateId: template.id,
      renderedByUserId: user.id,
      storagePath: stored.storagePath,
      contentType: ext,
      byteSize: stored.byteSize,
      pageCount: converted.pageCount ?? 0,
      provider: converted.provider,
      downloadUrl,
      expiresAt,
    });
  } catch (err) {
    console.error("[renderProposalDocxAsPdfAction] insert failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to record render.",
    };
  }

  revalidatePath(`/proposals/${proposalId}`);
  return {
    ok: true,
    id: renderId,
    contentType: ext,
    byteSize: stored.byteSize,
    downloadUrl,
    renderedAt: new Date().toISOString(),
    provider: converted.provider,
    stubbed: converted.stubbed,
  };
}

/** DOCX→PDF provider status for the export panel banner. */
export async function getDocxToPdfStatusAction() {
  await requireAuth();
  return getDocxToPdfProviderStatus();
}

/**
 * Lightweight check for the export panel — tells the UI whether the
 * proposal's template supports the .docx render path so we can show
 * the right buttons.
 */
export async function getProposalExportCapabilityAction(
  proposalId: string,
): Promise<{
  hasDocxTemplate: boolean;
  hasHtmlTemplate: boolean;
  templateName: string;
}> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [row] = await db
    .select({
      kind: proposalTemplates.kind,
      docxStoragePath: proposalTemplates.docxStoragePath,
      name: proposalTemplates.name,
    })
    .from(proposals)
    .innerJoin(
      proposalTemplates,
      eq(proposalTemplates.id, proposals.templateId),
    )
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return { hasDocxTemplate: false, hasHtmlTemplate: false, templateName: "" };
  }
  return {
    hasDocxTemplate: row.kind === "docx" && row.docxStoragePath !== "",
    hasHtmlTemplate: row.kind === "html",
    templateName: row.name,
  };
}
