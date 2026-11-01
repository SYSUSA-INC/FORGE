/**
 * BL-STAB-8a-2 — the session's rules, pure so the edge middleware and
 * the Node sign-in path apply the same ones: the second step's state,
 * the idle and absolute limits, the pending step's lifetime, when the
 * stored session version is re-read, and where a pending session may go.
 */
export const SESSION_POLICY = {
  /** Signed out after this long without a request. */
  idleMs: 8 * 60 * 60 * 1000,
  /** Signed out this long after signing in, whatever happens. */
  absoluteMs: 24 * 60 * 60 * 1000,
  /** The password step's token dies if the second step takes longer. */
  pendingMs: 10 * 60 * 1000,
  /** How often the session version and epoch are re-read from the store. */
  recheckMs: 60 * 1000,
  /** `lastActive` is rewritten at most this often. */
  touchMs: 60 * 1000,
  /** Wrong codes before the second step locks, and for how long. */
  lockAttempts: 5,
  lockWindowSeconds: 15 * 60,
} as const;

/** ok: in; pending: password done, code owed; enrol: no factor yet, enrol first. */
export type MfaState = "ok" | "pending" | "enrol";

export type SessionClaims = {
  id?: string;
  /** Sign-in time, ms. */
  iatMs?: number;
  lastActive?: number;
  mfa?: MfaState;
  /** How the second step passed: code | recovery | preview | bypass. */
  amr?: string;
  pendingAt?: number;
  /** The user's session version and the platform epoch at sign-in. */
  sv?: number;
  epoch?: number;
  /** When the store was last re-read. */
  chk?: number;
  /** Pending id: the server-side pass marker is keyed by it. */
  pid?: string;
};

export type SessionVerdict = "ok" | "malformed" | "idle_expired" | "absolute_expired" | "pending_expired";

export function evaluateSession(c: SessionClaims, now: number): SessionVerdict {
  if (!c.id || typeof c.iatMs !== "number" || typeof c.lastActive !== "number" || !c.mfa) return "malformed";
  if (now - c.iatMs > SESSION_POLICY.absoluteMs) return "absolute_expired";
  if (now - c.lastActive > SESSION_POLICY.idleMs) return "idle_expired";
  if (c.mfa !== "ok" && (typeof c.pendingAt !== "number" || now - c.pendingAt > SESSION_POLICY.pendingMs)) return "pending_expired";
  return "ok";
}

/** Refresh `lastActive` no more than once a minute (the cookie is rewritten when it changes). */
export function touchSession<T extends SessionClaims>(c: T, now: number): T {
  if (typeof c.lastActive === "number" && now - c.lastActive < SESSION_POLICY.touchMs) return c;
  return { ...c, lastActive: now };
}

export function needsRecheck(c: SessionClaims, now: number): boolean {
  return typeof c.chk !== "number" || now - c.chk >= SESSION_POLICY.recheckMs;
}

/** Why the second step is skipped, when it is. */
export type MfaEnforcement = { on: true } | { on: false; reason: "env_off" | "no_secret_keys" };

export function mfaEnforcement(env: { MFA_ENFORCEMENT?: string; FORGE_SECRET_KEYS?: string }): MfaEnforcement {
  if ((env.MFA_ENFORCEMENT ?? "").trim().toLowerCase() === "off") return { on: false, reason: "env_off" };
  // Without the keyring no secret can be stored, so nobody could enrol:
  // refusing every sign-in would lock the deployment out. Loud instead.
  if (!(env.FORGE_SECRET_KEYS ?? "").trim()) return { on: false, reason: "no_secret_keys" };
  return { on: true };
}

/** The same, read from the process environment. */
export function mfaEnforcementNow(): MfaEnforcement {
  return mfaEnforcement({ MFA_ENFORCEMENT: process.env.MFA_ENFORCEMENT, FORGE_SECRET_KEYS: process.env.FORGE_SECRET_KEYS });
}

/** The preview-only test code, when the deployment is a preview and one is set. */
export function previewBypassCode(env: { VERCEL_ENV?: string; MFA_PREVIEW_BYPASS_CODE?: string }): string | null {
  const code = (env.MFA_PREVIEW_BYPASS_CODE ?? "").trim();
  if (env.VERCEL_ENV !== "preview" || code.length < 8) return null;
  return code;
}

export const GATE_PATHS = { verify: "/sign-in/verify", enrol: "/sign-in/enrol" } as const;

/** Where a pending session is sent for `pathname`; null when it may stay. */
export function gateRedirect(pathname: string, mfa: MfaState | undefined): string | null {
  if (!mfa || mfa === "ok") return null;
  const target = mfa === "enrol" ? GATE_PATHS.enrol : GATE_PATHS.verify;
  if (pathname === target || pathname.startsWith("/api/auth") || pathname.startsWith("/api/error-report")) return null;
  // The two gate pages may call each other (enrolled now → verify; nothing enrolled → enrol).
  if (pathname === GATE_PATHS.verify || pathname === GATE_PATHS.enrol) return target;
  return target;
}
