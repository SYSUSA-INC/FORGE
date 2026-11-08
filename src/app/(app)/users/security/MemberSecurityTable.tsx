"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { resetMemberSecondStepAction } from "./actions";

export type MemberSecurityView = {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isSuperadmin: boolean;
  methods: string;
  setUp: boolean;
  recoveryCodesLeft: number;
  lastSecondStepAt: string | null;
  /** Why this admin can't reset them, or null. */
  blocker: string | null;
};

/** BL-MFA-ADMIN — each member's methods, and Reset second step with a written reason. */
export function MemberSecurityTable({ rows }: { rows: MemberSecurityView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  const [pending, start] = useTransition();

  function reset(userId: string) {
    setError(null);
    start(async () => {
      const res = await resetMemberSecondStepAction({ userId, reason });
      if (!res.ok) return setError(res.error);
      const who = rows.find((r) => r.userId === userId);
      setNote(res.warning ? { text: res.warning, warn: true } : { text: `Reset done. ${who?.name ?? "They"} got an email with your reason and sets two-step sign-in up again at the next sign-in.`, warn: false });
      setOpen(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Panel title="Members" eyebrow={`${rows.length} ${rows.length === 1 ? "person" : "people"}`}>
      {note ? <p className={`mb-3 rounded-md border px-3 py-2 font-body text-[13px] text-text ${note.warn ? "border-brass/40 bg-brass/10" : "border-green/40 bg-green/10"}`}>{note.text}</p> : null}
      <ul className="flex flex-col divide-y divide-layer/10">
        {rows.map((r) => (
          <li key={r.userId} className="py-2.5">
            <div className="grid grid-cols-1 gap-1 md:grid-cols-[minmax(0,1fr)_11rem_9rem_10rem] md:items-center md:gap-3">
              <div className="min-w-0">
                <p className="truncate font-body text-[14px] text-text">
                  {r.name}
                  {r.isSuperadmin ? <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-indigo">Platform admin</span> : null}
                  {r.status !== "active" ? <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-muted">{r.status}</span> : null}
                </p>
                <p className="truncate font-mono text-[11px] text-muted">
                  {r.email} · {r.role}
                </p>
              </div>
              <span className={`font-mono text-[11px] ${r.setUp ? "text-text" : "text-brass"}`}>{r.methods}</span>
              <span className="font-mono text-[11px] text-muted">{r.setUp ? `${r.recoveryCodesLeft} recovery code${r.recoveryCodesLeft === 1 ? "" : "s"}` : "—"}</span>
              <div className="md:text-right">
                {r.blocker ? (
                  <span className="font-mono text-[10px] text-subtle" title={r.blocker}>
                    {r.lastSecondStepAt ? `Last in ${r.lastSecondStepAt.slice(0, 10)}` : "—"}
                  </span>
                ) : (
                  <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={() => { setOpen(open === r.userId ? null : r.userId); setReason(""); setError(null); setNote(null); }}>
                    Reset second step
                  </button>
                )}
              </div>
            </div>
            {open === r.userId ? (
              <div className="mt-2 flex flex-col gap-2 border-t border-layer/10 py-3">
                <p className="font-body text-[12px] leading-[1.5] text-muted">
                  This removes {r.name}&apos;s passkeys, authenticator apps and recovery codes and signs them out everywhere. Their password stays; they set two-step sign-in up again at their next sign-in. Confirm who they are first (a call to them or their manager, not an email thread alone). Your reason is emailed to them and kept in the Audit Log.
                </p>
                <textarea className="aur-input min-h-[60px]" placeholder="Why, e.g. Lost phone; confirmed by phone call with their manager" value={reason} onChange={(e) => setReason(e.target.value)} />
                {error ? <p className="font-body text-[12px] text-red">{error}</p> : null}
                <div className="flex gap-2">
                  <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => reset(r.userId)}>
                    {pending ? "Resetting…" : "Reset second step"}
                  </button>
                  <button type="button" className="aur-link" disabled={pending} onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
