"use client";

import { useEffect, useState } from "react";

export function SessionClock() {
  const [now, setNow] = useState<string>(() => formatTime(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNow(formatTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] tracking-widest text-muted md:flex">
      <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-violet" aria-hidden />
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
