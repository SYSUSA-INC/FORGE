import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { proposals, solicitations, reviewComments } from "@/lib/mock";

export default function DashboardPage() {
  const activeProposals = proposals.filter((p) => p.status !== "SUBMITTED");
  const hottest = [...activeProposals].sort((a, b) => a.daysLeft - b.daysLeft)[0];

  const pipelineValueMs = proposals.reduce((a, p) => a + p.pagesLimit * 0, 0);
  const nextDeadline = hottest
    ? `${hottest.daysLeft}d`
    : "—";

  return (
    <>
      <PageHeader
        eyebrow="Command"
        title="Command"
        subtitle="Capture operations, proposal velocity, and compliance deltas across the active pipeline."
        actions={
          <>
            <button className="aur-btn">Refresh</button>
            <Link href="/solicitations/new" className="aur-btn">
              New solicitation
            </Link>
            <Link href="/proposals/new" className="aur-btn-primary">
              New proposal
            </Link>
          </>
        }
        meta={[
          {
            label: "Active proposals",
            value: String(activeProposals.length).padStart(2, "0"),
          },
          {
            label: "In review",
            value: String(
              proposals.filter((p) =>
                ["PINK_TEAM", "RED_TEAM", "GOLD_TEAM", "FINAL_REVIEW"].includes(p.status),
              ).length,
            ).padStart(2, "0"),
          },
          { label: "Pipeline value", value: pipelineValueMs > 0 ? `$${pipelineValueMs}` : "—" },
          { label: "Next deadline", value: nextDeadline, accent: hottest ? "rose" : undefined },
        ]}
      />

      <div className="mb-4 aur-card px-4 py-2 font-mono text-[11px] tracking-wide text-muted">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Data as of{" "}
            <span className="font-semibold text-text">
              {new Date().toISOString().slice(0, 10)}
            </span>
            .
          </span>
          <span className="text-subtle">Streaming updates every 60 s.</span>
        </div>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        {hottest ? (
          <div className="aur-card overflow-hidden">
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
                  Priority proposal
                </span>
                <span className="font-mono text-[10px] text-subtle">{hottest.code}</span>
              </div>
              <StatusPill value={hottest.status} />
            </header>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_auto]">
              <div>
                <div className="font-display text-2xl font-semibold leading-tight text-text">
                  {hottest.title}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted">
                  {hottest.solicitation} · {hottest.agency}
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3 font-mono text-[11px]">
                  <KeyFact
                    label="Due in"
                    value={`${hottest.daysLeft}d`}
                    sub={hottest.dueAt.split(" ")[0]}
                    emphasize="rose"
                  />
                  <KeyFact
                    label="Compliance"
                    value={`${hottest.compliancePct}%`}
                    sub="Target ≥ 95%"
                  />
                  <KeyFact
                    label="Pages"
                    value={`${hottest.pagesEstimated}`}
                    sub={`of ${hottest.pagesLimit}`}
                  />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Link
                    href={`/proposals/${hottest.id}/editor`}
                    className="aur-btn-primary w-full justify-center"
                  >
                    Open editor
                  </Link>
                  <Link
                    href={`/proposals/${hottest.id}/compliance`}
                    className="aur-btn w-full justify-center"
                  >
                    View compliance
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyCard
            title="No active proposals yet"
            description="Start a proposal from a solicitation to see the priority summary here."
            actionHref="/proposals/new"
            actionLabel="New proposal"
          />
        )}

        <div className="flex flex-col gap-4">
          <Panel title="Capture readiness">
            <EmptyInline message="No opportunities in the pipeline yet." />
          </Panel>

          <Panel title="Win probability">
            <EmptyInline message="Add submitted proposals to see trend." />
          </Panel>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Active pipeline"
          actions={
            <Link
              href="/proposals"
              className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted hover:text-text"
            >
              View all
            </Link>
          }
          dense
        >
          {activeProposals.length === 0 ? (
            <EmptyInline
              message="No active proposals."
              cta={{ href: "/proposals/new", label: "Create your first proposal" }}
            />
          ) : (
            <div className="divide-y divide-white/10">
              {activeProposals.map((p) => (
                <Link
                  key={p.id}
                  href={`/proposals/${p.id}/editor`}
                  className="grid grid-cols-[100px_1fr_auto] items-center gap-4 p-4 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {p.code}
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-center font-display text-xl font-semibold tabular-nums leading-none text-text">
                      {p.daysLeft}d
                    </span>
                    <span className="text-center font-mono text-[9px] uppercase tracking-widest text-muted">
                      Remaining
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill value={p.status} />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                        {p.solicitation}
                      </span>
                    </div>
                    <div className="mt-1 font-display text-lg font-semibold leading-tight text-text">
                      {p.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                      {p.agency} · Due {p.dueAt}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <BarMeter label="Progress" value={p.progress} />
                      <BarMeter
                        label="Compliance"
                        value={p.compliancePct}
                        color={
                          p.compliancePct >= 90
                            ? "emerald"
                            : p.compliancePct >= 70
                              ? "gold"
                              : "rose"
                        }
                      />
                      <BarMeter
                        label="Pages"
                        value={p.pagesEstimated}
                        max={p.pagesLimit}
                        color={
                          p.pagesEstimated > p.pagesLimit * 0.95 ? "rose" : "violet"
                        }
                        right={`${p.pagesEstimated}/${p.pagesLimit}`}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      AI drafted
                    </div>
                    <div className="font-display text-2xl font-semibold tabular-nums leading-none text-text">
                      {p.aiPct}%
                    </div>
                    <div className="aur-chip mt-2">{p.captureManager}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Upcoming deadlines">
          <EmptyInline message="No upcoming deadlines." />
        </Panel>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Panel title="Agency × phase load">
          <EmptyInline message="No activity yet." />
        </Panel>

        <Panel title="AI engine · 24 h">
          <div className="grid grid-cols-2 gap-2">
            <SmallKPI k="Drafts" v="0" />
            <SmallKPI k="Revisions" v="0" />
            <SmallKPI k="Embeddings" v="0" />
            <SmallKPI k="Audit log" v="OK" />
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span className="text-muted">Model mix</span>
              <span className="text-subtle">No generations yet</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.02]" />
          </div>
        </Panel>

        <Panel
          title="SAM.gov — new hits"
          actions={
            <Link
              href="/solicitations"
              className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted hover:text-text"
            >
              Browse
            </Link>
          }
        >
          {solicitations.length === 0 ? (
            <EmptyInline
              message="No solicitations ingested yet."
              cta={{ href: "/solicitations/new", label: "Ingest first solicitation" }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {solicitations.slice(0, 4).map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-white/10 bg-white/[0.02] p-2"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-muted">
                      {s.agency}
                    </div>
                    <div className="font-display text-sm font-semibold leading-tight text-text">
                      {s.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-subtle">
                      {s.number} · NAICS {s.naics} · {s.setAside}
                    </div>
                    <div className="mt-1">
                      <DotMeter value={s.pWin} steps={14} />
                    </div>
                  </div>
                  <StatusPill value={s.bidDecision} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Critical review comments">
          {reviewComments.length === 0 ? (
            <EmptyInline message="No review comments yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {reviewComments
                .filter((c) => c.severity === "CRITICAL" || c.severity === "MAJOR")
                .slice(0, 5)
                .map((c) => (
                  <li
                    key={c.id}
                    className="relative grid grid-cols-[90px_1fr_auto] gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3"
                  >
                    <span
                      className={`absolute left-0 top-0 h-full w-1 rounded-l-md ${
                        c.severity === "CRITICAL" ? "bg-rose" : "bg-gold"
                      }`}
                      aria-hidden
                    />
                    <div className="pl-2">
                      <StatusPill value={c.severity} />
                      <div className="mt-1 font-mono text-[10px] uppercase text-muted">
                        {c.cycle} · {c.age}
                      </div>
                    </div>
                    <div>
                      <div className="font-display text-sm font-semibold text-text">
                        {c.section}
                      </div>
                      <p className="mt-0.5 text-sm leading-snug text-muted">{c.comment}</p>
                      <div className="mt-1 font-mono text-[10px] uppercase text-muted">
                        {c.reviewer} · Anchor {c.anchor}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="aur-chip">{c.id}</span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel title="Daily capture note">
          <EmptyInline message="No notes for today." />
        </Panel>
      </section>
    </>
  );
}

function KeyFact({
  label,
  value,
  sub,
  emphasize,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: "rose" | "gold" | "emerald";
}) {
  const valueTone =
    emphasize === "rose"
      ? "text-rose"
      : emphasize === "gold"
        ? "text-gold"
        : emphasize === "emerald"
          ? "text-emerald"
          : "text-text";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
        {label}
      </div>
      <div
        className={`font-display text-2xl font-semibold tabular-nums leading-none ${valueTone}`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function SmallKPI({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted">{k}</div>
      <div className="font-display text-lg font-semibold tabular-nums leading-none text-text">
        {v}
      </div>
    </div>
  );
}

function EmptyInline({
  message,
  cta,
}: {
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-white/10 px-4 py-5 text-[13px] text-muted">
      <span>{message}</span>
      {cta ? (
        <Link href={cta.href} className="aur-btn-ghost px-0 py-0 text-[12px]">
          {cta.label} →
        </Link>
      ) : null}
    </div>
  );
}

function EmptyCard({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="aur-card flex flex-col items-start gap-3 p-8">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-violet" />
        Priority proposal
      </div>
      <h2 className="font-display text-2xl font-semibold text-text">{title}</h2>
      <p className="max-w-xl text-[14px] leading-relaxed text-muted">{description}</p>
      <Link href={actionHref} className="aur-btn-primary mt-2">
        {actionLabel}
      </Link>
    </div>
  );
}
