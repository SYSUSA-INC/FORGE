const ITEMS = [
  "// SOL-N00024-25-R-0094 · AMENDMENT 04 POSTED · 02:14 UTC",
  "// CPARS SYNC COMPLETE · 148 REFS INDEXED",
  "// GOLD TEAM · FRG-0042 · IN 2D 04H 11M",
  "// CLAUDE SONNET QUEUE · 3 JOBS · OK",
  "// SAM.GOV · 47 NEW RFPs · NAICS 541512",
  "// PINK TEAM · FRG-0039 · 14 COMMENTS CRITICAL",
  "// EMBEDDING WORKER · 12,482 VECTORS",
  "// PDF FORMATTER · 200P @ 12PT TNR · PASS",
];

export function Ticker() {
  const run = [...ITEMS, ...ITEMS];
  return (
    <div className="flex items-center border-t border-ink/30 bg-ink text-paper">
      <span className="shrink-0 border-r-2 border-paper/30 bg-blood px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em]">
        LIVE WIRE
      </span>
      <div className="relative flex-1 overflow-hidden">
        <div className="brut-ticker flex gap-10 whitespace-nowrap py-1 font-mono text-[11px] uppercase tracking-widest">
          {run.map((t, i) => (
            <span key={i} className="text-paper/80">
              {t}
            </span>
          ))}
        </div>
      </div>
      <span className="shrink-0 border-l-2 border-paper/30 bg-hazard px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-ink">
        FEED · ON
      </span>
    </div>
  );
}
