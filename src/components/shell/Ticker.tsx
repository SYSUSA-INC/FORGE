const ITEMS = [
  "SOL N00024-25-R-0094 · Amendment 04 posted",
  "CPARS sync complete · 148 references indexed",
  "Gold Team · FRG-0042 · 2d 04h remaining",
  "Sonnet queue healthy · 3 jobs active",
  "SAM.gov · 47 new RFPs · NAICS 541512",
  "Pink Team · FRG-0039 · 14 critical comments",
  "Embedding worker · 12,482 vectors",
  "PDF formatter · 200p at 12pt TNR · pass",
];

export function Ticker() {
  const run = [...ITEMS, ...ITEMS];
  return (
    <div className="flex items-center border-t border-ink/30 bg-ink text-paper">
      <span className="shrink-0 border-r-2 border-paper/30 bg-ink px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-paper">
        Activity
      </span>
      <div className="relative flex-1 overflow-hidden">
        <div className="brut-ticker flex gap-10 whitespace-nowrap py-1 font-mono text-[11px] text-paper/80">
          {run.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
