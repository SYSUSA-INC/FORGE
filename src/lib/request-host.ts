import "server-only";

import { headers } from "next/headers";
import { webauthnConfigFor, type WebAuthnConfig } from "@/lib/webauthn";

/** BL-MFA-RECOVERY — the Host the request arrived at (Vercel's forwarded host first), or null outside a request. */
export function requestHost(): string | null {
  try {
    const h = headers();
    return h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || null;
  } catch {
    return null;
  }
}

/** The passkey relying party for this request: the address in the browser when it is one of the site's own. */
export function passkeyConfigHere(): WebAuthnConfig {
  return webauthnConfigFor(requestHost());
}
