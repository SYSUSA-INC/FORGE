import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import {
  getParticipantStats,
  listRecentImportRuns,
  type ImportRunSummary,
} from "./actions";
import { Sba8aAdminClient } from "./Sba8aAdminClient";

export const dynamic = "force-dynamic";

export default async function Sba8aAdminPage() {
  await requireSuperadmin();

  const apiKeyPresent = !!(process.env.SAM_GOV_API_KEY || "").trim();
  const [stats, runs] = await Promise.all([
    safeStats(),
    safeRuns(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="SBA 8(a) participant registry"
        subtitle="Pull the active and graduated 8(a) firm list from SAM.gov, or paste a CSV. Used by /intelligence/firms and to chip awards on /intelligence/awards."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost">
            ← Platform admin
          </Link>
        }
        meta={[
          { label: "Participants", value: stats.total.toString() },
          { label: "Active", value: stats.active.toString() },
          {
            label: "Graduated",
            value: stats.graduated.toString(),
            accent: stats.graduated > 0 ? "emerald" : undefined,
          },
        ]}
      />
      {!apiKeyPresent ? (
        <Panel
          className="mb-4"
          title="SAM.gov API key missing"
          eyebrow="Required for live pull"
          accent="hazard"
        >
          <p className="font-mono text-[12px] text-muted">
            Set the <code className="rounded bg-white/5 px-1.5 py-0.5">SAM_GOV_API_KEY</code>{" "}
            environment variable to enable the "Pull from SAM.gov" path. Free
            keys: <a
              href="https://open.gsa.gov/api/entity-api/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              open.gsa.gov/api/entity-api
            </a>
            . The CSV-paste path below works without a key.
          </p>
        </Panel>
      ) : null}
      <Sba8aAdminClient
        apiKeyPresent={apiKeyPresent}
        initialRuns={runs}
        initialStats={stats}
      />
    </>
  );
}

async function safeStats() {
  try {
    return await getParticipantStats();
  } catch {
    return { total: 0, active: 0, graduated: 0, terminated: 0 };
  }
}

async function safeRuns(): Promise<ImportRunSummary[]> {
  try {
    return await listRecentImportRuns();
  } catch {
    return [];
  }
}
