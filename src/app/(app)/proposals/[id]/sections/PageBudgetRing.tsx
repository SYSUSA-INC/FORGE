"use client";

import { pageBudget, ringFill, type PageBudgetState } from "@/lib/page-budget";
import { THEME, withAlpha } from "@/lib/theme-colors";

/**
 * BL-FB-SCAN-PAGE-REALTIME — live pages against the section's cap.
 *
 * A small ring that fills as the section grows and changes colour as
 * it approaches and passes the cap (350 words per page, the density the
 * drafter and the health scan assume). Renders nothing without a cap;
 * the hover text explains the state and how much room is left.
 */
const STATE_COLOR: Record<PageBudgetState, string> = {
  none: THEME.muted,
  empty: THEME.muted,
  thin: THEME.muted,
  ok: THEME.green,
  near: THEME.brass,
  over: THEME.red,
};

export function PageBudgetRing({
  words,
  cap,
  size = 14,
}: {
  words: number;
  /** The cap as saved or as typed in the editor's cap field. */
  cap: number | string | null;
  size?: number;
}) {
  const budget = pageBudget(words, cap);
  if (budget.cap === null) return null;
  const color = STATE_COLOR[budget.state];
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = ringFill(budget);
  return (
    <span
      className="inline-flex items-center gap-1.5 tabular-nums"
      style={{ color }}
      title={budget.description}
      aria-label={`${budget.label}. ${budget.description}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={withAlpha(color, 0.25)} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * fill} ${c}`}
        />
      </svg>
      <span>
        {budget.label}
        {budget.state === "over" ? ` · over by ${budget.overBy}` : ""}
      </span>
    </span>
  );
}
