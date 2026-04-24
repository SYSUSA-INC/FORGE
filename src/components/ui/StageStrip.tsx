export type StageStripItem = { key: string; label: string };

export function StageStrip({
  stages,
  activeKey,
  completedKeys = [],
  onSelect,
}: {
  stages: StageStripItem[];
  activeKey: string;
  completedKeys?: string[];
  onSelect?: (key: string) => void;
}) {
  const activeIndex = stages.findIndex((s) => s.key === activeKey);

  return (
    <div className="relative flex w-full items-stretch gap-0">
      {stages.map((s, i) => {
        const completed = completedKeys.includes(s.key) || i < activeIndex;
        const active = s.key === activeKey;
        const bg = active
          ? "bg-gradient-to-br from-violet via-magenta to-gold text-white"
          : completed
            ? "bg-white/10 text-text"
            : "bg-white/[0.03] text-muted";
        const border = active ? "border-gold/50" : "border-white/10";

        return (
          <div key={s.key} className="relative flex flex-1 items-center">
            <button
              type="button"
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              className={`relative flex w-full flex-col items-center justify-center gap-1 border px-2 py-3 text-left font-display text-[11px] font-semibold transition-colors ${bg} ${border}`}
              style={{
                clipPath:
                  i === 0
                    ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
                    : i === stages.length - 1
                      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 14px 50%)"
                      : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
                marginLeft: i === 0 ? 0 : -12,
                zIndex: active ? 20 : 10 - i,
              }}
            >
              <span className="font-mono text-[9px] uppercase tracking-widest opacity-80">
                Stage {i + 1}
              </span>
              <span className="line-clamp-1">{s.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
