/**
 * BL-STAB-7b — rules for a company's own SAM.gov key (pure): what a pasted
 * key must look like, and what each answer to the test search on save
 * means. No message ever repeats the key.
 */
import type { SamErrorClass } from "@/lib/samgov-errors";

/** Key tests allowed per hour, per person and per company. */
export const SAM_KEY_TEST_LIMITS = { perUserPerHour: 10, perOrgPerHour: 5 } as const;

const KEY_SHAPE = /^[A-Za-z0-9._-]{20,128}$/;

export function validateSamKeyInput(raw: unknown): { ok: true; key: string } | { ok: false; error: string } {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!KEY_SHAPE.test(key)) {
    return {
      ok: false,
      error: "That doesn't look like a SAM.gov API key. Paste the key exactly as SAM.gov shows it (letters, digits and dashes, no spaces).",
    };
  }
  return { ok: true, key };
}

export function maskLast4(last4: string): string {
  return `••••${last4}`;
}

/**
 * What the test search's answer means for saving: SAM.gov recognised the
 * key (saved, and how it stands), refused it, or couldn't be asked.
 */
export function saveOutcome(
  result: { ok: true } | { ok: false; cls: SamErrorClass; status?: number },
): { save: true; status: "ok" | "rate_limited"; verified: boolean } | { save: false; cls: SamErrorClass } {
  if (result.ok) return { save: true, status: "ok", verified: true };
  // A request limit, or a 400 on FORGE's fixed search, both mean the gateway accepted the key.
  if (result.cls === "rate_limited") return { save: true, status: "rate_limited", verified: false };
  if (result.cls === "bad_request") return { save: true, status: "ok", verified: false };
  return { save: false, cls: result.cls };
}

export function savedMessage(status: "ok" | "rate_limited", last4: string): string {
  return status === "ok"
    ? `Saved. SAM.gov accepted the key (${maskLast4(last4)}); FORGE uses it for your company from now on.`
    : `Saved (${maskLast4(last4)}), but SAM.gov says this key's request limit is used up for now. It will work again when SAM.gov's daily limit resets.`;
}

export function refusedMessage(cls: SamErrorClass, previousLast4: string | null): string {
  const keep = previousLast4 ? ` Your current key (${maskLast4(previousLast4)}) is still in use.` : "";
  if (cls === "key_invalid") return `SAM.gov rejected this key: it is invalid, expired or not yet active. Nothing was saved.${keep}`;
  if (cls === "key_forbidden") return `SAM.gov recognised this key but refused the test search (HTTP 403). Nothing was saved. Check the key's access on SAM.gov.${keep}`;
  return `SAM.gov couldn't be reached to test the key, so nothing was saved. Try again in a few minutes.${keep}`;
}

export const KEYRING_UNAVAILABLE_MESSAGE =
  "Company SAM.gov keys can't be saved on this FORGE server yet. FORGE support has to enable key encryption first.";
export const DATABASE_PENDING_MESSAGE =
  "Company SAM.gov keys aren't available until FORGE's database is updated. Ask FORGE support.";

export function tooManyTestsMessage(who: "company" | "user", retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  const scope = who === "company" ? "for your company" : "from your account";
  return `Too many key tests ${scope} in the last hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
