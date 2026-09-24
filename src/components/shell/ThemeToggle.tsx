"use client";

import { useEffect, useState } from "react";

/**
 * BL-UI-THEME — light (corporate default) / dark switch.
 *
 * The choice lives in localStorage under `forge.theme` and is applied as
 * `data-theme` on <html>. The inline script in app/layout.tsx applies it
 * before first paint so there is no flash; this component only reflects
 * and changes it. Per-viewer convenience, so browser storage is the
 * right home for it.
 */
export const THEME_STORAGE_KEY = "forge.theme";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private windows / blocked storage: the choice just doesn't persist.
  }
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-layer/10 bg-layer/[0.03] text-muted transition-colors hover:bg-layer/10 hover:text-text ${className}`}
    >
      <span aria-hidden className="text-[14px] leading-none">
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}
