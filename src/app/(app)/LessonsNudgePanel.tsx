import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { lessonLoopStats } from "@/lib/lessons-read";
import { safeQuery } from "@/lib/schema-resilience";

/**
 * BL-LESSONS-LOOP phase 4c — the Command Center's nudge for the people
 * who confirm lessons: how many wait as proposed, and the loop so far.
 * Renders nothing for other roles and when nothing waits.
 */
export async function LessonsNudgePanel({ canConfirm }: { canConfirm: boolean }) {
  if (!canConfirm) return null;
  const { organizationId } = await requireCurrentOrg();
  const stats = await safeQuery(() => lessonLoopStats(organizationId), { proposed: 0, confirmed: 0, applied: 0, closed: 0 }, { tag: "command-center.lessons" });
  if (stats.proposed === 0) return null;
  return (
    <section className="mb-6">
      <Panel
        title="Lessons waiting"
        eyebrow={`${stats.proposed} proposed · ${stats.confirmed} confirmed · ${stats.closed} closed the loop`}
        accent="gold"
        actions={
          <Link href="/intelligence/lessons" className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
            Confirm →
          </Link>
        }
      >
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          FORGE drafted {stats.proposed} lesson{stats.proposed === 1 ? "" : "s"} from decided bids that nobody has confirmed yet. Nothing reads a lesson until a Capture or Admin user confirms it; the drafter, the evaluation tab and the pursuit brief then apply it to the next bid.
        </p>
      </Panel>
    </section>
  );
}
