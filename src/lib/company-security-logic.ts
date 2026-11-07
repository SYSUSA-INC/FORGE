/**
 * BL-MFA-ADMIN — a company admin's view of their members' two-step
 * sign-in (owner, 2026-11-07: required for everyone, admins see who has
 * set up what and can reset a member who lost their device). Pure.
 */
export type MemberSecurityInput = {
  userId: string;
  isSuperadmin: boolean;
  status: string;
  passkeys: number;
  apps: number;
  enrolled: boolean;
  /** Active memberships in other companies. */
  otherWorkspaces: number;
};

export type MemberSecurityState = "set_up" | "not_set_up";

/** "set_up" once any method is confirmed. */
export function memberState(m: Pick<MemberSecurityInput, "passkeys" | "apps" | "enrolled">): MemberSecurityState {
  return m.enrolled && m.passkeys + m.apps > 0 ? "set_up" : "not_set_up";
}

/** The methods a member holds, in words ("Passkey ×2 · App"), or "Not set up yet". */
export function methodsLabel(m: Pick<MemberSecurityInput, "passkeys" | "apps" | "enrolled">): string {
  if (memberState(m) === "not_set_up") return "Not set up yet";
  const part = (n: number, word: string) => (n === 0 ? null : n === 1 ? word : `${word} ×${n}`);
  return [part(m.passkeys, "Passkey"), part(m.apps, "App")].filter(Boolean).join(" · ");
}

/**
 * Whether a company admin may reset this member's second step, or why
 * not. Never yourself (Settings → Security does that), never a platform
 * administrator, never someone who also belongs to another company (a
 * reset weakens their account everywhere: a platform administrator does
 * it), only an active member, and only once something is set up.
 */
export function companyResetBlocker(actorId: string, m: MemberSecurityInput): string | null {
  if (m.userId === actorId) return "Reset your own from Settings → Security.";
  if (m.isSuperadmin) return "A platform administrator's sign-in is reset by another platform administrator.";
  if (m.status !== "active") return "Only active members can be reset.";
  if (m.otherWorkspaces > 0) return "They also belong to another company: ask a platform administrator.";
  if (memberState(m) === "not_set_up") return "Nothing to reset: they set it up at their next sign-in.";
  return null;
}
