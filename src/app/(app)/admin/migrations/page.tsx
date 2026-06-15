import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  getMigrationStatus,
  scanPendingForDestructive,
} from "@/lib/migration-runner";
import { MigrationsClient } from "./MigrationsClient";

export const dynamic = "force-dynamic";

export default async function MigrationsPage() {
  await requireSuperadmin();

  const status = await getMigrationStatus();
  const inSync = status.pendingFiles.length === 0;
  const destructiveBlockers = inSync ? [] : await scanPendingForDestructive();
  const autoApplyEnabled = process.env.DISABLE_AUTO_MIGRATE !== "1";
  const neonSnapshotsEnabled = !!(
    process.env.NEON_API_KEY && process.env.NEON_PROJECT_ID
  );

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

      <Panel title="Auto-apply">
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Pending migrations are applied automatically on every server
          cold start (see <code className="font-mono">src/instrumentation.ts</code>).
          Set <code className="font-mono">DISABLE_AUTO_MIGRATE=1</code>{" "}
          in Vercel env to freeze the schema in place. Migrations that
          contain destructive operations (DROP TABLE, DROP COLUMN, etc.)
          are refused by auto-apply and must be run manually here.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] md:grid-cols-3">
          <div>
            <dt className="text-muted/70">Auto-apply</dt>
            <dd
              className={
                autoApplyEnabled ? "text-emerald-300" : "text-amber-300"
              }
            >
              {autoApplyEnabled ? "● Enabled" : "● Disabled (env override)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted/70">Pre-apply snapshot</dt>
            <dd
              className={
                neonSnapshotsEnabled ? "text-emerald-300" : "text-muted"
              }
            >
              {neonSnapshotsEnabled
                ? "● Configured (Neon branch)"
                : "○ Not configured (Neon PITR only)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted/70">Destructive blockers</dt>
            <dd
              className={
                destructiveBlockers.length > 0 ? "text-rose" : "text-emerald-300"
              }
            >
              {destructiveBlockers.length > 0
                ? `● ${destructiveBlockers.length} migration${destructiveBlockers.length === 1 ? "" : "s"}`
                : "● None pending"}
            </dd>
          </div>
        </dl>

        {destructiveBlockers.length > 0 ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/[0.06] p-3">
            <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-rose">
              Auto-apply refused — destructive ops in pending migrations
            </div>
            <ul className="flex flex-col gap-1 font-mono text-[11px] text-muted">
              {destructiveBlockers.map((b) => (
                <li key={b.filename}>
                  <span className="text-text">{b.filename}</span>{" "}
                  <span className="text-rose/80">
                    contains: {b.matches.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-body text-[12px] leading-relaxed text-muted">
              Review each destructive migration carefully (have you taken a
              Neon snapshot? Is the schema change recoverable?). Apply them
              manually via the button below.
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Migration ledger"
        eyebrow={`${status.expectedFiles.length} files in drizzle/`}
      >
        <p className="font-body text-[13px] leading-relaxed text-muted">
          The deployed code expects these migrations to be applied. The
          ledger (<code className="font-mono">_forge_migration</code>)
          records which ones have been applied. Manual <strong>Apply
          pending migrations</strong> below runs the same logic as
          auto-apply but ignores the destructive-op refusal — use only
          after reviewing each pending migration.
        </p>

        <MigrationsClient initialStatus={status} />
      </Panel>
    </>
  );
}
