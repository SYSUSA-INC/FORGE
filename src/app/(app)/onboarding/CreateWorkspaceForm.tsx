"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWorkspaceForSelfAction } from "@/app/(app)/admin/workspace-actions";

/**
 * BL-QC-links — one-step workspace for a platform administrator who has
 * none. Shown on /onboarding to superadmins only; the action re-checks.
 */
export function CreateWorkspaceForm({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createWorkspaceForSelfAction({ name });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // The session re-reads membership on the next request, so the
      // Command Center resolves the new workspace immediately.
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-muted">
        Workspace name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
          autoComplete="organization"
          className="aur-input max-w-md font-body text-[13px] normal-case tracking-normal"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create my workspace"}
        </button>
        <span className="font-body text-[12px] text-muted">
          You become its admin. Everything in the side menu starts working on the next page load.
        </span>
      </div>
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
    </div>
  );
}
