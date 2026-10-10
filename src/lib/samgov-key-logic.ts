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

export function saveFailedMessage(keptLast4: string | null): string {
  const keep = keptLast4 ? ` Your current key (${maskLast4(keptLast4)}) is still in use.` : "";
  return `SAM.gov accepted the key, but FORGE couldn't save it just now, so nothing was saved. Try again in a few minutes.${keep}`;
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

/**
 * BL-STAB-7d — the line SAM.gov pages show when the company's key holds
 * up SAM.gov work (none usable, or SAM.gov rejected, refused or rate-
 * limited its own key); null when nothing does.
 */
export function samKeyNotice(
  v: { inUse: "company" | "platform" | "none"; company: null | { status: string; statusAt: Date | string; readable: boolean } },
  now = Date.now(),
): { tone: "rose" | "gold"; text: string } | null {
  if (v.inUse === "none") {
    return {
      tone: "rose",
      text: v.company
        ? "Your company's SAM.gov key can't be read on this FORGE server and there is no shared key, so SAM.gov searches (Import and the scout's) and the daily Q&A check are off; the scout still checks your watchlist. FORGE support can restore it."
        : "SAM.gov isn't connected for your company, so SAM.gov searches (Import and the scout's) and the daily Q&A check are off; the scout still checks your watchlist. A company admin can add your SAM.gov API key under Settings → Integrations.",
    };
  }
  const c = v.inUse === "company" ? v.company : null;
  if (!c) return null;
  const at = new Date(c.statusAt);
  const on = at.toISOString().slice(0, 10);
  if (c.status === "invalid") {
    return {
      tone: "rose",
      text: `SAM.gov rejected your company's SAM.gov API key on ${on}: it is invalid or expired. SAM.gov searches fail and the daily Q&A check is paused until a company admin replaces it under Settings → Integrations.`,
    };
  }
  if (c.status === "forbidden") {
    return {
      tone: "gold",
      text: `SAM.gov refused a request for your company's SAM.gov API key on ${on}: the key isn't allowed to use part of SAM.gov. A company admin can check its access on SAM.gov or replace it under Settings → Integrations.`,
    };
  }
  if (c.status === "rate_limited" && now - at.getTime() < 86_400_000) {
    return { tone: "gold", text: `Your company's SAM.gov API key reached SAM.gov's request limit on ${on}; SAM.gov searches may fail until SAM.gov's daily reset.` };
  }
  return null;
}
