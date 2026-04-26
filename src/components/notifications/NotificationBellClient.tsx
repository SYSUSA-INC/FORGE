"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  markNotificationsReadAction,
  type NotificationRow,
} from "@/app/(app)/notifications/actions";
import {
  NOTIFICATION_KIND_COLORS,
  NOTIFICATION_KIND_ICONS,
} from "@/lib/notification-types";
import { BellIcon } from "./NotificationBell";

export function NotificationBellClient({
  unread,
  recent,
}: {
  unread: number;
  recent: NotificationRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationsReadAction([id]);
      router.refresh();
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
          open
            ? "border-white/20 bg-white/10 text-text"
            : "border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:text-text"
        }`}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-magenta px-1 font-mono text-[9px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-white/10 bg-canvas shadow-card">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Notifications
            </span>
            <span className="font-mono text-[10px] text-subtle">
              {unread > 0 ? `${unread} unread` : "All caught up"}
            </span>
          </div>
          {recent.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-muted">
              Nothing yet.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {recent.map((n) => {
                const isUnread = !n.readAt;
                const color = NOTIFICATION_KIND_COLORS[n.kind];
                return (
                  <li
                    key={n.id}
                    className="border-b border-white/5 last:border-b-0"
                  >
                    <Link
                      href={n.linkPath || "/notifications"}
                      onClick={() => {
                        setOpen(false);
                        if (isUnread) markOne(n.id);
                      }}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] ${
                        isUnread ? "" : "opacity-70"
                      }`}
                    >
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded font-display text-xs"
                        style={{
                          color,
                          backgroundColor: `${color}1A`,
                          border: `1px solid ${color}50`,
                        }}
                        aria-hidden
                      >
                        {NOTIFICATION_KIND_ICONS[n.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-[13px] ${
                            isUnread
                              ? "font-semibold text-text"
                              : "text-muted"
                          }`}
                        >
                          {n.subject}
                        </div>
                        {n.body ? (
                          <div className="mt-0.5 line-clamp-2 font-body text-[11px] text-muted">
                            {n.body}
                          </div>
                        ) : null}
                        <div className="mt-1 font-mono text-[10px] text-subtle">
                          {new Date(n.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-white/10 px-4 py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-teal hover:bg-white/[0.04]"
          >
            View all{pending ? " · …" : ""}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
