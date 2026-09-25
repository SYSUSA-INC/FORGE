/**
 * BL-AUTH-DOMAIN — domain-scoped tenant membership, the pure parts.
 *
 * Rule: by default a person may only join the tenant that owns their
 * email domain. Each tenant lists the domains it owns plus any external
 * domains a platform admin has approved for it. An invite whose address
 * falls outside both lists is "cross-domain": it is created on hold and
 * becomes usable only once a platform superadmin approves it (or a
 * superadmin issued it, which is the same approval). Tenant admins alone
 * can never add someone from another domain — that is the whole point:
 * one company must not be able to share a tenant with another to save
 * on seats, and nobody can be added to a tenant their employer does not
 * run without the platform noticing.
 *
 * Public mailbox providers can never be tenant domains: a tenant
 * claiming gmail.com would let every Gmail user join by default.
 */

export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "fastmail.com",
  "hey.com",
]);

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lower-cased domain part of an email, or null when malformed. */
export function domainOf(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at <= 0) return null;
  const d = (email ?? "").trim().toLowerCase().slice(at + 1);
  return DOMAIN_RE.test(d) ? d : null;
}

/** Normalise a hand-typed domain (`@Acme.COM ` → `acme.com`); null if invalid. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Parse a comma / whitespace / newline separated list of domains for the
 * tenant-domains editor. Public providers are rejected, not silently
 * dropped, so the admin sees why.
 */
export function parseDomainList(text: string): {
  domains: string[];
  invalid: string[];
  publicProviders: string[];
} {
  const domains: string[] = [];
  const invalid: string[] = [];
  const publicProviders: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const d = normalizeDomain(part);
    if (!d) {
      invalid.push(part);
      continue;
    }
    if (isPublicEmailDomain(d)) {
      publicProviders.push(d);
      continue;
    }
    if (seen.has(d)) continue;
    seen.add(d);
    domains.push(d);
  }
  return { domains, invalid, publicProviders };
}

/** The two lists a tenant carries (`organization.email_domains` and `approved_external_domains`). */
export type TenantDomains = {
  emailDomains: readonly string[];
  approvedExternalDomains: readonly string[];
};

function listHas(list: readonly string[], domain: string): boolean {
  return list.some((d) => d.toLowerCase() === domain);
}

/**
 * May this address join the tenant without a platform admin looking at
 * it? True when the tenant owns the domain or a platform admin approved
 * it as an external domain. A tenant with no domains at all allows
 * nobody by default — the platform admin sets its domains, or approves
 * each invite.
 */
export function tenantAllowsEmail(email: string, tenant: TenantDomains): boolean {
  const d = domainOf(email);
  if (!d) return false;
  return listHas(tenant.emailDomains, d) || listHas(tenant.approvedExternalDomains, d);
}

/** Inverse of tenantAllowsEmail, named for the invite path. */
export function isCrossDomainInvite(email: string, tenant: TenantDomains): boolean {
  return !tenantAllowsEmail(email, tenant);
}

/** Does the tenant own the invitee's domain? Case-insensitive. */
export function domainMatchesTenant(
  email: string,
  tenantDomains: readonly string[],
): boolean {
  const d = domainOf(email);
  if (!d) return false;
  return listHas(tenantDomains, d);
}

/** Human explanation for the invite panel and the approval queue. */
export function crossDomainReason(email: string, tenant: TenantDomains): string {
  const d = domainOf(email) ?? "that address";
  if (tenant.emailDomains.length === 0) {
    return `This workspace has no email domains on file, so every invitation (including ${d}) needs platform-admin approval. Ask the platform admin to set the workspace's domains.`;
  }
  return `${d} is not one of this workspace's domains (${tenant.emailDomains.join(", ")}), so the invitation is held until a platform admin approves it.`;
}

export type ApprovalRow = {
  crossDomain: boolean;
  platformApprovedAt: Date | string | null | undefined;
};

/** A same-domain invite is always usable; a cross-domain one needs the platform stamp. */
export function inviteIsApproved(row: ApprovalRow): boolean {
  if (!row.crossDomain) return true;
  return !!row.platformApprovedAt;
}

/** True when the invite exists but nobody may use it yet. */
export function inviteAwaitsApproval(row: ApprovalRow): boolean {
  return !inviteIsApproved(row);
}
