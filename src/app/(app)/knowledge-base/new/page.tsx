import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { NewEntryForm } from "./NewEntryForm";

export const dynamic = "force-dynamic";

export default async function NewKnowledgeEntryPage() {
  await requireAuth();
  await requireCurrentOrg();
  return (
    <>
      <PageHeader
        eyebrow="Knowledge base"
        title="New entry"
        subtitle="Capture a capability, a past-performance reference, a key person, or a chunk of boilerplate. Tag it so it shows up when you filter."
        actions={
          <Link href="/knowledge-base" className="aur-btn aur-btn-ghost">
            Back
          </Link>
        }
      />
      <Panel title="Entry">
        <NewEntryForm />
      </Panel>
    </>
  );
}
