import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export default function ProposalReviewsPage() {
  return (
    <Panel title="Color-team reviews" eyebrow="Coming in Phase 4b">
      <div className="font-mono text-[12px] text-muted">
        Formal Pink / Red / Gold / White Gloves review cycles with reviewer
        assignments, section-level comments, and sign-off ship in the next PR.
        For now, advance the proposal through color-team stages from the
        Overview tab.
      </div>
    </Panel>
  );
}
