import { desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { backgroundJobs, organizations } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { describeJobStatus } from "@/lib/jobs-policy";
import { RunJobsNowButton } from "./RunJobsNowButton";

export const dynamic = "force-dynamic";

/**
 * BL-AIP-4c — superadmin view of the durable background-job table.
 *
 * Every solicitation parse, companion-document parse and proposal
 * harvest is a row here; the jobs cron (every five minutes) recovers
 * rows whose instance died and runs due retries. Cross-tenant by
 * design (platform ops). Filter via `?filter=open | failed | done | all`.
 */

type Filter = "open" | "failed" | "done" | "all";

const KIND_LABEL: Record<string, string> = {
  solicitation_parse: "Solicitation parse",
  solicitation_document_parse: "Companion document parse",
  proposal_harvest: "Proposal harvest",
};

export default async function BackgroundJobsPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  await requireSuperadmin();
  const filter: Filter = (
    ["open", "failed", "done", "all"].includes(searchParams.filter ?? "")
      ? searchParams.filter
      : "open"
  ) as Filter;

  const condition =
    filter === "open"
      ? inArray(backgroundJobs.status, ["queued", "running"])
      : filter === "failed"
        ? eq(backgroundJobs.status, "failed")
        : filter === "done"
          ? eq(backgroundJobs.status, "done")
          : undefined;

  const rows = await db
    .select({
      id: backgroundJobs.id,
      kind: backgroundJobs.kind,
      resourceId: backgroundJobs.resourceId,
      status: backgroundJobs.status,
      attempts: backgroundJobs.attempts,
      maxAttempts: backgroundJobs.maxAttempts,
      nextAttemptAt: backgroundJobs.nextAttemptAt,
      startedAt: backgroundJobs.startedAt,
      finishedAt: backgroundJobs.finishedAt,
      error: backgroundJobs.error,
      createdAt: backgroundJobs.createdAt,
      orgName: organizations.name,
    })
    .from(backgroundJobs)
    .leftJoin(organizations, eq(organizations.id, backgroundJobs.organizationId))
    .where(condition)
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(200);

  const [totals] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${backgroundJobs.status} = 'queued')`,
      running: sql<number>`count(*) filter (where ${backgroundJobs.status} = 'running')`,
      failed: sql<number>`count(*) filter (where ${backgroundJobs.status} = 'failed')`,
      doneDay: sql<number>`count(*) filter (where ${backgroundJobs.status} = 'done' and ${backgroundJobs.finishedAt} > now() - interval '24 hours')`,
    })
    .from(backgroundJobs);

  const now = new Date();
  const n = (v: number | string | null | undefined) => Number(v ?? 0);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Background jobs"
        title="Background jobs"
        subtitle="Durable records of every solicitation parse, companion-document parse and proposal harvest. The jobs cron runs every five minutes: rows still running after fifteen minutes are presumed dead and retried from the stored file bytes, up to three attempts."
        actions={
          <>
            <RunJobsNowButton />
            <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
              ← SuperAdmin portal
            </Link>
          </>
        }
        meta={[
          { label: "Queued", value: String(n(totals?.queued)) },
          {
            label: "Running",
            value: String(n(totals?.running)),
            accent: n(totals?.running) > 0 ? "violet" : undefined,
          },
          {
            label: "Failed",
            value: String(n(totals?.failed)),
            accent: n(totals?.failed) > 0 ? "rose" : "emerald",
          },
          { label: "Done (24 h)", value: String(n(totals?.doneDay)) },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <span className="text-muted">Show:</span>
        {(
          [
            ["open", "Open"],
            ["failed", "Failed"],
            ["done", "Done"],
            ["all", "All"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/admin/jobs?filter=${key}`}
            className={`rounded-md border px-2 py-1 ${
              filter === key
                ? "border-violet/40 bg-violet/10 text-text"
                : "border-layer/10 bg-layer/[0.02] text-muted hover:text-text"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Panel title={`Jobs (${rows.length}${rows.length === 200 ? "+" : ""})`}>
        {rows.length === 0 ? (
          <p className="font-mono text-[11px] text-muted">
            {filter === "open" ? "Nothing queued or running." : "No matching jobs."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-lg border p-3 ${
                  r.status === "failed"
                    ? "border-rose-500/30 bg-rose-500/[0.04]"
                    : r.status === "done"
                      ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                      : "border-amber-500/20 bg-amber-500/[0.03]"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-[13px] font-semibold text-text">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </span>
                    <span className="rounded bg-layer/[0.05] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
                      {describeJobStatus(r, now)}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-muted">{r.orgName ?? "—"}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted md:grid-cols-4">
                  <div>
                    <dt className="text-muted/70">Resource</dt>
                    <dd className="text-text">{r.resourceId.slice(0, 8)}…</dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">Attempts</dt>
                    <dd className="text-text tabular-nums">
                      {r.attempts} / {r.maxAttempts}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">Created</dt>
                    <dd className="text-text tabular-nums">{formatTime(r.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">{r.finishedAt ? "Finished" : "Started"}</dt>
                    <dd className="text-text tabular-nums">
                      {formatTime(r.finishedAt ?? r.startedAt)}
                    </dd>
                  </div>
                </dl>
                {r.error ? (
                  <p className="mt-2 font-mono text-[11px] text-rose-300">{r.error.slice(0, 400)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function formatTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}
