import { mfaEnforcementNow } from "@/lib/session-policy";

/**
 * BL-STAB-8a-2 — shown to everyone while the second step is skipped:
 * the emergency switch (`MFA_ENFORCEMENT=off`) or a deployment with no
 * secret keyring, where nobody could enrol. Server component.
 */
export function MfaOffBanner() {
  const e = mfaEnforcementNow();
  if (e.on) return null;
  const why = e.reason === "env_off" ? "MFA_ENFORCEMENT is off" : "FORGE_SECRET_KEYS is not set";
  return (
    <div role="status" className="sticky top-0 z-40 flex h-6 w-full items-center justify-center gap-2 border-b border-rose/40 bg-rose/10 px-3 font-mono text-[10px] uppercase tracking-label text-rose">
      <span aria-hidden>⚠</span>
      <span>Two-step sign-in is switched off ({why}) · every sign-in is being recorded</span>
    </div>
  );
}
