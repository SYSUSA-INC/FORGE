import { Panel } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export default function ProposalCompliancePage() {
  return (
    <Panel title="Compliance matrix" eyebrow="Coming in Phase 4c">
      <div className="font-mono text-[12px] text-muted">
        Section L/M compliance tracking with shall-statement mapping ships in
        a later PR. For now, use the Compliance section on the Sections tab.
      </div>
    </Panel>
  );
}
