/**
 * BL-FB-CHAT-MULTI Slice 3 — who else has a section open, pure parts:
 * the timings and the words. The server side is `section-presence.ts`.
 */

/** How often an open section checks in. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Seen within this long = here (two missed check-ins and a margin). */
export const PRESENCE_TTL_MS = 75_000;
/** Rows older than this are swept on the next check-in for the section. */
export const PRESENCE_SWEEP_MS = 10 * 60_000;

export type PresenceRow = { userId: string; name: string; lastSeenAt: Date };

/** The other members here now, by name, without the viewer. */
export function activeViewers(rows: readonly PresenceRow[], selfId: string, now: Date = new Date()): { userId: string; name: string }[] {
  return rows
    .filter((r) => r.userId !== selfId && now.getTime() - r.lastSeenAt.getTime() <= PRESENCE_TTL_MS)
    .map((r) => ({ userId: r.userId, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const first = (name: string) => name.trim().split(/[\s@]/)[0] || name;

/** "Ana is here" · "Ana and Ben are here" · "Ana, Ben and 2 others are here"; empty when alone. */
export function presenceLabel(names: readonly string[]): string {
  const n = names.map(first);
  if (n.length === 0) return "";
  if (n.length === 1) return `${n[0]} is here`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are here`;
  const rest = n.length - 2;
  return `${n[0]}, ${n[1]} and ${rest} other${rest === 1 ? "" : "s"} are here`;
}

/** Up to two initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}
