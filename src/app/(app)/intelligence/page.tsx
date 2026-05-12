import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getAIProviderStatus } from "@/lib/ai";
import { PipelineBriefPanel } from "./PipelineBriefPanel";
import { ProviderStatusPanel } from "./ProviderStatusPanel";
import { OutcomeInsightsPanel } from "./OutcomeInsightsPanel";
import { SectionSignalsPanel } from "./SectionSignalsPanel";

export const dynamic = "force-dynamic";

const BD_LINKS = [
  {
    href: "/intelligence/awards",
    title: "Awards & recompetes",
    blurb: "Search federal awards by NAICS, agency, keyword. Surface recompetes.",
  },
  {
    href: "/intelligence/firms",
    title: "8(a) firms",
    blurb: "Active and recently graduated 8(a) participants — capture targets.",
  },
  {
    href: "/intelligence/watchlist",
    title: "Watchlist",
    blurb: "Pinned awards and firms your team is tracking.",
  },
  {
    href: "/intelligence/saved-searches",
    title: "Saved searches",
    blurb: "One-click re-run of past searches; share with the team.",
  },
];

export default async function IntelligencePage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const providerStatus = getAIProviderStatus();
  const bdEnabled = process.env.AWARDS_INTEL_ENABLED === "1";

  return (
    <>
      {bdEnabled ? (
        <section className="mb-8">
          <Panel title="BD intelligence" eyebrow="Capture intel — external data" dense>
            <ul className="grid grid-cols-1 gap-px bg-white/5 md:grid-cols-2">
              {BD_LINKS.map((l) => (
                <li key={l.href} className="bg-bg/95">
                  <Link
                    href={l.href}
                    className="flex flex-col gap-1 px-5 py-3 transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="font-display text-[13px] text-text">
                      {l.title}
                    </span>
                    <span className="font-mono text-[11px] text-muted">
                      {l.blurb}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}

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
