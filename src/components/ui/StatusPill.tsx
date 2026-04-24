const MAP: Record<string, string> = {
  PLANNING: "border-white/15 bg-white/5 text-muted",
  OUTLINING: "border-white/15 bg-white/5 text-muted",
  DRAFTING: "border-violet/40 bg-violet/15 text-violet",
  PINK_TEAM: "border-magenta/40 bg-magenta/15 text-magenta",
  REVISING: "border-gold/40 bg-gold/15 text-gold",
  RED_TEAM: "border-rose/40 bg-rose/15 text-rose",
  GOLD_TEAM: "border-gold/40 bg-gold/15 text-gold",
  FINAL_REVIEW: "border-violet/40 bg-violet/15 text-violet",
  PRODUCTION: "border-white/20 bg-white/10 text-text",
  SUBMITTED: "border-emerald/40 bg-emerald/15 text-emerald",

  MANDATORY: "border-rose/40 bg-rose/15 text-rose",
  DESIRED: "border-gold/40 bg-gold/15 text-gold",
  INFORMATIONAL: "border-white/15 bg-white/5 text-muted",

  NOT_ADDRESSED: "border-rose/40 bg-rose/15 text-rose",
  PARTIALLY: "border-gold/40 bg-gold/15 text-gold",
  FULLY: "border-emerald/40 bg-emerald/15 text-emerald",
  VERIFIED: "border-violet/40 bg-violet/15 text-violet",
  NON_COMPLIANT: "border-rose/40 bg-rose/15 text-rose",
  "N/A": "border-white/15 bg-white/5 text-muted",

  CRITICAL: "border-rose/40 bg-rose/15 text-rose",
  MAJOR: "border-gold/40 bg-gold/15 text-gold",
  MINOR: "border-white/15 bg-white/5 text-muted",
  SUGGESTION: "border-white/15 bg-white/5 text-muted",

  BID: "border-emerald/40 bg-emerald/15 text-emerald",
  NO_BID: "border-rose/40 bg-rose/15 text-rose",
  REVIEW: "border-gold/40 bg-gold/15 text-gold",
};

export function StatusPill({ value }: { value: string }) {
  const tone = MAP[value] ?? "border-white/15 bg-white/5 text-muted";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
