"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * BL-NAV-LIFECYCLE 1a — while FORGE reads an uploaded document, look again
 * every few seconds; the page shows the pre-filled form once it is read.
 */
export function ParseWaiter({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
