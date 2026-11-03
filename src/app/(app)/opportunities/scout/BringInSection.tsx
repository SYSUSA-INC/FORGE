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
 * BL-NAV-LIFECYCLE 1b (FORGE II, footnote 3) — "Bring in an
 * opportunity": every source on the Scout tab. The live importers render
 * inline; a source with no importer yet opens the source-request form,
 * so the demand is recorded and counted.
 */
export async function BringInSection({ organizationId, source }: { organizationId: string; source: IdentifySource | null }) {
  const ownRequests = source && !source.live ? await listOwnSourceRequestsAction() : [];
  const maxBytes = source?.key === "gsa" ? resolvePolicy("document", process.env).maxBytes : 0;

  return (
    <section aria-label="Bring in an opportunity" className="mt-8">
      <Panel title="Bring in an opportunity" eyebrow="Every source, one place">
        <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
          Pick where the opportunity comes from. Whatever you add lands in the pipeline and shows under Evaluate.
        </p>
        <nav aria-label="Sources" className="flex flex-wrap gap-2">
          {IDENTIFY_SOURCES.map((s) => {
            const on = source?.key === s.key;
            return (
              <Link
                key={s.key}
                href={identifySourceHref(s.key)}
                aria-current={on ? "page" : undefined}
                title={s.hint}
                className={`aur-btn text-[12px] ${on ? "aur-btn-primary" : "aur-btn-ghost"}`}
              >
                {s.label}
                {!s.live ? <span className="ml-1.5 font-mono text-[10px] uppercase tracking-widest opacity-70">request</span> : null}
              </Link>
            );
          })}
        </nav>
        {source ? <p className="mt-3 font-body text-[12px] leading-[1.5] text-muted">{source.hint}</p> : null}
      </Panel>

      {source?.key === "sam" ? (
        <div className="mt-4">
          <SamImportSection organizationId={organizationId} />
        </div>
      ) : null}
      {source?.key === "ebuy" ? (
        <div className="mt-4">
          <EbuyPasteClient />
        </div>
      ) : null}
      {source?.key === "gsa" ? (
        <div className="mt-4">
          <GsaPasteClient maxBytes={maxBytes} />
        </div>
      ) : null}
      {source && !source.live ? (
        <div className="mt-4">
          <Panel title={`${source.label}: not connected yet`} eyebrow="Request this source">
            <p className="font-body text-[13px] leading-[1.5] text-muted">
              FORGE does not read {source.key === "gwacs" ? "contract-vehicle portals" : "enterprise portals"} yet. Tell us which one and how notices reach you today; each request is counted and shapes which integration comes first. Until then, paste a notice under GSA email or add it by hand under Create.
            </p>
          </Panel>
          <div className="mt-4">
            <SourceRequestPanel initialOwnRequests={ownRequests} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
