/**
 * BL-SCOUT-AMEND — the amendment watch's pure parts (owner, 2026-11-03):
 * "as the scout runs and finds amendments to any solicitation that we have
 * decided to go on, it must automatically download amendments and any
 * other published documents and append them to the opportunity and notify
 * the team".
 *
 * SAM.gov posts each amendment as its own notice under the solicitation
 * number, and may add attachments to a notice later. Given the
 * opportunity and every notice of its solicitation, `planWatch` says which
 * attachments are new, which notices are amendments, which of them the
 * team must hear about, and whether the response date moved.
 */
import { amendmentNumberFromName } from "@/lib/amendment-name";
import type { OpportunityStage } from "@/db/schema";

/** A pursuit that is over is not watched; a No-Go in Evaluate stops it too (BL-NAV-LIFECYCLE phase 2). */
export const UNWATCHED_STAGES: OpportunityStage[] = ["won", "lost", "no_bid"];

export const WATCH_LIMITS = {
  /** Attachments downloaded per opportunity per check; the rest wait for the next check. */
  maxDownloadsPerCheck: 10,
  /** The Q&A check's cap: an attachment larger than this is not downloaded. */
  maxDownloadBytes: 20 * 1024 * 1024,
  /** Seen links and filed notices remembered per opportunity. */
  maxRemembered: 500,
} as const;

export function isWatched(stage: OpportunityStage): boolean {
  return !UNWATCHED_STAGES.includes(stage);
}

export type WatchNotice = {
  noticeId: string;
  title: string;
  type: string;
  postedDate: string;
  responseDeadLine: string | null;
  resourceLinks: string[];
};

export type WatchState = {
  noticeId: string;
  createdAt: Date;
  responseDueDate: Date | null;
  seenLinks: string[];
  noticeIds: string[];
};

export type PlannedNotice = {
  notice: WatchNotice;
  /** Posted after the opportunity's own notice (or after the first one FORGE saw). */
  amendment: boolean;
  /** "04" from the notice title, or "" (each file may state its own). */
  amendmentNumber: string;
  /** Attachments not filed yet. */
  newLinks: string[];
  /** A notice this opportunity has not filed before. */
  newNotice: boolean;
  /** Posted after the team added the opportunity: they are told. */
  tell: boolean;
};

export type WatchPlan = {
  notices: PlannedNotice[];
  /** The latest new amendment moved the response date. */
  due: { from: Date | null; to: Date; noticeId: string } | null;
};

const at = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function planWatch(state: WatchState, notices: WatchNotice[]): WatchPlan {
  const sorted = [...notices].sort((a, b) => (at(a.postedDate)?.getTime() ?? 0) - (at(b.postedDate)?.getTime() ?? 0));
  const own = sorted.findIndex((n) => n.noticeId === state.noticeId);
  const base = own >= 0 ? own : 0;
  const seen = new Set(state.seenLinks);
  const filed = new Set(state.noticeIds);
  const planned: PlannedNotice[] = sorted.map((notice, i) => {
    const amendment = i > base;
    const posted = at(notice.postedDate);
    return {
      notice,
      amendment,
      amendmentNumber: amendment ? amendmentNumberFromName(notice.title) : "",
      newLinks: [...new Set(notice.resourceLinks)].filter((l) => !seen.has(l)),
      newNotice: notice.noticeId !== state.noticeId && !filed.has(notice.noticeId),
      tell: !!posted && posted.getTime() > state.createdAt.getTime(),
    };
  });
  // The response date follows the newest amendment the opportunity hasn't filed yet,
  // so a date the team set by hand is changed only by a later amendment.
  let due: WatchPlan["due"] = null;
  const latest = [...planned].reverse().find((p) => p.amendment && p.newNotice);
  const to = at(latest?.notice.responseDeadLine);
  if (latest && to && (!state.responseDueDate || Math.abs(to.getTime() - state.responseDueDate.getTime()) >= 60_000)) {
    due = { from: state.responseDueDate, to, noticeId: latest.notice.noticeId };
  }
  return { notices: planned, due };
}

/** What a notice is called in the message: "Amendment 04", "An amendment", or "New documents". */
export function noticeLabel(p: Pick<PlannedNotice, "amendment" | "amendmentNumber">, fileNames: string[] = []): string {
  if (!p.amendment) return "New documents";
  const n = p.amendmentNumber || fileNames.map(amendmentNumberFromName).find(Boolean) || "";
  return n ? `Amendment ${n}` : "An amendment";
}

/** A file name safe as the last segment of a storage key. */
export function storageFileName(name: string): string {
  const clean = (name || "attachment").replace(/[\u0000-\u001f\u007f/\\]+/g, "_").replace(/^\.+/, "_").trim().slice(0, 150);
  return clean || "attachment";
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The team's message: what SAM.gov posted, the date that moved, what was filed and what wasn't. */
export function watchMessage(input: {
  title: string;
  solicitationNumber: string;
  labels: string[];
  due: { from: Date | null; to: Date } | null;
  filed: string[];
  notFiled: string[];
}): { subject: string; body: string } {
  const what = input.labels.length === 1 ? input.labels[0]! : input.labels.length > 1 ? `${input.labels.length} amendments` : "New documents";
  const subject = `${what} posted — ${input.title.slice(0, 80)}`;
  const lines = [`SAM.gov posted ${what === "New documents" ? "new documents" : what.replace(/^An /, "an ")} for ${input.solicitationNumber || input.title}.`];
  if (input.labels.length > 1) lines.push(input.labels.join(", ") + ".");
  if (input.due) lines.push(`The response date moved${input.due.from ? ` from ${day(input.due.from)}` : ""} to ${day(input.due.to)}; the opportunity has the new date.`);
  if (input.filed.length > 0) {
    const shown = input.filed.slice(0, 8).join(", ");
    lines.push(`Filed on the opportunity and being read: ${shown}${input.filed.length > 8 ? `, and ${input.filed.length - 8} more` : ""}.`);
  } else if (!input.due && input.notFiled.length === 0) {
    lines.push("It has no documents; read the notice on SAM.gov for what changed.");
  }
  if (input.notFiled.length > 0) lines.push(`Not downloaded: ${input.notFiled.slice(0, 3).map((x) => x.replace(/\.$/, "")).join("; ")}. Open SAM.gov for ${input.notFiled.length === 1 ? "it" : "them"}.`);
  return { subject, body: lines.join("\n") };
}
