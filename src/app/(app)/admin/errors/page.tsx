import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { organizations, productionErrors, users } from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { ErrorRowActions } from "./ErrorRowActions";

export const dynamic = "force-dynamic";

/**
 * BL-QC-errors — superadmin viewer for the in-app error log.
 *
 * Replaces what Sentry's "Issues" view would have given us. Same
 * mental model — errors are grouped by fingerprint, and each row is
 * a unique stack-trace pattern with a count of how often it has
 * fired.
 *
 * Filter via `?filter=unresolved | acknowledged | resolved | all`
 * (default: unresolved).
 *
 * Filter by environment via `?env=production | preview | development`.
 */

type Filter = "unresolved" | "acknowledged" | "resolved" | "all";

export default async function ProductionErrorsPage({
  searchParams,
}: {
  searchParams: { filter?: string; env?: string };
}) {
  await requireSuperadmin();

  const filter: Filter = (
    ["unresolved", "acknowledged", "resolved", "all"].includes(
      searchParams.filter ?? "",
    )
      ? searchParams.filter
      : "unresolved"
  ) as Filter;

  const env = (searchParams.env ?? "").trim();

  const conditions = [];
  if (filter === "unresolved") {
    conditions.push(isNull(productionErrors.resolvedAt));
  } else if (filter === "acknowledged") {
    conditions.push(isNotNull(productionErrors.acknowledgedAt));
    conditions.push(isNull(productionErrors.resolvedAt));
  } else if (filter === "resolved") {
    conditions.push(isNotNull(productionErrors.resolvedAt));
  }
  if (env) {
    conditions.push(eq(productionErrors.environment, env));
  }

  const rows = await db
    .select({
      id: productionErrors.id,
      fingerprint: productionErrors.fingerprint,
      message: productionErrors.message,
      stack: productionErrors.stack,
      runtime: productionErrors.runtime,
      environment: productionErrors.environment,
      requestPath: productionErrors.requestPath,
      requestMethod: productionErrors.requestMethod,
      httpStatus: productionErrors.httpStatus,
      releaseSha: productionErrors.releaseSha,
      firstSeenAt: productionErrors.firstSeenAt,
      lastSeenAt: productionErrors.lastSeenAt,
      occurrenceCount: productionErrors.occurrenceCount,
      acknowledgedAt: productionErrors.acknowledgedAt,
      resolvedAt: productionErrors.resolvedAt,
      notes: productionErrors.notes,
      organizationId: productionErrors.organizationId,
      orgName: organizations.name,
      ackByName: users.name,
      ackByEmail: users.email,
    })
    .from(productionErrors)
    .leftJoin(
      organizations,
      eq(organizations.id, productionErrors.organizationId),
    )
    .leftJoin(users, eq(users.id, productionErrors.acknowledgedByUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(productionErrors.lastSeenAt))
    .limit(200);

  // Top-line counts independent of the current filter so the meta row
  // is informative.
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      unresolved: sql<number>`count(*) filter (where ${productionErrors.resolvedAt} is null)`,
      unack: sql<number>`count(*) filter (where ${productionErrors.acknowledgedAt} is null)`,
      occurrences: sql<number>`coalesce(sum(${productionErrors.occurrenceCount}), 0)`,
    })
    .from(productionErrors);

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · Production errors"
        title="Production errors"
        subtitle="In-app error log — uncaught exceptions deduped by fingerprint. Acknowledge to silence; resolve when the underlying bug is fixed. Same mental model as an audit log of errors."
        actions={
          <Link href="/admin" className="aur-btn aur-btn-ghost text-[11px]">
            ← SuperAdmin portal
          </Link>
        }
        meta={[
          { label: "Total issues", value: String(totals?.total ?? 0) },
          {
            label: "Unresolved",
            value: String(totals?.unresolved ?? 0),
            accent: (totals?.unresolved ?? 0) > 0 ? "rose" : "emerald",
          },
          {
            label: "Unacknowledged",
            value: String(totals?.unack ?? 0),
            accent: (totals?.unack ?? 0) > 0 ? "gold" : undefined,
          },
          {
            label: "Total occurrences",
            value: String(totals?.occurrences ?? 0),
          },
        ]}
      />

      <FilterRow active={filter} env={env} />

      <Panel title={`Issues (${rows.length}${rows.length === 200 ? "+" : ""})`}>
        {rows.length === 0 ? (
          <p className="font-mono text-[11px] text-muted">
            {filter === "unresolved"
              ? "No unresolved errors. 🎉"
              : "No matching errors."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`rounded-lg border p-4 ${
                  r.resolvedAt
                    ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                    : r.acknowledgedAt
                      ? "border-amber-500/20 bg-amber-500/[0.03]"
                      : "border-rose-500/30 bg-rose-500/[0.04]"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-[14px] font-semibold text-text">
                      {r.message.slice(0, 200)}
                    </span>
                    <Tag>{r.runtime}</Tag>
                    {r.environment ? <Tag>{r.environment}</Tag> : null}
                    {r.httpStatus ? <Tag>HTTP {r.httpStatus}</Tag> : null}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-muted">
                    {r.occurrenceCount}× occurrences
                  </div>
                </div>

                {r.requestPath ? (
                  <div className="mt-1 font-mono text-[11px] text-muted">
                    {r.requestMethod || "GET"} {r.requestPath}
                  </div>
                ) : null}

                <details className="mt-2">
                  <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.2em] text-muted hover:text-text">
                    Stack ({r.fingerprint.slice(0, 12)})
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-text">
                    {r.stack || "(no stack captured)"}
                  </pre>
                </details>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted md:grid-cols-4">
                  <div>
                    <dt className="text-muted/70">First seen</dt>
                    <dd className="text-text tabular-nums">
                      {formatTime(r.firstSeenAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">Last seen</dt>
                    <dd className="text-text tabular-nums">
                      {formatTime(r.lastSeenAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">Tenant</dt>
                    <dd className="text-text">{r.orgName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted/70">Release</dt>
                    <dd className="text-text tabular-nums">
                      {r.releaseSha ? r.releaseSha.slice(0, 7) : "—"}
                    </dd>
                  </div>
                </dl>

                <ErrorRowActions
                  id={r.id}
                  acknowledged={!!r.acknowledgedAt}
                  resolved={!!r.resolvedAt}
                  acknowledgedBy={r.ackByName || r.ackByEmail || ""}
                  notes={r.notes}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function FilterRow({ active, env }: { active: Filter; env: string }) {
  const FILTERS: { key: Filter; label: string }[] = [
    { key: "unresolved", label: "Unresolved" },
    { key: "acknowledged", label: "Acknowledged" },
    { key: "resolved", label: "Resolved" },
    { key: "all", label: "All" },
  ];
  const ENVS = ["", "production", "preview", "development"];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
      <span className="text-muted">Status:</span>
      {FILTERS.map((f) => {
        const params = new URLSearchParams();
        params.set("filter", f.key);
        if (env) params.set("env", env);
        return (
          <Link
            key={f.key}
            href={`/admin/errors?${params}`}
            className={`rounded-md border px-2 py-1 ${
              active === f.key
                ? "border-violet/40 bg-violet/10 text-text"
                : "border-white/10 bg-white/[0.02] text-muted hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        );
      })}
      <span className="ml-3 text-muted">Env:</span>
      {ENVS.map((e) => {
        const params = new URLSearchParams();
        params.set("filter", active);
        if (e) params.set("env", e);
        return (
          <Link
            key={e}
            href={`/admin/errors?${params}`}
            className={`rounded-md border px-2 py-1 ${
              env === e
                ? "border-violet/40 bg-violet/10 text-text"
                : "border-white/10 bg-white/[0.02] text-muted hover:text-text"
            }`}
          >
            {e || "All"}
          </Link>
        );
      })}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">
      {children}
    </span>
  );
}

function formatTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}
