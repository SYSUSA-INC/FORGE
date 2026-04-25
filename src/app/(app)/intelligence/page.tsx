import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getAIProviderStatus } from "@/lib/ai";
import IntelligenceVisionDemo from "./IntelligenceVisionDemo";
import { PipelineBriefPanel } from "./PipelineBriefPanel";
import { ProviderStatusPanel } from "./ProviderStatusPanel";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  await requireAuth();
  await requireCurrentOrg();
  const providerStatus = getAIProviderStatus();

  return (
    <>
      <section className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <PipelineBriefPanel />
        <ProviderStatusPanel
          active={providerStatus.active}
          all={providerStatus.all}
        />
      </section>

      <IntelligenceVisionDemo />
    </>
  );
}
