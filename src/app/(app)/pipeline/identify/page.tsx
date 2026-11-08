import { PipelineStagePage, type StageSearchParams } from "../StagePage";

export const dynamic = "force-dynamic";
// BL-NAV-LIFECYCLE 1b — the SAM.gov search (one request per NAICS code plus
// description reads) and the GSA email's attachment filing run from here now.
export const maxDuration = 300;

/** BL-NAV-LIFECYCLE — Pipeline → Identify. */
export default function Page({ searchParams }: { searchParams: StageSearchParams }) {
  return <PipelineStagePage stageKey="identify" searchParams={searchParams} />;
}
