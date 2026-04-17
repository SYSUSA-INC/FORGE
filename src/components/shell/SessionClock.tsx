"use client";

import { useEffect, useState } from "react";

export function SessionClock() {
  const [now, setNow] = useState<string>(() => formatTime(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNow(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden items-center gap-2 border-2 border-ink bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-paper md:flex">
      <span className="h-2 w-2 animate-blink bg-signal" aria-hidden />
      <span>UTC {now}</span>
    </div>
  );
}

function formatTime(d: Date) {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
