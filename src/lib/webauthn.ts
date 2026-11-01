/**
 * BL-STAB-8a-3 — the relying party a passkey is bound to, from the
 * environment: the app's origin and its registrable domain. Pure.
 */
import { appBaseUrl } from "@/lib/app-url";

export const WEBAUTHN_RP_NAME = "FORGE";
/** A registration or sign-in challenge is good for this long. */
export const WEBAUTHN_CHALLENGE_MS = 5 * 60 * 1000;

export type WebAuthnConfig = { rpID: string; rpName: string; origin: string };

/** The host of the app's origin, or an explicit `WEBAUTHN_RP_ID` (a parent domain shared by previews). */
export function webauthnConfig(env: Record<string, string | undefined> = process.env): WebAuthnConfig {
  const origin = (env.WEBAUTHN_ORIGIN ?? appBaseUrl(env)).replace(/\/+$/, "");
  let host = "localhost";
  try {
    host = new URL(origin).hostname;
  } catch {
    // keep localhost
  }
  const rpID = (env.WEBAUTHN_RP_ID ?? "").trim() || host;
  return { rpID, rpName: WEBAUTHN_RP_NAME, origin };
}

/** The origins a response may come from: the configured one, and localhost for a local run. */
export function expectedOrigins(cfg: WebAuthnConfig): string[] {
  const out = new Set<string>([cfg.origin]);
  if (cfg.rpID === "localhost") out.add("http://localhost:3000");
  return [...out];
}
