import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  memberships,
  notificationRules,
  opportunities,
  organizations,
  proposals,
  users,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-15 Phase B-1 — tenant data export for offboarding.
 *
 * Superadmin-only endpoint. Streams a single JSON bundle containing
 * the target tenant's metadata + records (no large blobs: no proposal
 * bodies, no knowledge artifact raw_text, no audit log rows — those
 * remain accessible via the existing surfaces). The bundle is enough
 * to hand a departing customer a record of what they had on FORGE.
 *
 * Every export writes a `tenant.data_export` row to the *target*
 * tenant's audit log via `recordRead`, so the tenant's own org-admin
 * can see in `/audit-log` when their data was exported.
 *
 * Synchronous: the response body is the full JSON bundle. Practical
 * for tenant sizes we have today (~MBs). If a tenant grows large
 * enough that this hits Vercel's response size or duration limits,
 * we'd move to an async queue + email pattern (tracked in backlog).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const actor = await requireSuperadmin();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, params.id))
    .limit(1);

  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  // Run record-collection queries in parallel — each is org-scoped.
  const [memberRows, opportunityRows, proposalRows, artifactRows, ruleRows] =
    await Promise.all([
      db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: memberships.role,
          status: memberships.status,
          joinedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, org.id)),

      db
        .select({
          id: opportunities.id,
          title: opportunities.title,
          agency: opportunities.agency,
          stage: opportunities.stage,
          solicitationNumber: opportunities.solicitationNumber,
          naicsCode: opportunities.naicsCode,
          setAside: opportunities.setAside,
          responseDueDate: opportunities.responseDueDate,
          ownerUserId: opportunities.ownerUserId,
          createdAt: opportunities.createdAt,
          updatedAt: opportunities.updatedAt,
        })
        .from(opportunities)
        .where(eq(opportunities.organizationId, org.id)),

      db
        .select({
          id: proposals.id,
          title: proposals.title,
          stage: proposals.stage,
          opportunityId: proposals.opportunityId,
          proposalManagerUserId: proposals.proposalManagerUserId,
          captureManagerUserId: proposals.captureManagerUserId,
          pricingLeadUserId: proposals.pricingLeadUserId,
          createdAt: proposals.createdAt,
          updatedAt: proposals.updatedAt,
        })
        .from(proposals)
        .where(eq(proposals.organizationId, org.id)),

      db
        .select({
          id: knowledgeArtifacts.id,
          title: knowledgeArtifacts.title,
          kind: knowledgeArtifacts.kind,
          source: knowledgeArtifacts.source,
          fileName: knowledgeArtifacts.fileName,
          fileSize: knowledgeArtifacts.fileSize,
          contentType: knowledgeArtifacts.contentType,
          tags: knowledgeArtifacts.tags,
          status: knowledgeArtifacts.status,
          createdAt: knowledgeArtifacts.createdAt,
        })
        .from(knowledgeArtifacts)
        .where(eq(knowledgeArtifacts.organizationId, org.id)),

      db
        .select({
          id: notificationRules.id,
          name: notificationRules.name,
          description: notificationRules.description,
          triggerEventKind: notificationRules.triggerEventKind,
          recipientStrategy: notificationRules.recipientStrategy,
          recipientConfig: notificationRules.recipientConfig,
          channels: notificationRules.channels,
          frequency: notificationRules.frequency,
          slaSeconds: notificationRules.slaSeconds,
          active: notificationRules.active,
          createdAt: notificationRules.createdAt,
        })
        .from(notificationRules)
        .where(eq(notificationRules.organizationId, org.id)),
    ]);

  const exportedAt = new Date().toISOString();

  const bundle = {
    schemaVersion: 1,
    exportedAt,
    exportedBy: { userId: actor.id, email: actor.email },
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      website: org.website,
      contactName: org.contactName,
      contactTitle: org.contactTitle,
      contactEmail: org.email,
      phone: org.phone,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      state: org.state,
      zip: org.zip,
      country: org.country,
      uei: org.uei,
      cageCode: org.cageCode,
      dunsNumber: org.dunsNumber,
      companySecurityLevel: org.companySecurityLevel,
      employeeSecurityLevel: org.employeeSecurityLevel,
      dcaaCompliant: org.dcaaCompliant,
      primaryNaics: org.primaryNaics,
      naicsList: org.naicsList,
      pscCodes: org.pscCodes,
      socioEconomic: org.socioEconomic,
      contractingVehicles: org.contractingVehicles,
      pastPerformance: org.pastPerformance,
      createdAt: org.createdAt,
      disabledAt: org.disabledAt,
    },
    members: memberRows,
    opportunities: opportunityRows,
    proposals: proposalRows,
    knowledgeArtifacts: artifactRows,
    notificationRules: ruleRows,
  };

  // Audit the export. Best-effort — failure to record doesn't block
  // the download.
  await recordRead({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "tenant.data_export",
    resourceType: "organization",
    resourceId: org.id,
    metadata: {
      exportedAt,
      counts: {
        members: memberRows.length,
        opportunities: opportunityRows.length,
        proposals: proposalRows.length,
        knowledgeArtifacts: artifactRows.length,
        notificationRules: ruleRows.length,
      },
    },
  });

  const body = JSON.stringify(bundle, null, 2);
  // Filename: slug-prefixed, ISO date, .json. Quote-safe — slug is
  // url-safe characters only (varchar(64) constrained on the org row).
  const filename = `forge-tenant-${org.slug}-${exportedAt.slice(0, 10)}.json`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
