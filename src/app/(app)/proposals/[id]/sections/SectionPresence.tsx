"use client";

import { useEffect, useState } from "react";
import { PRESENCE_HEARTBEAT_MS, initials, presenceLabel } from "@/lib/presence-logic";
import { leaveSectionPresenceAction, sectionPresenceAction } from "./presence-actions";

/**
 * BL-FB-CHAT-MULTI Slice 3 — while this section is open, check in every
 * 30 seconds (only while the tab is visible) and show who else has it
 * open; leave on close. Renders nothing when you're alone.
 */
export function SectionPresence({ sectionId }: { sectionId: string }) {
  const [viewers, setViewers] = useState<{ userId: string; name: string }[]>([]);

  useEffect(() => {
    let alive = true;
    const beat = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await sectionPresenceAction(sectionId);
        if (alive && res.ok) setViewers(res.viewers);
      } catch {
        // Presence is best-effort; a missed check-in just ages out.
      }
    };
    void beat();
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void leaveSectionPresenceAction(sectionId).catch(() => undefined);
    };
  }, [sectionId]);

  if (viewers.length === 0) return null;
  const label = presenceLabel(viewers.map((v) => v.name));
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-emerald/40 bg-emerald/10 px-1.5 py-0.5 text-[9px] normal-case tracking-widest text-emerald"
      title={`${label} — they have this section open now.`}
    >
      <span className="flex -space-x-1">
        {viewers.slice(0, 3).map((v) => (
          <span key={v.userId} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald/40 bg-canvas text-[8px] text-text">
            {initials(v.name)}
          </span>
        ))}
      </span>
      {label}
    </span>
  );
}
