"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * BL-15 Phase B-3b — banner button that POSTs to
 * `/api/admin/impersonation/end`. The API route is the carve-out from
 * the middleware write-block; every other mutation refuses while the
 * impersonation cookie is set.
 */
export function EndImpersonationButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function end() {
    startTransition(async () => {
      try {
        await fetch("/api/admin/impersonation/end", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // Best-effort — the server-side row + cookie are the source of
        // truth; if the network blip lost our response we re-route to
        // /admin anyway so the user can re-confirm.
      }
      router.refresh();
      router.push("/admin");
    });
  }

  return (
    <button
      type="button"
      onClick={end}
      disabled={pending}
      className="rounded border border-white/30 bg-white/15 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-white/25 disabled:opacity-60 transition-colors"
    >
      {pending ? "Ending…" : "End impersonation"}
    </button>
  );
}
