import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAIEngineStatus } from "@/lib/settings-status";
import { AIEngineTab } from "../AIEngineTab";

export const dynamic = "force-dynamic";

export default async function AiEnginePage() {
  const user = await requireAuth();
  if (!user.organizationId) {
    redirect("/");
  }

  const aiStatus = getAIEngineStatus();

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="AI Engine"
        subtitle="Status of configured AI providers and how the platform routes drafts, evaluations, and reviews across them."
        actions={
          <Link href="/settings" className="aur-btn aur-btn-ghost">
            ← Settings
          </Link>
        }
      />
      <AIEngineTab status={aiStatus} />
    </>
  );
}
