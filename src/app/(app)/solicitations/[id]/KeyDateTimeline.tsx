import { Panel } from "@/components/ui/Panel";
import type { SolicitationKeyDate } from "@/db/schema";

const KEY_DATE_TYPE_LABELS: Record<SolicitationKeyDate["type"], string> = {
  qa_cutoff: "Q&A Cutoff",
  site_visit: "Site Visit",
  final_rfp: "Final RFP",
  proposal_due: "Proposal Due",
  oral_presentation: "Oral Presentation",
  expected_award: "Expected Award",
  debrief_window: "Debrief Window",
  protest_window: "Protest Window",
  other: "Milestone",
};

const KEY_DATE_TYPE_COLOR: Record<
  SolicitationKeyDate["type"],
  { color: string; bg: string; border: string }
> = {
  proposal_due: {
    color: "#f87171",
    bg: "rgba(248,113,113,0.10)",
    border: "rgba(248,113,113,0.30)",
  },
  final_rfp: {
    color: "#fb923c",
    bg: "rgba(251,146,60,0.10)",
    border: "rgba(251,146,60,0.30)",
  },
  qa_cutoff: {
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.10)",
    border: "rgba(251,191,36,0.30)",
  },
  oral_presentation: {
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.10)",
    border: "rgba(167,139,250,0.30)",
  },
  site_visit: {
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
    border: "rgba(96,165,250,0.30)",
  },
  expected_award: {
    color: "#34d399",
    bg: "rgba(52,211,153,0.10)",
    border: "rgba(52,211,153,0.30)",
  },
  debrief_window: {
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.30)",
  },
  protest_window: {
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.30)",
  },
  other: {
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.30)",
  },
};

function daysUntil(isoDate: string): number {
  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const targetMs = new Date(isoDate + "T00:00:00Z").getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

function urgencyStyle(days: number): { color: string; label: string } {
  if (days < 0) return { color: "#475569", label: `${Math.abs(days)}d ago` };
  if (days === 0) return { color: "#f87171", label: "Today" };
  if (days === 1) return { color: "#f87171", label: "Tomorrow" };
  if (days <= 3) return { color: "#f87171", label: `In ${days} days` };
  if (days <= 7) return { color: "#fbbf24", label: `In ${days} days` };
  if (days <= 14) return { color: "#fbbf24", label: `In ${days} days` };
  return { color: "#94a3b8", label: `In ${days} days` };
}

function formatDate(isoDate: string): string {
  return new Date(isoDate + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function KeyDateTimeline({
  keyDates,
}: {
  keyDates: SolicitationKeyDate[];
}) {
  const datable = keyDates.filter((kd) => kd.isoDate != null);
  if (datable.length === 0) return null;

  const sorted = [...datable].sort((a, b) =>
    (a.isoDate ?? "").localeCompare(b.isoDate ?? ""),
  );

  // Build Gantt strip geometry.
  const todayIso = new Date().toISOString().slice(0, 10);
  const allIso = [todayIso, ...sorted.map((kd) => kd.isoDate as string)];
  const minMs = Math.min(...allIso.map((d) => new Date(d + "T00:00:00Z").getTime()));
  const maxMs = Math.max(...allIso.map((d) => new Date(d + "T00:00:00Z").getTime()));
  const span = maxMs - minMs || 1;
  const todayPct =
    ((new Date(todayIso + "T00:00:00Z").getTime() - minMs) / span) * 100;

  return (
    <Panel
      title="Key dates"
      eyebrow={`${sorted.length} milestone${sorted.length !== 1 ? "s" : ""}`}
    >
      {/* Gantt strip */}
      <div className="relative mb-4 h-6">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
        {/* Today marker */}
        <div
          className="absolute top-0 h-full w-px bg-white/30"
          style={{ left: `${todayPct.toFixed(1)}%` }}
        />
        <span
          className="absolute -top-4 font-mono text-[9px] -translate-x-1/2 text-muted"
          style={{ left: `${todayPct.toFixed(1)}%` }}
        >
          today
        </span>
        {/* Date dots */}
        {sorted.map((kd) => {
          const pct =
            ((new Date((kd.isoDate as string) + "T00:00:00Z").getTime() - minMs) /
              span) *
            100;
          const style = KEY_DATE_TYPE_COLOR[kd.type];
          return (
            <div
              key={`${kd.isoDate}-${kd.label}`}
              title={`${kd.label}: ${kd.isoDate}`}
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${pct.toFixed(1)}%`,
                backgroundColor: style.color,
                boxShadow: `0 0 0 2px ${style.bg}`,
              }}
            />
          );
        })}
      </div>

      {/* Date list */}
      <ul className="space-y-2">
        {sorted.map((kd) => {
          const days = daysUntil(kd.isoDate as string);
          const urgency = urgencyStyle(days);
          const typeStyle = KEY_DATE_TYPE_COLOR[kd.type];
          const typeLabel = KEY_DATE_TYPE_LABELS[kd.type];
          const isPast = days < 0;
          return (
            <li
              key={`${kd.isoDate}-${kd.label}`}
              className="flex items-center gap-2.5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              style={{ opacity: isPast ? 0.5 : 1 }}
            >
              {/* Type badge */}
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                style={{
                  color: typeStyle.color,
                  background: typeStyle.bg,
                  border: `1px solid ${typeStyle.border}`,
                }}
              >
                {typeLabel}
              </span>

              {/* Label */}
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text">
                {kd.label}
              </span>

              {/* Date */}
              <span className="shrink-0 font-mono text-[10px] text-muted">
                {formatDate(kd.isoDate as string)}
              </span>

              {/* Days to go */}
              <span
                className="shrink-0 font-mono text-[10px] font-semibold"
                style={{ color: urgency.color }}
              >
                {urgency.label}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
