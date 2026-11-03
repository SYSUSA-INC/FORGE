import { PipelineStagePage, type StageSearchParams } from "../StagePage";

export const dynamic = "force-dynamic";

/** BL-NAV-LIFECYCLE — Pipeline → Measure. */
export default function Page({ searchParams }: { searchParams: StageSearchParams }) {
  return <PipelineStagePage stageKey="measure" searchParams={searchParams} />;
}
