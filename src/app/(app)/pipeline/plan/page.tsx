import { PipelineStagePage, type StageSearchParams } from "../StagePage";

export const dynamic = "force-dynamic";

/** BL-NAV-LIFECYCLE — Pipeline → Plan. */
export default function Page({ searchParams }: { searchParams: StageSearchParams }) {
  return <PipelineStagePage stageKey="plan" searchParams={searchParams} />;
}
