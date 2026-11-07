/**
 * BL-DOMAIN-FORGEAXI phase 2 — the names FORGE shows the outside world,
 * from the site's own address rather than hard-coded: the domain mail is
 * sent from and the name an authenticator app shows. With the site at
 * https://www.forgeaxi.com that is "forgeaxi.com", "FORGE
 * <noreply@forgeaxi.com>" and "FORGE (forgeaxi.com)". `EMAIL_FROM` /
 * `EMAIL_FROM_ADDRESS` still override the sender. Pure.
 */
import { appBaseUrl } from "@/lib/app-url";

type Env = Record<string, string | undefined>;

/** The site's domain without "www." ("forgeaxi.com"); "localhost" for a local run. */
export function siteDomain(env: Env = process.env): string {
  try {
    return new URL(appBaseUrl(env)).hostname.toLowerCase().replace(/^www\./, "") || "localhost";
  } catch {
    return "localhost";
  }
}

/** The From header for FORGE's mail: `EMAIL_FROM`, else "FORGE <noreply@<site domain>>". */
export function emailFrom(env: Env = process.env): string {
  return (env.EMAIL_FROM ?? "").trim() || `FORGE <noreply@${siteDomain(env)}>`;
}

/** The bare sender address: `EMAIL_FROM_ADDRESS`, else the address in `EMAIL_FROM`, else noreply@<site domain>. */
export function emailFromAddress(env: Env = process.env): string {
  const explicit = (env.EMAIL_FROM_ADDRESS ?? "").trim();
  if (explicit) return explicit;
  const inFrom = /<([^>]+)>/.exec(env.EMAIL_FROM ?? "")?.[1] ?? ((env.EMAIL_FROM ?? "").includes("@") ? (env.EMAIL_FROM ?? "").trim() : "");
  return inFrom || `noreply@${siteDomain(env)}`;
}

/** The domain mail is sent from, for the admin's checklist ("verify it with Resend"). */
export function emailFromDomain(env: Env = process.env): string {
  return emailFromAddress(env).split("@")[1]?.toLowerCase() ?? siteDomain(env);
}

/** The issuer an authenticator app shows beside the account: "FORGE (forgeaxi.com)". */
export function mfaIssuer(env: Env = process.env): string {
  return `FORGE (${siteDomain(env)})`;
}
