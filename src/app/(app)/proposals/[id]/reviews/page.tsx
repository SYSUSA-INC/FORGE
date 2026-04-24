import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { proposals } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  REVIEW_COLORS,
  REVIEW_COLOR_HEX,
  REVIEW_COLOR_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  VERDICT_COLORS,
  VERDICT_LABELS,
  computeOverallVerdict,
} from "@/lib/review-types";
import {
  listOrgReviewers,
  listReviewsForProposal,
} from "./actions";
import { StartReviewPanel } from "./StartReviewPanel";

export const dynamic = "force-dynamic";

export default async function ProposalReviewsPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(eq(proposals.id, params.id), eq(proposals.organizationId, organizationId)),
    )
    .limit(1);
  if (!p) notFound();

  const [data, reviewers] = await Promise.all([
    listReviewsForProposal(params.id),
    listOrgReviewers(),
  ]);

  const assignmentsByReview = new Map<
    string,
    {
      userId: string;
      name: string | null;
      email: string;
      verdict: string | null;
      submittedAt: Date | null;
    }[]
  >();
  for (const a of data.assignments) {
    const list = assignmentsByReview.get(a.reviewId) ?? [];
    list.push({
      userId: a.userId,
      name: a.name ?? null,
      email: a.email ?? "",
      verdict: a.verdict,
      submittedAt: a.submittedAt,
    });
    assignmentsByReview.set(a.reviewId, list);
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Panel
          title="Color-team reviews"
          eyebrow={`${data.reviews.length} ${data.reviews.length === 1 ? "review" : "reviews"}`}
        >
          {data.reviews.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No reviews yet. Start a Pink Team review from the panel on the
              right.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.reviews.map((r) => {
                const assigns = assignmentsByReview.get(r.id) ?? [];
                const colorHex = REVIEW_COLOR_HEX[r.color];
                const statusColor = STATUS_COLORS[r.status];
                const submittedCount = assigns.filter(
                  (a) => !!a.submittedAt,
                ).length;
                const overall =
                  computeOverallVerdict(
                    assigns.map((a) =>
                      a.verdict
                        ? (a.verdict as "pass" | "conditional" | "fail")
                        : null,
                    ),
                  ) ?? null;
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]"
                            style={{
                              color: colorHex,
                              backgroundColor: `${colorHex}1A`,
                              border: `1px solid ${colorHex}40`,
                            }}
                          >
                            {REVIEW_COLOR_LABELS[r.color]}
                          </span>
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                            style={{
                              color: statusColor,
                              backgroundColor: `${statusColor}1A`,
                              border: `1px solid ${statusColor}40`,
                            }}
                          >
                            {STATUS_LABELS[r.status]}
                          </span>
                          {r.verdict ? (
                            <span
                              className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                              style={{
                                color: VERDICT_COLORS[r.verdict],
                                backgroundColor: `${VERDICT_COLORS[r.verdict]}1A`,
                                border: `1px solid ${VERDICT_COLORS[r.verdict]}40`,
                              }}
                            >
                              Final: {VERDICT_LABELS[r.verdict]}
                            </span>
                          ) : overall ? (
                            <span
                              className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                              style={{
                                color: VERDICT_COLORS[overall],
                                backgroundColor: `${VERDICT_COLORS[overall]}1A`,
                                border: `1px solid ${VERDICT_COLORS[overall]}40`,
                              }}
                            >
                              Trending: {VERDICT_LABELS[overall]}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted">
                          {submittedCount}/{assigns.length} reviewers submitted
                          {r.dueDate
                            ? ` · due ${new Date(r.dueDate).toLocaleDateString()}`
                            : ""}
                          {r.startedAt
                            ? ` · started ${new Date(r.startedAt).toLocaleDateString()}`
                            : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {assigns.length === 0 ? (
                            <span className="font-mono text-[10px] text-muted">
                              No reviewers
                            </span>
                          ) : (
                            assigns.map((a) => (
                              <span
                                key={a.userId}
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                  a.submittedAt
                                    ? "bg-emerald/10 text-emerald"
                                    : "bg-white/5 text-muted"
                                }`}
                              >
                                {(a.name ?? a.email) || "?"}
                                {a.verdict ? ` · ${a.verdict}` : ""}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <Link
                        href={`/proposals/${params.id}/reviews/${r.id}`}
                        className="aur-btn aur-btn-ghost text-[11px]"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <StartReviewPanel
        proposalId={params.id}
        colors={REVIEW_COLORS}
        reviewers={reviewers}
      />
    </div>
  );
}
