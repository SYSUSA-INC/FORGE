import { type ReactNode } from "react";

/**
 * A colour-team or stage tag: ink label, the team hue only on the
 * leading diamond, so "Red Team" never reads as a lost or failed status.
 */
export function ColorTeamTag({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <span className="aur-tag">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 flex-none rotate-45"
        style={{ backgroundColor: color }}
      />
      {children}
    </span>
  );
}
