"use client";

import { useEffect, useState } from "react";

export function SessionClock() {
  // Set after mount: the server's second and the browser's never match,
  // and a time rendered on both was a hydration mismatch on every page.
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    setNow(formatTime(new Date()));
    const id = setInterval(() => setNow(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden items-center gap-2 font-mono text-[11px] tracking-meta text-muted md:flex">
      {/* EnableNow's live signal: the green of its office clocks. */}
      <span className="h-1.5 w-1.5 animate-pulseSoft rotate-45 bg-signal-live" aria-hidden />
      <span>UTC {now ?? "--:--:--"}</span>
    </div>
  );
}

function formatTime(d: Date) {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
