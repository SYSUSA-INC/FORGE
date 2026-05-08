import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getMigrationStatus } from "@/lib/migration-runner";
import { MigrationsClient } from "./MigrationsClient";

export const dynamic = "force-dynamic";

export default async function MigrationsPage() {
  await requireSuperadmin();

  const status = await getMigrationStatus();
  const inSync = status.pendingFiles.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Database migrations"
        subtitle="Apply pending schema migrations against this tenant's database. Idempotent — re-runs are a no-op."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost">
            ← Platform admin
          </Link>
        }
        meta={[
          {
            label: "Status",
            value: inSync ? "In sync" : "Behind",
            accent: inSync ? "emerald" : "rose",
          },
          {
            label: "Applied",
            value: String(status.appliedFiles.length).padStart(2, "0"),
          },
          {
            label: "Pending",
            value: String(status.pendingFiles.length).padStart(2, "0"),
            accent: status.pendingFiles.length > 0 ? "rose" : undefined,
          },
        ]}
      />

      <Panel
        title="Migration ledger"
        eyebrow={`${status.expectedFiles.length} files in drizzle/`}
      >
        <p className="font-body text-[13px] leading-relaxed text-muted">
          The deployed code expects these migrations to be applied. The
          ledger (<code className="font-mono">_forge_migration</code>)
          records which ones have been applied. Click <strong>Apply
          pending migrations</strong> to bring the database up to date.
        </p>

        <MigrationsClient initialStatus={status} />
      </Panel>
    </>
  );
}
