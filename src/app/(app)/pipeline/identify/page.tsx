import { PipelineStagePage, type StageSearchParams } from "../StagePage";

export const dynamic = "force-dynamic";

/** BL-NAV-LIFECYCLE — Pipeline → Identify. */
export default function Page({ searchParams }: { searchParams: StageSearchParams }) {
  return <PipelineStagePage stageKey="identify" searchParams={searchParams} />;
}
