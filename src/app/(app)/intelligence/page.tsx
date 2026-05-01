import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getAIProviderStatus } from "@/lib/ai";
import { PipelineBriefPanel } from "./PipelineBriefPanel";
import { ProviderStatusPanel } from "./ProviderStatusPanel";
import { OutcomeInsightsPanel } from "./OutcomeInsightsPanel";
import { SectionSignalsPanel } from "./SectionSignalsPanel";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
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

      <section className="mb-8">
        <OutcomeInsightsPanel organizationId={organizationId} />
      </section>

      <section className="mb-8">
        <SectionSignalsPanel organizationId={organizationId} />
      </section>
    </>
  );
}
