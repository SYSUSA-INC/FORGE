import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { rowToOrgProfile } from "@/lib/org-types";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireAuth();

  if (!user.organizationId) {
    redirect("/");
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, user.organizationId))
    .limit(1);

  if (!org) {
    redirect("/");
  }

  const profile = rowToOrgProfile(org);
  const canEdit = user.role === "admin" || user.isSuperadmin;

  return <SettingsClient initialProfile={profile} canEdit={canEdit} />;
}
