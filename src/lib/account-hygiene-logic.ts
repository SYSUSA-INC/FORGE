/**
 * BL-AUTH-ABUSE Slice 1 — the pure half of keeping bot and spam accounts
 * out of FORGE and cleaning up the ones that got in.
 *
 *   names       — what a person's name may look like at sign-up
 *   email       — disposable-mailbox domains refused for self-service
 *   bot signals — the sign-up form's honeypot and fill time
 *   purge rule  — which unverified accounts are safe to remove in bulk
 *
 * No I/O; tested in tests/ai/account-hygiene-logic.test.ts.
 */

// ── Names ────────────────────────────────────────────────────────────

export const NAME_LIMITS = { min: 2, max: 80, tokenMax: 30, caseFlipsMax: 2, consonantRunMax: 6 } as const;

/** Trim, collapse inner whitespace, NFC-normalise. */
export function normalizePersonName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

// Letters (any script) and combining marks, then letters, marks, spaces,
// apostrophes (straight or curly), hyphens, periods and commas. No digits,
// "@", "/", ":", emoji or control characters — so no emails, URLs or
// phone numbers can ride in a name.
const NAME_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M}'’ .,-]*$/u;

function countCaseFlips(token: string): number {
  let flips = 0;
  for (let i = 1; i < token.length; i++) {
    const prev = token[i - 1]!;
    const cur = token[i]!;
    if (prev !== prev.toUpperCase() && cur !== cur.toLowerCase()) flips++;
  }
  return flips;
}

function longestConsonantRun(token: string): number {
  // Only meaningful for Latin letters; other scripts are skipped.
  let best = 0;
  let run = 0;
  for (const ch of token.toLowerCase()) {
    if (/[bcdfghjklmnpqrstvwxz]/.test(ch)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Whether a sign-up name looks like a person's. Generous on real names
 * (any script, hyphens, apostrophes, particles, "McDonald", "VanDerBerg")
 * and strict on what bots send: digits, links, addresses, keyboard mash
 * ("xKjQwPzLm") and very long single tokens.
 */
export function validatePersonName(raw: unknown): NameCheck {
  const name = normalizePersonName(raw);
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length < NAME_LIMITS.min || name.length > NAME_LIMITS.max) {
    return { ok: false, error: `Your name must be ${NAME_LIMITS.min}–${NAME_LIMITS.max} characters.` };
  }
  if (!NAME_SHAPE.test(name)) {
    return { ok: false, error: "Use letters, spaces, hyphens and apostrophes only — no numbers, links or email addresses." };
  }
  const letters = name.match(/[\p{L}]/gu)?.length ?? 0;
  if (letters < NAME_LIMITS.min) return { ok: false, error: "Enter your name." };
  // "word.word" is a domain, not a name (initials like "J.R.R." have one letter a side).
  if (/[\p{L}]{2,}\.[\p{L}]{2,}/u.test(name)) {
    return { ok: false, error: "Use letters, spaces, hyphens and apostrophes only — no numbers, links or email addresses." };
  }
  for (const token of name.split(/[ .,-]+/).filter(Boolean)) {
    if (
      token.length > NAME_LIMITS.tokenMax ||
      countCaseFlips(token) > NAME_LIMITS.caseFlipsMax ||
      longestConsonantRun(token) > NAME_LIMITS.consonantRunMax
    ) {
      return { ok: false, error: "That doesn't look like a person's name. Enter the name you go by at work." };
    }
  }
  return { ok: true, name };
}

// ── Disposable mailboxes ─────────────────────────────────────────────

/**
 * Throwaway-inbox providers. Self-service sign-up refuses them; the list
 * is deliberately short and well-known — it raises the bar for bots, it
 * is not an exhaustive filter.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "10minutemail.com",
  "20minutemail.com",
  "33mail.com",
  "anonaddy.me",
  "burnermail.io",
  "discard.email",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxkitten.com",
  "mail.tm",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mailpoof.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "nada.email",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "tmpmail.org",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.net",
];

const DISPOSABLE_SET = new Set(DISPOSABLE_EMAIL_DOMAINS);

/** True for a known throwaway provider or any subdomain of one. */
export function isDisposableEmailDomain(domain: string | null | undefined): boolean {
  const d = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!d) return false;
  const parts = d.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_SET.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

// ── Bot signals on the sign-up form ──────────────────────────────────

/** A person needs at least this long to fill in name, email and two passwords. */
export const MIN_FORM_FILL_MS = 2500;

/** The hidden field the form renders and people never see or fill. */
export const HONEYPOT_FIELD = "companyUrl";

export type BotSignal = "honeypot" | "too_fast" | "no_timing";

/**
 * What the self-service sign-up request says about who sent it: the
 * honeypot filled, the form submitted faster than a person types, or no
 * fill time at all (a script posting straight to the endpoint).
 */
export function signupBotSignal(input: { honeypot: unknown; elapsedMs: unknown }): BotSignal | null {
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") return "honeypot";
  if (typeof input.elapsedMs !== "number" || !Number.isFinite(input.elapsedMs)) return "no_timing";
  if (input.elapsedMs < MIN_FORM_FILL_MS) return "too_fast";
  return null;
}

// ── Purging unverified sign-ups ──────────────────────────────────────

export const PURGE_LIMITS = { daysMin: 1, daysMax: 365, daysDefault: 7, batchMax: 500 } as const;

export type PurgeUser = { id: string; verified: boolean; isSuperadmin: boolean; createdAt: Date };
/** `memberCount` is everyone with a membership row in that workspace, any status. */
export type PurgeMembership = { organizationId: string; organizationName: string; memberCount: number };

/**
 * Whether an account may be removed by the bulk purge, and which
 * workspaces go with it. Only accounts that never verified their email,
 * are not platform admins, are older than the cutoff, and whose every
 * workspace has them as its only member (the workspace sign-up created
 * for them). Anyone sharing a workspace with another person is left for
 * a human decision.
 */
export function purgeDecision(
  user: PurgeUser,
  memberships: PurgeMembership[],
  cutoff: Date,
): { eligible: false; reason: "verified" | "superadmin" | "too_recent" | "shared_workspace" } | { eligible: true; workspaces: { id: string; name: string }[] } {
  if (user.verified) return { eligible: false, reason: "verified" };
  if (user.isSuperadmin) return { eligible: false, reason: "superadmin" };
  if (user.createdAt.getTime() > cutoff.getTime()) return { eligible: false, reason: "too_recent" };
  if (memberships.some((m) => m.memberCount > 1)) return { eligible: false, reason: "shared_workspace" };
  return { eligible: true, workspaces: memberships.map((m) => ({ id: m.organizationId, name: m.organizationName })) };
}

/** Whole days inside the limits, else the default. */
export function sanitizePurgeDays(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= PURGE_LIMITS.daysMin && raw <= PURGE_LIMITS.daysMax ? raw : PURGE_LIMITS.daysDefault;
}

// ── Deleting one account ─────────────────────────────────────────────

export type DeletionMembership = {
  organizationId: string;
  organizationName: string;
  role: string;
  status: string;
  /** Active members of the workspace, this person included when active. */
  activeMembers: number;
  /** Active admins of the workspace, this person included when an active admin. */
  activeAdmins: number;
  /** Everyone with a membership row there, any status, this person included. */
  totalMembers: number;
};

/**
 * Why an account may not be deleted, or null when it may. Never yourself,
 * never a platform admin (revoke first), never the last active admin of a
 * workspace that still has other people in it (transfer ownership first).
 */
export function deletionBlocker(input: {
  targetId: string;
  actorId: string;
  isSuperadmin: boolean;
  memberships: DeletionMembership[];
}): string | null {
  if (input.targetId === input.actorId) return "You cannot delete your own account.";
  if (input.isSuperadmin) return "Revoke superadmin before deleting this account.";
  const stranded = input.memberships.filter(
    (m) => m.status === "active" && m.role === "admin" && m.activeAdmins <= 1 && m.activeMembers > 1,
  );
  if (stranded.length > 0) {
    return `They are the only admin of ${stranded.map((m) => m.organizationName).join(", ")}, which has other members. Make someone else an admin there first.`;
  }
  return null;
}

/** Workspaces nobody else belongs to — deleted with the account when the admin says so. */
export function soleWorkspaces(memberships: DeletionMembership[]): { id: string; name: string }[] {
  return memberships.filter((m) => m.totalMembers <= 1).map((m) => ({ id: m.organizationId, name: m.organizationName }));
}
