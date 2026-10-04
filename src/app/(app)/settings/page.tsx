import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { rowToOrgProfile } from "@/lib/org-types";
import { getVoiceProfile } from "@/lib/voice";
import { AuditRetentionPanel } from "./AuditRetentionPanel";
import { HouseStylePanel } from "./HouseStylePanel";
import { SettingsClient } from "./SettingsClient";
import { VoicePanel } from "./VoicePanel";

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

  // BL-FB-GEN-VOICE — the signed-in author's own voice profile.
  const voice = await getVoiceProfile({ organizationId, userId: user.id });

  return (
    <>
      <SettingsClient initialProfile={profile} canEdit={canEdit} />
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AuditRetentionPanel
          initialDays={org.auditRetentionDays}
          canEdit={canEdit}
        />
        <VoicePanel
          authorName={user.name?.trim() || user.email?.split("@")[0] || "you"}
          profile={
            voice.profile
              ? {
                  enabled: voice.profile.enabled,
                  traits: voice.profile.traits,
                  guidance: voice.profile.guidance,
                  customGuidance: voice.profile.customGuidance,
                  sampleCount: voice.profile.sampleCount,
                  sampleWords: voice.profile.sampleWords,
                  builtAt: voice.profile.builtAt ? voice.profile.builtAt.toISOString() : null,
                }
              : null
          }
          samples={voice.samples.map((s) => ({ id: s.id, title: s.title, words: s.words, createdAt: s.createdAt.toISOString() }))}
        />
        {/* BL-FB-GEN-VOICE Slice 2 — the team's rules under every author's voice */}
        <HouseStylePanel initialText={org.houseStyle} orgName={org.name ?? ""} canEdit={canEdit} />
      </div>
    </>
  );
}
