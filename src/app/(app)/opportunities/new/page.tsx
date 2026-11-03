import { redirect } from "next/navigation";

/** BL-NAV-LIFECYCLE — Create lives under Pipeline → Identify now; the proposal launcher's hand-off survives. */
export default function NewOpportunityPage({ searchParams }: { searchParams: { afterCreate?: string } }) {
  redirect(searchParams.afterCreate === "proposal" ? "/pipeline/identify?tab=create&afterCreate=proposal" : "/pipeline/identify?tab=create");
}
