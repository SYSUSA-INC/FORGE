import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { rowToOrgProfile } from "@/lib/org-types";
import { AuditRetentionPanel } from "./AuditRetentionPanel";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, organizationId } = await requireCurrentOrg();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org) {
    redirect("/");
  }

  const profile = rowToOrgProfile(org);
  const canEdit = user.role === "admin" || user.isSuperadmin;

  return (
    <>
      <SettingsClient initialProfile={profile} canEdit={canEdit} />
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AuditRetentionPanel
          initialDays={org.auditRetentionDays}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
