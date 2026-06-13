import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import {
  auditLogs,
  knowledgeArtifacts,
  memberships,
  notificationRules,
  opportunities,
  organizations,
  proposals,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { recordRead } from "@/lib/audit-log";
import { getCurrentTier } from "@/lib/subscription-gates";
import { listActiveTiersAction, listOrgAdminsAction } from "./actions";
import { TierAssignmentForm } from "./TierAssignmentForm";
import { TransferOwnershipForm } from "./TransferOwnershipForm";

export const dynamic = "force-dynamic";

/**
 * BL-15 Phase A — per-tenant detail page.
 *
 * Superadmin-only drill-down with metrics for one organization:
 * member count, opportunities, proposals, knowledge artifacts +
 * storage usage, notification rules, audit-log activity over the last
 * 30 days. Reading this page is a sensitive cross-tenant operation,
 * so we `recordRead` an audit row into the target tenant's log every
 * time it loads.
 *
 * Lifecycle controls (provision / suspend / restore / delete) already
 * live on the `/admin` list. Phase B will add transfer-ownership,
 * assume-identity, and data export here.
 */
export default async function TenantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const actor = await requireSuperadmin();

  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      website: organizations.website,
      contactName: organizations.contactName,
      contactEmail: organizations.email,
      phone: organizations.phone,
      createdAt: organizations.createdAt,
      disabledAt: organizations.disabledAt,
      primaryAdminUserId: organizations.primaryAdminUserId,
    })
    .from(organizations)
    .where(eq(organizations.id, params.id))
    .limit(1);

  if (!org) notFound();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Run the metric queries in parallel — every one is scoped by
  // organization_id, so they're independent of each other.
  const [
    memberCountRow,
    opportunityCountRow,
    proposalCountRow,
    artifactRow,
    notificationRuleCountRow,
    auditLogCountRow,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, org.id),
          eq(memberships.status, "active"),
        ),
      ),
    db
      .select({ n: count() })
      .from(opportunities)
      .where(eq(opportunities.organizationId, org.id)),
    db
      .select({ n: count() })
      .from(proposals)
      .where(eq(proposals.organizationId, org.id)),
    db
      .select({
        n: count(),
        bytes: sum(knowledgeArtifacts.fileSize),
      })
      .from(knowledgeArtifacts)
      .where(eq(knowledgeArtifacts.organizationId, org.id)),
    db
      .select({ n: count() })
      .from(notificationRules)
      .where(eq(notificationRules.organizationId, org.id)),
    db
      .select({ n: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.id),
          gte(auditLogs.createdAt, thirtyDaysAgo),
        ),
      ),
  ]);

  const memberCount = Number(memberCountRow[0]?.n ?? 0);
  const opportunityCount = Number(opportunityCountRow[0]?.n ?? 0);
  const proposalCount = Number(proposalCountRow[0]?.n ?? 0);
  const artifactCount = Number(artifactRow[0]?.n ?? 0);
  const artifactBytes = Number(artifactRow[0]?.bytes ?? 0);
  const notificationRuleCount = Number(notificationRuleCountRow[0]?.n ?? 0);
  const auditLogLast30d = Number(auditLogCountRow[0]?.n ?? 0);

  // BL-16 Phase B-1 — resolve current tier (joins
  // tenant_subscription × subscription_tier and applies any
  // custom_overrides). Returns null if the org has no subscription
  // row, which shouldn't happen post-backfill but we surface as
  // "No tier" to make the gap visible.
  //
  // BL-16 Phase C-2 — also load the list of active tiers for the
  // assignment dropdown. Both queries run in series since
  // currentTier informs whether the dropdown should render at all.
  const currentTier = await getCurrentTier(org.id);
  const activeTiers = currentTier ? await listActiveTiersAction() : [];

  // BL-15 Phase B-2 — load active admins for the transfer-ownership
  // dropdown + the primary admin's identity for the Identity panel.
  const orgAdmins = await listOrgAdminsAction(org.id);
  const primaryAdmin = org.primaryAdminUserId
    ? orgAdmins.find((a) => a.userId === org.primaryAdminUserId) ?? null
    : null;

  // Top recent admins by activity — gives a quick sense of who's
  // actually operating the tenant. Limited to 5 to keep the page small.
  const topActors = await db
    .select({
      actorEmail: auditLogs.actorEmailSnapshot,
      n: count(),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, org.id),
        gte(auditLogs.createdAt, thirtyDaysAgo),
        sql`${auditLogs.actorEmailSnapshot} <> ''`,
      ),
    )
    .groupBy(auditLogs.actorEmailSnapshot)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  await recordRead({
    organizationId: org.id,
    actor: { userId: actor.id, email: actor.email },
    action: "tenant.view_summary",
    resourceType: "organization",
    resourceId: org.id,
    metadata: {
      memberCount,
      opportunityCount,
      proposalCount,
      artifactCount,
      auditLogLast30d,
    },
  });

  return (
    <>
      <PageHeader
        eyebrow={`Tenant detail · ${org.slug}`}
        title={org.name}
        subtitle={
          org.disabledAt
            ? "This tenant is currently disabled. Existing sessions still resolve, but new sign-ins are blocked."
            : "Read-only operational summary. Lifecycle controls (suspend / restore / delete) remain on the SuperAdmin portal."
        }
        actions={
          <>
            <a
              href={`/api/admin/orgs/${org.id}/export`}
              className="aur-btn aur-btn-ghost text-[11px]"
              title="Download a JSON bundle of this tenant's metadata + records (no large blobs). Audited."
            >
              Export data ↓
            </a>
            <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
              ← All organizations
            </Link>
          </>
        }
        meta={[
          {
            label: "Members",
            value: String(memberCount),
            accent: "emerald",
          },
          {
            label: "Opportunities",
            value: String(opportunityCount),
          },
          {
            label: "Proposals",
            value: String(proposalCount),
          },
          {
            label: "Audit rows (30d)",
            value: String(auditLogLast30d),
            accent: auditLogLast30d > 0 ? "violet" : undefined,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Identity">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 font-mono text-[12px]">
            <Field label="Org ID" value={org.id} />
            <Field label="Slug" value={org.slug} />
            <Field
              label="Status"
              value={org.disabledAt ? "Disabled" : "Active"}
              accent={org.disabledAt ? "rose" : "emerald"}
            />
            <Field
              label="Created"
              value={new Date(org.createdAt).toLocaleString()}
            />
            {org.disabledAt ? (
              <Field
                label="Disabled at"
                value={new Date(org.disabledAt).toLocaleString()}
                accent="rose"
              />
            ) : null}
            <Field label="Website" value={org.website || "—"} />
            <Field label="Contact" value={org.contactName || "—"} />
            <Field label="Email" value={org.contactEmail || "—"} />
            <Field label="Phone" value={org.phone || "—"} />
            <Field
              label="Primary admin"
              value={
                primaryAdmin
                  ? `${primaryAdmin.name ?? primaryAdmin.email}`
                  : org.primaryAdminUserId
                    ? "Set but not in active admins"
                    : "Unset"
              }
              accent={primaryAdmin ? "emerald" : "rose"}
            />
          </dl>
          <TransferOwnershipForm
            organizationId={org.id}
            currentPrimaryUserId={org.primaryAdminUserId}
            admins={orgAdmins}
          />
        </Panel>

        <Panel title="Subscription tier">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 font-mono text-[12px]">
            <Field
              label="Current tier"
              value={currentTier ? currentTier.tierName : "No tier"}
              accent={currentTier ? "emerald" : "rose"}
            />
            <Field
              label="Status"
              value={currentTier?.status ?? "—"}
              accent={
                currentTier?.status === "active"
                  ? "emerald"
                  : currentTier?.status === "past_due"
                    ? "rose"
                    : undefined
              }
            />
            <Field
              label="Slug"
              value={currentTier?.tierSlug ?? "—"}
            />
            {currentTier ? (
              <>
                <Field
                  label="AI requests/mo"
                  value={
                    currentTier.effectiveQuotas.aiRequestsPerMonth === 0
                      ? "Unlimited"
                      : String(currentTier.effectiveQuotas.aiRequestsPerMonth)
                  }
                />
                <Field
                  label="Seats"
                  value={
                    currentTier.effectiveQuotas.seatsIncluded === 0
                      ? "Unlimited"
                      : String(currentTier.effectiveQuotas.seatsIncluded)
                  }
                />
                <Field
                  label="Has overrides"
                  value={
                    Object.keys(currentTier.overrides.featureFlags ?? {})
                      .length > 0 ||
                    Object.keys(currentTier.overrides.quotas ?? {}).length > 0
                      ? "Yes (per-tenant)"
                      : "No"
                  }
                />
              </>
            ) : null}
          </dl>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted/80">
            Tier defaults set in <code>subscription_tier</code>; any
            per-tenant changes live in <code>tenant_subscription.custom_overrides</code>.
            Effective values shown above apply both layers.
          </p>
          {currentTier && activeTiers.length > 1 ? (
            <TierAssignmentForm
              organizationId={org.id}
              currentTierId={currentTier.tierId}
              currentTierName={currentTier.tierName}
              tiers={activeTiers}
            />
          ) : null}
        </Panel>

        <Panel title="Storage & config">
          <dl className="grid grid-cols-[180px_1fr] gap-y-2 font-mono text-[12px]">
            <Field
              label="Knowledge artifacts"
              value={`${artifactCount} files`}
            />
            <Field
              label="Storage used"
              value={formatBytes(artifactBytes)}
              accent={artifactBytes > 0 ? "violet" : undefined}
            />
            <Field
              label="Notification rules"
              value={String(notificationRuleCount)}
            />
          </dl>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted/80">
            Storage measured from <code>knowledge_artifact.file_size</code>{" "}
            sums. Other AI-call costs surface in the platform audit log
            (BL-18) and aren&apos;t aggregated here yet.
          </p>
        </Panel>

        <Panel title="Most active operators (last 30d)" className="lg:col-span-2">
          {topActors.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No audit activity in the last 30 days.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {topActors.map((a) => (
                <li
                  key={a.actorEmail}
                  className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-[12px]"
                >
                  <span className="truncate text-text">{a.actorEmail}</span>
                  <span className="tabular-nums text-muted">
                    {Number(a.n)} actions
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 font-mono text-[10px] text-muted/80">
            <Link
              href={`/platform/audit-log?orgId=${org.id}`}
              className="underline-offset-2 hover:underline"
            >
              View full audit log for this tenant →
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "rose" | "emerald" | "violet";
}) {
  const tone =
    accent === "rose"
      ? "text-rose"
      : accent === "emerald"
        ? "text-emerald"
        : accent === "violet"
          ? "text-violet"
          : "text-text";
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={`truncate ${tone}`}>{value}</dd>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

