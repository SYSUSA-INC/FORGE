/**
 * BL-STAB-8b-3 — the rules for a change of address. Pure; unit-tested.
 * A changed address is a new address: it is checked like a sign-up's,
 * and nothing moves until the new inbox clicks its link.
 */
import { isDisposableEmailDomain } from "@/lib/account-hygiene-logic";
import { domainOf } from "@/lib/email-domain";

/** How long the confirmation link, and the pending change, are good for. */
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** The new address, or why it cannot be used (before any lookup). */
export function checkNewEmail(current: string | null | undefined, candidate: unknown): { ok: true; email: string } | { ok: false; error: string } {
  const email = normalizeEmail(candidate);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, error: "Enter a valid email address." };
  if (email === normalizeEmail(current)) return { ok: false, error: "That is already your address." };
  if (isDisposableEmailDomain(domainOf(email))) return { ok: false, error: "Use a work email: disposable inboxes can't be used." };
  return { ok: true, email };
}

/** A pending change is live while its link is: younger than the TTL. */
export function pendingChangeIsLive(pendingEmailAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !!pendingEmailAt && now - pendingEmailAt.getTime() <= EMAIL_CHANGE_TTL_MS;
}
