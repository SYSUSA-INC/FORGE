"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { sendMeetingInvitesAction, setReviewMeetingAction } from "../actions";

/** An ISO instant as the `datetime-local` input wants it: the viewer's local clock, to the minute. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * BL-NAV-LIFECYCLE 5c — the round's meeting. The lead pastes a link from
 * their own calendar (Teams, Zoom, Webex); FORGE creates no meeting. Send
 * invites emails every reviewer a calendar invite carrying the link and
 * their sections; the day before, the reminder carries the link again.
 */
export function MeetingPanel({
  reviewId,
  url,
  at,
  invitesSentAt,
  reminderSentAt,
  reviewerCount,
  canEdit,
}: {
  reviewId: string;
  url: string | null;
  at: string | null;
  invitesSentAt: string | null;
  reminderSentAt: string | null;
  reviewerCount: number;
  canEdit: boolean;
}) {
  const [link, setLink] = useState(url ?? "");
  const [when, setWhen] = useState(toLocalInput(at));
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = link.trim() !== (url ?? "") || when !== toLocalInput(at);
  const ready = !!url && !!at;

  function save() {
    setStatus(null);
    startTransition(async () => {
      const res = await setReviewMeetingAction({ reviewId, url: link, at: when ? new Date(when).toISOString() : "" });
      setStatus(res.ok ? { tone: "ok", text: link.trim() || when ? "Meeting saved." : "Meeting cleared." } : { tone: "err", text: res.error });
    });
  }

  function sendInvites() {
    setStatus(null);
    startTransition(async () => {
      const res = await sendMeetingInvitesAction({ reviewId });
      setStatus(
        res.ok
          ? { tone: res.failed > 0 ? "err" : "ok", text: `Invites sent to ${res.sent} reviewer${res.sent === 1 ? "" : "s"}${res.failed > 0 ? `; ${res.failed} could not be emailed` : ""}.` }
          : { tone: "err", text: res.error },
      );
    });
  }

  return (
    <Panel title="Meeting" eyebrow={ready ? "Link and time set" : "Optional"}>
      {canEdit ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-subtle">
            Meeting link
            <input
              className="aur-input normal-case tracking-normal"
              type="url"
              inputMode="url"
              placeholder="Paste the Teams, Zoom or Webex link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={pending}
              maxLength={500}
            />
          </label>
          <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-subtle">
            Starts (your local time)
            <input className="aur-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={pending} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending || !dirty} className="aur-btn aur-btn-primary disabled:opacity-50">
              {pending ? "Saving…" : "Save meeting"}
            </button>
            <button type="button" onClick={sendInvites} disabled={pending || dirty || !ready || reviewerCount === 0} className="aur-btn disabled:opacity-50">
              {invitesSentAt ? "Send invites again" : "Send invites"}
            </button>
          </div>
          <p className="font-body text-[12px] leading-relaxed text-muted">
            FORGE does not create the meeting: paste the link from your own calendar. The invite is a one-hour calendar event (.ics) with the link and each reviewer&apos;s sections,
            and a reminder with the link goes the day before. Send again after moving the time and the reviewer&apos;s calendar updates.
          </p>
        </div>
      ) : url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[12px] text-accent underline">
          {url}
        </a>
      ) : null}
      <div className="mt-3 border-t border-layer/10 pt-3 font-mono text-[11px] text-muted">
        {at ? <div>Starts {new Date(at).toLocaleString()}</div> : null}
        <div>{invitesSentAt ? `Invites sent ${new Date(invitesSentAt).toLocaleString()}` : "Invites not sent yet"}</div>
        <div>{reminderSentAt ? `Reminder sent ${new Date(reminderSentAt).toLocaleString()}` : "Day-before reminder not sent yet"}</div>
      </div>
      {status ? (
        <p role="status" className={`mt-2 font-mono text-[11px] ${status.tone === "ok" ? "text-green" : "text-red-400"}`}>
          {status.text}
        </p>
      ) : null}
    </Panel>
  );
}
