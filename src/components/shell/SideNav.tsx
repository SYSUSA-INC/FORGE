"use client";

import { useEffect, useState } from "react";
import { NavContent } from "@/components/shell/NavContent";

type NavUser = {
  name: string | null;
  email: string;
  image: string | null;
};

const NAV_RAIL_COLLAPSED_KEY = "forge.nav.rail.v1";

function readRailCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAV_RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Outer sticky aside. Width follows NavContent's collapsed state via
 * the `forge:nav-rail` event NavContent dispatches. We read the
 * initial value from localStorage so the aside picks the right width
 * on first render — same source of truth, no flash.
 */
export function SideNav({
  isOrgAdmin = false,
  isSuperadmin = false,
  user,
}: {
  isOrgAdmin?: boolean;
  isSuperadmin?: boolean;
  user: NavUser | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readRailCollapsed());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { collapsed?: boolean }
        | undefined;
      if (typeof detail?.collapsed === "boolean") {
        setCollapsed(detail.collapsed);
      }
    };
    window.addEventListener("forge:nav-rail", handler);
    return () => window.removeEventListener("forge:nav-rail", handler);
  }, []);

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-canvas/70 backdrop-blur-xl transition-[width] duration-200 lg:flex ${
        collapsed ? "w-[60px]" : "w-60"
      }`}
    >
      <NavContent
        isOrgAdmin={isOrgAdmin}
        isSuperadmin={isSuperadmin}
        user={user}
      />
    </aside>
  );
}
