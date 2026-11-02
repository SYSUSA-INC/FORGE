import { PipelineStagePage, type StageSearchParams } from "../StagePage";

export const dynamic = "force-dynamic";

/** BL-NAV-LIFECYCLE — Pipeline → Evaluate. */
export default function Page({ searchParams }: { searchParams: StageSearchParams }) {
  return <PipelineStagePage stageKey="evaluate" searchParams={searchParams} />;
}
