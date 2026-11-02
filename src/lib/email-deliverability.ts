/**
 * BL-STAB-8b-2 — does this domain receive mail? A domain is deliverable
 * when it publishes MX records (and not the "null MX" of RFC 7505), or,
 * with none, an A or AAAA record (RFC 5321 §5.1). The lookup has a
 * three-second budget and the verdict is cached an hour per domain.
 *
 * Fail-open: a timeout, a server failure or a resolver that cannot even
 * resolve the canary domain gives "unknown", and the caller lets the
 * person through (logged). Only a clean "no such domain / no records"
 * answer, with the resolver proven alive, is "undeliverable".
 *
 * The resolver is injectable, so the rule is unit-tested without DNS.
 */
import { promises as dns } from "node:dns";
import { log } from "@/lib/log";

export type DomainVerdict = "deliverable" | "undeliverable" | "unknown";
export type DomainCheck = { verdict: DomainVerdict; reason: string };

export type MxRecord = { exchange: string; priority: number };
export type DnsResolver = {
  resolveMx(domain: string): Promise<MxRecord[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
};

export const DELIVERABILITY_TIMEOUT_MS = 3000;
export const DELIVERABILITY_CACHE_MS = 60 * 60 * 1000;
/** A domain that certainly receives mail: when it does not resolve, the resolver is the problem. */
export const DELIVERABILITY_CANARY = "sysgov.com";

export const UNDELIVERABLE_MESSAGE = "That domain does not receive email. Check the spelling of your address.";
/** What an admin sees on an invite to such a domain: the invite still went. */
export const INVITE_DOMAIN_WARNING = "The domain of that address receives no email (no mail records). The invitation went out anyway; check the spelling with the person, or copy the link and hand it over yourself.";

/** The errors that mean "DNS answered: nothing there". Anything else is DNS trouble. */
const NEGATIVE_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

type Cached = { check: DomainCheck; until: number };
const cache = new Map<string, Cached>();

/** For tests. */
export function clearDeliverabilityCache(): void {
  cache.clear();
}

function codeOf(err: unknown): string {
  return (err as { code?: string } | null)?.code ?? "";
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One lookup: "yes", "no" (a negative answer) or "trouble" (anything else). */
async function lookup(run: () => Promise<unknown[]>, timeoutMs: number): Promise<"yes" | "no" | "trouble"> {
  try {
    const records = await withTimeout(run(), timeoutMs);
    return records.length > 0 ? "yes" : "no";
  } catch (err) {
    return NEGATIVE_CODES.has(codeOf(err)) ? "no" : "trouble";
  }
}

/** The verdict from DNS alone, no cache and no canary. */
export async function resolveDomainDeliverability(domain: string, resolver: DnsResolver, timeoutMs = DELIVERABILITY_TIMEOUT_MS): Promise<DomainCheck> {
  let mx: MxRecord[] | null = null;
  try {
    mx = await withTimeout(resolver.resolveMx(domain), timeoutMs);
  } catch (err) {
    if (!NEGATIVE_CODES.has(codeOf(err))) return { verdict: "unknown", reason: `mx lookup failed: ${codeOf(err) || "error"}` };
  }
  if (mx && mx.length > 0) {
    // RFC 7505 — a single "." exchange says: this domain takes no mail.
    const nullMx = mx.every((r) => r.exchange === "" || r.exchange === ".");
    return nullMx ? { verdict: "undeliverable", reason: "null MX" } : { verdict: "deliverable", reason: "mx" };
  }
  const a = await lookup(() => resolver.resolve4(domain), timeoutMs);
  if (a === "yes") return { verdict: "deliverable", reason: "a record" };
  const aaaa = await lookup(() => resolver.resolve6(domain), timeoutMs);
  if (aaaa === "yes") return { verdict: "deliverable", reason: "aaaa record" };
  if (a === "trouble" || aaaa === "trouble") return { verdict: "unknown", reason: "address lookup failed" };
  return { verdict: "undeliverable", reason: "no mx, a or aaaa records" };
}

const nodeResolver: DnsResolver = {
  resolveMx: (d) => dns.resolveMx(d),
  resolve4: (d) => dns.resolve4(d),
  resolve6: (d) => dns.resolve6(d),
};

/**
 * The cached, canary-checked verdict for a domain. An empty or malformed
 * domain is "undeliverable" at once.
 */
export async function checkDomainDeliverability(
  domainInput: string | null | undefined,
  opts: { resolver?: DnsResolver; now?: () => number; timeoutMs?: number; canary?: string } = {},
): Promise<DomainCheck> {
  const domain = (domainInput ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!domain || !domain.includes(".") || /[^a-z0-9.-]/.test(domain)) return { verdict: "undeliverable", reason: "not a domain" };
  const now = opts.now ?? Date.now;
  const hit = cache.get(domain);
  if (hit && hit.until > now()) return hit.check;

  const resolver = opts.resolver ?? nodeResolver;
  const timeoutMs = opts.timeoutMs ?? DELIVERABILITY_TIMEOUT_MS;
  let check = await resolveDomainDeliverability(domain, resolver, timeoutMs);

  if (check.verdict === "undeliverable") {
    // The resolver must be able to find a domain that certainly exists;
    // otherwise the "no" is the network's, not the domain's.
    const canary = (opts.canary ?? process.env.EMAIL_DELIVERABILITY_CANARY ?? DELIVERABILITY_CANARY).toLowerCase();
    if (canary && canary !== domain) {
      const proof = await resolveDomainDeliverability(canary, resolver, timeoutMs);
      if (proof.verdict !== "deliverable") {
        log.warn("[deliverability]", "resolver cannot find the canary domain: letting the address through", { domain, canary, proof: proof.reason });
        check = { verdict: "unknown", reason: `resolver unproven (${proof.reason})` };
      }
    }
  }

  if (check.verdict !== "unknown") cache.set(domain, { check, until: now() + DELIVERABILITY_CACHE_MS });
  else log.warn("[deliverability]", "no verdict for domain: letting the address through", { domain, reason: check.reason });
  return check;
}

/** True when the address may be refused: the domain certainly receives no mail. */
export async function domainRefusesMail(email: string): Promise<boolean> {
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  return (await checkDomainDeliverability(domain)).verdict === "undeliverable";
}
