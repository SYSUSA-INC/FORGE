"use client";

import { NavContent } from "@/components/shell/NavContent";

export function SideNav({
  isOrgAdmin = false,
  isSuperadmin = false,
}: {
  isOrgAdmin?: boolean;
  isSuperadmin?: boolean;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-canvas/70 backdrop-blur-xl lg:flex">
      <NavContent isOrgAdmin={isOrgAdmin} isSuperadmin={isSuperadmin} />
    </aside>
  );
}
