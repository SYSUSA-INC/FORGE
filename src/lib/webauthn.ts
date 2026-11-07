/**
 * BL-STAB-8a-3 — the relying party a passkey is bound to. Pure.
 *
 * BL-MFA-RECOVERY — from the address the person is on, not from one
 * configured value: a passkey works only on the domain it was made on, so
 * a site reachable at www.forgeaxi.com and forgeaxi.com (or moved to a
 * new domain) must ask for the passkeys of the address in the browser.
 * The host is taken only when it is one of the site's own addresses
 * (`allowedHosts`), never from an arbitrary Host header; anything else
 * falls back to the configured app URL.
 */
import { appBaseUrl } from "@/lib/app-url";

export const WEBAUTHN_RP_NAME = "FORGE";
/** A registration or sign-in challenge is good for this long. */
export const WEBAUTHN_CHALLENGE_MS = 5 * 60 * 1000;

export type WebAuthnConfig = { rpID: string; rpName: string; origin: string };

type Env = Record<string, string | undefined>;

function hostnameOf(urlOrHost: string | undefined): string | null {
  const v = (urlOrHost ?? "").trim().toLowerCase();
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).hostname || null;
  } catch {
    return null;
  }
}

/** The www / bare twin of a host ("www.forgeaxi.com" ⇄ "forgeaxi.com"); null for localhost and IPs. */
function twinOf(host: string): string | null {
  if (host === "localhost" || /^[\d.]+$/.test(host) || !host.includes(".")) return null;
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

/**
 * The site's own addresses: the app URL's host and its www / bare twin,
 * the Vercel production domain, this deployment's Vercel URLs, any listed
 * in `WEBAUTHN_EXTRA_HOSTS` (comma-separated), and localhost.
 */
export function allowedHosts(env: Env = process.env): string[] {
  const out = new Set<string>(["localhost"]);
  const add = (h: string | null) => {
    if (!h) return;
    out.add(h);
    const t = twinOf(h);
    if (t) out.add(t);
  };
  add(hostnameOf(appBaseUrl(env)));
  add(hostnameOf(env.WEBAUTHN_ORIGIN));
  add(hostnameOf(env.VERCEL_PROJECT_PRODUCTION_URL));
  for (const h of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const n = hostnameOf(h);
    if (n) out.add(n);
  }
  for (const h of (env.WEBAUTHN_EXTRA_HOSTS ?? "").split(",")) add(hostnameOf(h));
  return [...out];
}

/** The configured relying party: `WEBAUTHN_ORIGIN`, else the app URL; `WEBAUTHN_RP_ID` overrides the id. */
export function webauthnConfig(env: Env = process.env): WebAuthnConfig {
  const origin = (env.WEBAUTHN_ORIGIN ?? appBaseUrl(env)).replace(/\/+$/, "");
  const host = hostnameOf(origin) ?? "localhost";
  const rpID = (env.WEBAUTHN_RP_ID ?? "").trim().toLowerCase() || host;
  return { rpID, rpName: WEBAUTHN_RP_NAME, origin };
}

/**
 * The relying party for a request arriving at `requestHost` (the Host
 * header, port included): that host when it is one of the site's own
 * addresses, else the configured one. `WEBAUTHN_RP_ID`, when the host is
 * it or under it, stays the id (a parent domain shared by subdomains).
 */
export function webauthnConfigFor(requestHost: string | null | undefined, env: Env = process.env): WebAuthnConfig {
  const raw = (requestHost ?? "").trim().toLowerCase();
  const host = hostnameOf(raw);
  if (!host || !allowedHosts(env).includes(host)) return webauthnConfig(env);
  const parent = (env.WEBAUTHN_RP_ID ?? "").trim().toLowerCase();
  const rpID = parent && (host === parent || host.endsWith(`.${parent}`)) ? parent : host;
  const origin = host === "localhost" ? `http://${raw}` : `https://${host}`;
  return { rpID, rpName: WEBAUTHN_RP_NAME, origin };
}

/** The origins a response may come from: the relying party's, and localhost:3000 for a local run. */
export function expectedOrigins(cfg: WebAuthnConfig): string[] {
  const out = new Set<string>([cfg.origin]);
  if (cfg.rpID === "localhost") out.add("http://localhost:3000");
  return [...out];
}

/** Whether a passkey made on `rpId` can be used at the relying party `cfg` (older passkeys have no record: tried). */
export function passkeyUsableAt(rpId: string | null, cfg: WebAuthnConfig): boolean {
  return rpId === null || rpId === cfg.rpID;
}
