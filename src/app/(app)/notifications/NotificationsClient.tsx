"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  NOTIFICATION_KIND_COLORS,
  NOTIFICATION_KIND_ICONS,
  NOTIFICATION_KIND_LABELS,
} from "@/lib/notification-types";
import {
  markAllNotificationsReadAction,
  markNotificationsReadAction,
  type NotificationRow,
} from "./actions";

type Filter = "unread" | "all";

export function NotificationsClient({ initial }: { initial: NotificationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>(
    initial.some((r) => !r.readAt) ? "unread" : "all",
  );

  const filtered = useMemo(() => {
    if (filter === "unread") return initial.filter((r) => !r.readAt);
    return initial;
  }, [initial, filter]);

  function markRead(ids: string[]) {
    startTransition(async () => {
      const res = await markNotificationsReadAction(ids);
      if (res.ok) router.refresh();
    });
  }

  function markAllRead() {
    startTransition(async () => {
      const res = await markAllNotificationsReadAction();
      if (res.ok) router.refresh();
    });
  }

  return (
    <Panel
      title="Activity"
      eyebrow={`${filtered.length} shown`}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-white/10 bg-white/[0.02] p-0.5 font-mono text-[10px] uppercase tracking-widest">
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={`px-2.5 py-1 ${
                filter === "unread"
                  ? "bg-white/10 text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              Unread
            </button>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 ${
                filter === "all"
                  ? "bg-white/10 text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              All
            </button>
          </div>
          <button
            type="button"
            disabled={pending || initial.every((r) => r.readAt)}
            onClick={markAllRead}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50"
          >
            {pending ? "Updating…" : "Mark all read"}
          </button>
        </div>
      }
    >
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/10 px-4 py-8 text-center font-mono text-[11px] text-muted">
          {filter === "unread"
            ? "Nothing unread. Nice."
            : "No notifications yet — assignments and mentions will land here."}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((n) => {
            const isUnread = !n.readAt;
            const accent = NOTIFICATION_KIND_COLORS[n.kind];
            return (
              <li key={n.id}>
                <div
                  className={`flex gap-3 rounded-md border px-3 py-3 transition-colors ${
                    isUnread
                      ? "border-white/15 bg-white/[0.04]"
                      : "border-white/10 bg-white/[0.02] opacity-70"
                  }`}
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md font-display text-sm"
                    style={{
                      color: accent,
                      backgroundColor: `${accent}1A`,
                      border: `1px solid ${accent}50`,
                    }}
                    aria-hidden
                  >
                    {NOTIFICATION_KIND_ICONS[n.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={n.linkPath || "#"}
                        onClick={() => {
                          if (isUnread) markRead([n.id]);
                        }}
                        className={`min-w-0 truncate font-display text-[14px] ${
                          isUnread ? "font-semibold text-text" : "text-muted"
                        }`}
                      >
                        {n.subject}
                      </Link>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                        {NOTIFICATION_KIND_LABELS[n.kind]}
                      </span>
                    </div>
                    {n.body ? (
                      <div className="mt-0.5 truncate font-body text-[12px] text-muted">
                        {n.body}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-subtle">
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                      {n.actorName || n.actorEmail ? (
                        <span>by {n.actorName ?? n.actorEmail}</span>
                      ) : null}
                      {n.emailError ? (
                        <span className="text-rose">
                          email failed: {n.emailError}
                        </span>
                      ) : n.emailSentAt ? (
                        <span className="text-emerald">email sent</span>
                      ) : null}
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={() => markRead([n.id])}
                          className="ml-auto uppercase tracking-widest text-muted hover:text-text"
                          disabled={pending}
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
