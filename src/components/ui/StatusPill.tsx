const MAP: Record<string, string> = {
  PLANNING: "bg-paper",
  OUTLINING: "bg-bone",
  DRAFTING: "bg-cobalt text-paper",
  PINK_TEAM: "bg-[#FF80A8]",
  REVISING: "bg-hazard",
  RED_TEAM: "bg-blood text-paper",
  GOLD_TEAM: "bg-hazard",
  FINAL_REVIEW: "bg-plum text-paper",
  PRODUCTION: "bg-ink text-paper",
  SUBMITTED: "bg-signal",

  MANDATORY: "bg-blood text-paper",
  DESIRED: "bg-hazard",
  INFORMATIONAL: "bg-bone",

  NOT_ADDRESSED: "bg-blood text-paper",
  PARTIALLY: "bg-hazard",
  FULLY: "bg-signal",
  VERIFIED: "bg-ink text-paper",
  NON_COMPLIANT: "bg-blood text-paper",
  "N/A": "bg-bone",

  CRITICAL: "bg-blood text-paper",
  MAJOR: "bg-hazard",
  MINOR: "bg-bone",
  SUGGESTION: "bg-paper",

  BID: "bg-signal",
  NO_BID: "bg-blood text-paper",
  REVIEW: "bg-hazard",
};

export function StatusPill({ value }: { value: string }) {
  const tone = MAP[value] ?? "bg-paper";
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${tone}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
