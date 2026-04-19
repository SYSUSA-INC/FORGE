"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NavContent } from "@/components/shell/NavContent";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const original = document.body.style.overflow;
    document.body.style.overflow = open ? "hidden" : original;
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="forge-mobile-nav"
        className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-text transition-colors hover:border-white/20 hover:bg-white/10 lg:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <rect x="2" y="3.5" width="12" height="1.5" rx="0.75" fill="currentColor" />
          <rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor" />
          <rect x="2" y="11" width="12" height="1.5" rx="0.75" fill="currentColor" />
        </svg>
      </button>

      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-canvas/70 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        id="forge-mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Primary navigation"
        className={`fixed left-0 top-0 z-50 flex h-screen w-72 max-w-[85vw] flex-col border-r border-white/10 bg-canvas/95 shadow-card-lg backdrop-blur-xl transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-md border border-white/10 bg-white/5 font-mono text-sm text-muted transition-colors hover:border-white/20 hover:text-text"
        >
          ✕
        </button>
        <NavContent onNavigate={() => setOpen(false)} />
      </aside>
    </>
  );
}
