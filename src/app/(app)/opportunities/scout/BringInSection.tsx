import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { IDENTIFY_SOURCES, identifySourceHref, type IdentifySource } from "@/lib/identify-sources";
import { resolvePolicy } from "@/lib/upload-policy";
import { EbuyPasteClient } from "../import/ebuy/EbuyPasteClient";
import { GsaPasteClient } from "../import/gsa/GsaPasteClient";
import { SamImportSection } from "../import/SamImportSection";
import { listOwnSourceRequestsAction } from "../import/source-requests/actions";
import { SourceRequestPanel } from "../import/source-requests/SourceRequestPanel";

/**
 * BL-SCOUT-ONEPAGE (FORGE II, footnote 3) — the Scout's source bar: All
 * (the nightly scout) and every source, as tabs on top of one page, each
 * opening in the same place with the same rows and Add to pipeline.
 */
export function SourceBar({ source }: { source: IdentifySource | null }) {
  const tabs = [{ key: null, label: "All", live: true }, ...IDENTIFY_SOURCES];
  return (
    <nav aria-label="Sources" className="mb-4 flex flex-wrap items-center gap-1 border-b border-layer/10">
      {tabs.map((t) => {
        const on = (source?.key ?? null) === t.key;
        return (
          <Link
            key={t.key ?? "all"}
            href={identifySourceHref(t.key)}
            aria-current={on ? "page" : undefined}
            className={`relative inline-flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-label transition-colors ${on ? "text-text" : "text-muted hover:text-text"}`}
          >
            {t.label}
            {!t.live ? <span className="font-mono text-[10px] normal-case tracking-normal text-subtle">soon</span> : null}
            {on ? <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-accent" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** One source's tab: its importer inline, or what it needs before FORGE can read it. */
export async function SourcePanel({ organizationId, source }: { organizationId: string; source: IdentifySource }) {
  const ownRequests = !source.live ? await listOwnSourceRequestsAction() : [];
  const maxBytes = source.key === "gsa" ? resolvePolicy("document", process.env).maxBytes : 0;
  return (
    <section aria-label={source.label}>
      <p className="mb-3 font-body text-[12px] leading-[1.5] text-muted">{source.hint}</p>
      {source.key === "sam" ? <SamImportSection organizationId={organizationId} /> : null}
      {source.key === "ebuy" ? <EbuyPasteClient /> : null}
      {source.key === "gsa" ? <GsaPasteClient maxBytes={maxBytes} /> : null}
      {!source.live ? (
        <>
          <Panel title={`${source.label}: coming`} eyebrow="Not connected yet">
            <p className="font-body text-[13px] leading-[1.5] text-muted">
              {source.key === "portals"
                ? "FORGE will read state procurement portals, primes' supplier portals and commercial aggregators (such as HigherGov, GovWin IQ, GovTribe or GovSpend) here. Most state and prime portals publish no feed, so the first connectors are an aggregator account you already have and a FORGE address you forward portal alert emails to."
                : "FORGE will bring in task orders from the contract vehicles you hold (OASIS+, Alliant, SEWP, Polaris and others) here."}{" "}
              Tell us which ones you use and how their notices reach you today: each request is counted and decides what comes first. Until then, paste a notice under GSA email or add it by hand under Create.
            </p>
          </Panel>
          <div className="mt-4">
            <SourceRequestPanel initialOwnRequests={ownRequests} />
          </div>
        </>
      ) : null}
    </section>
  );
}
