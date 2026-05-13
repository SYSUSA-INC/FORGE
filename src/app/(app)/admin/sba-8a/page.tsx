import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { CERT_SPECS } from "@/lib/sba-8a";
import {
  getParticipantStats,
  listRecentImportRuns,
  type ImportRunSummary,
  type ParticipantStats,
} from "./actions";
import { Sba8aAdminClient } from "./Sba8aAdminClient";

export const dynamic = "force-dynamic";

export default async function Sba8aAdminPage() {
  await requireSuperadmin();

  const apiKeyPresent = !!(process.env.SAMGOV_API_KEY || "").trim();
  const cronSecretPresent = !!(process.env.CRON_SECRET || "").trim();
  const [stats, runs, retentionMonths] = await Promise.all([
    safeStats(),
    safeRuns(),
    safeRetention(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Socioeconomic cert registry"
        subtitle="Pull active and graduated firms holding SBA socioeconomic certifications (8(a), HUBZone, WOSB, EDWOSB, SDVOSB, VOB, Native American). Used by /intelligence/firms and to chip awards on /intelligence/awards."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost">
            ← Platform admin
          </Link>
        }
        meta={[
          {
            label: "Total firms",
            value: stats.total.toString(),
            href: "/intelligence/firms?status=all",
          },
          {
            label: "Active",
            value: stats.active.toString(),
            href: "/intelligence/firms?status=active",
          },
          {
            label: "Graduated",
            value: stats.graduated.toString(),
            accent: stats.graduated > 0 ? "emerald" : undefined,
            href: "/intelligence/firms?status=graduated",
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
            Set the <code className="rounded bg-white/5 px-1.5 py-0.5">SAMGOV_API_KEY</code>{" "}
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
        cronSecretPresent={cronSecretPresent}
        initialRuns={runs}
        initialStats={stats}
        initialRetentionMonths={retentionMonths}
      />
    </>
  );
}

async function safeRetention(): Promise<number> {
  try {
    const { getCertRetentionMonths } = await import("@/lib/platform-settings");
    return await getCertRetentionMonths();
  } catch {
    return 36;
  }
}

async function safeStats(): Promise<ParticipantStats> {
  try {
    return await getParticipantStats();
  } catch {
    return {
      total: 0,
      active: 0,
      graduated: 0,
      terminated: 0,
      byCertType: CERT_SPECS.map((c) => ({
        certType: c.certType,
        label: c.label,
        total: 0,
        active: 0,
        graduated: 0,
        terminated: 0,
      })),
    };
  }
}

async function safeRuns(): Promise<ImportRunSummary[]> {
  try {
    return await listRecentImportRuns();
  } catch {
    return [];
  }
}
