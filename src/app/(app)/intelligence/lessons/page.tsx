import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listLessons } from "@/lib/lessons-draft";
import { safeQuery } from "@/lib/schema-resilience";
import { LessonsList, type LessonView } from "../../proposals/[id]/outcome/LessonsList";

export const dynamic = "force-dynamic";

const CONFIRM_ROLES = ["admin", "capture"];

/**
 * BL-LESSONS-LOOP phase 4a — every lesson the organization has recorded,
 * with the bid it came from. Phase 4c adds where each was applied and
 * how that bid ended.
 */
export default async function LessonsPage() {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const canConfirm = user.isSuperadmin || (!!user.role && CONFIRM_ROLES.includes(user.role));
  const rows = await safeQuery(() => listLessons({ organizationId }), [], { tag: "lessons.list" });
  const lessons: LessonView[] = rows.map((r) => ({
    ...r,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    applications: r.applications.map((a) => ({ ...a, appliedAt: a.appliedAt.toISOString() })),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Platform Intelligence"
        title="Lessons"
        subtitle="What every decided bid taught the company: drafted by FORGE from the outcome, the debrief, the winner analysis and the reviews, confirmed by a person, and read back by the next bid."
      />
      <LessonsList lessons={lessons} canConfirm={canConfirm} showBid title="All lessons" />
    </>
  );
}
