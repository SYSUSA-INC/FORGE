import { warmthLabel } from "@/lib/crm-logic";

const TONE: Record<ReturnType<typeof warmthLabel>, string> = {
  hot: "border-rose/40 bg-rose/10 text-rose",
  warm: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  cool: "border-indigo-400/20 bg-indigo-400/5 text-indigo-300",
  cold: "border-layer/10 bg-layer/5 text-muted",
};

/** BL-FB-X-CRM — "hot 82" chip for a relationship's warmth score. */
export function WarmthChip({ score }: { score: number }) {
  const label = warmthLabel(score);
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${TONE[label]}`} title="Relationship warmth: recency and frequency of contact, weighted by role">
      {label} {score}
    </span>
  );
}
