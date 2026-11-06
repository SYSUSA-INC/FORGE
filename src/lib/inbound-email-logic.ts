/**
 * BL-SCOUT-INBOX — a company's bid email address, pure parts (owner,
 * 2026-11-06): "Forge should have the capability to ingest these emails
 * directly from the sources without any human in the middle forwarding
 * them". A company registers its FORGE address as the bid-notification
 * email on each portal; the portals mail it directly; the mail lands in
 * FORGE's shared mailbox on the company's Microsoft 365 (Exchange), which
 * FORGE reads through Microsoft Graph (owner, 2026-11-06: Exchange, not a
 * separate mail service). These helpers work on one message: who it was
 * sent to, whether the sender's domain vouched for it (SPF or DKIM), its
 * text, its links and what kind of email it is.
 */
import { z } from "zod";

/** FORGE's inbound mail domain (INBOUND_EMAIL_DOMAIN), or null when receiving isn't set up. */
export function inboundDomain(env: Record<string, string | undefined> = process.env): string | null {
  const d = (env.INBOUND_EMAIL_DOMAIN ?? "").trim().toLowerCase();
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : null;
}

/** A company's local part: its name in letters and digits, then four random characters ("acme-federal-k3q9"). */
export function forgeLocalPart(name: string, random: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  const tail = random.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4).padEnd(4, "0");
  return `${base || "bids"}-${tail}`;
}

/** One email as FORGE stores it (`org/{org}/inbound/{id}.json`), attachments beside it. */
export const inboundMessageSchema = z.object({
  /** The message's Internet Message-ID, or the mailbox's id for it when it has none. */
  messageId: z.string().min(1).max(1000),
  from: z.string().default(""),
  fromName: z.string().default(""),
  /** Every address it was sent to: To, Cc, and the envelope headers Exchange keeps. */
  recipients: z.array(z.string()).default([]),
  subject: z.string().default(""),
  text: z.string().default(""),
  html: z.string().default(""),
  /** ISO time it arrived. */
  date: z.string().default(""),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  attachments: z.array(z.object({ name: z.string(), contentType: z.string(), size: z.number(), storagePath: z.string().default("") })).default([]),
});
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

const ADDRESS = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every address in a header's value ("Name <a@b.c>, d@e.f"), lower case. */
export function addressesIn(value: string): string[] {
  return [...value.matchAll(ADDRESS)].map((m) => m[0]!.toLowerCase());
}

/** Envelope headers Exchange keeps for a message redirected by a mail-flow rule or sent Bcc. */
const ENVELOPE_HEADERS = ["x-ms-exchange-organization-originalenveloperecipients", "x-original-to", "delivered-to", "envelope-to", "to", "cc"];

/** Every address the email was delivered to, envelope recipients first, each once. */
export function recipientsOf(input: { recipients: string[]; headers: { name: string; value: string }[] }): string[] {
  const fromHeaders = ENVELOPE_HEADERS.flatMap((n) => input.headers.filter((h) => h.name.toLowerCase() === n).flatMap((h) => addressesIn(h.value)));
  return [...new Set([...fromHeaders, ...input.recipients.map((a) => a.trim().toLowerCase())].filter((a) => a.includes("@")))];
}

/**
 * The company local part an address names: `acme-k3q9@<inbound domain>`, or
 * `<mailbox>+acme-k3q9@<mailbox domain>` (plus addressing on the shared
 * mailbox); null for any other address.
 */
export function companyLocalPart(address: string, inbound: { domain: string | null; mailbox: string | null }): string | null {
  const a = address.trim().toLowerCase().replace(/^<|>$/g, "");
  const at = a.lastIndexOf("@");
  if (at < 1) return null;
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (inbound.domain && domain === inbound.domain) return local.replace(/\+.*$/, "") || null;
  const mb = inbound.mailbox?.toLowerCase() ?? "";
  const mbAt = mb.lastIndexOf("@");
  if (mbAt > 0 && domain === mb.slice(mbAt + 1) && local.startsWith(`${mb.slice(0, mbAt)}+`)) return local.slice(mbAt + 1) || null;
  return null;
}

export type SenderAuth = { spf: string; dkim: string; authenticated: boolean };

/** SPF from Received-SPF and DKIM from Authentication-Results: passed for the sender's domain, or not. */
export function senderAuth(headers: { Name: string; Value: string }[]): SenderAuth {
  const value = (name: string) => headers.find((h) => h.Name.toLowerCase() === name)?.Value ?? "";
  const spf = (/^\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i.exec(value("received-spf"))?.[1] ?? "").toLowerCase();
  const dkim = (/\bdkim=(pass|fail|neutral|none|policy|temperror|permerror)\b/i.exec(value("authentication-results"))?.[1] ?? "").toLowerCase();
  return { spf, dkim, authenticated: spf === "pass" || dkim === "pass" };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** An HTML body as plain text: blocks become lines, tags and scripts go, entities are read. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** The email's text: the text part, else its HTML read as text. */
export function emailText(p: { text: string; html: string }): string {
  return (p.text || "").trim() || htmlToText(p.html || "");
}

/** The web links in an email (href targets and bare URLs), first 30, each once. */
export function emailLinks(p: { text: string; html: string }): string[] {
  const found: string[] = [];
  for (const m of (p.html || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.push(m[1]!);
  for (const m of `${p.text || ""}\n${htmlToText(p.html || "")}`.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) found.push(m[0]!);
  const ok = found.map((l) => l.trim().replace(/&amp;/g, "&").replace(/[.,;:]+$/, "")).filter((l) => /^https?:\/\//i.test(l));
  return [...new Set(ok)].slice(0, 30);
}

export type InboundKind = "bid_alert" | "account" | "other";

const BID = /\b(solicitation|bid|bids|rfp|rfq|rfi|ifb|itb|sources sought|opportunit(?:y|ies)|procurement|tender|quote request|request for (?:proposal|quote|quotation|information)|addend(?:um|a)|amendment|due date|closing date)\b/i;
const ACCOUNT = /\b(verify|verification|confirm (?:your )?(?:email|account|registration)|activate|activation|password|reset|registration (?:complete|received|confirmed)|welcome to|your account|log ?in code|one-time code)\b/i;

/**
 * A first reading of what an email is: a bid alert, a portal account
 * email (registration, verification, password: an admin acts on it), or
 * something else. Phase 2's AI reading decides the bids themselves.
 */
export function classifyInbound(subject: string, text: string): InboundKind {
  const head = `${subject}\n${text.slice(0, 3000)}`;
  if (ACCOUNT.test(subject) || (ACCOUNT.test(head) && !BID.test(subject))) return "account";
  if (BID.test(head)) return "bid_alert";
  return "other";
}

/** The shared mailbox FORGE reads (INBOUND_MAILBOX, e.g. bids@forgeaxi.com), or null. */
export function inboundMailbox(env: Record<string, string | undefined> = process.env): string | null {
  const m = (env.INBOUND_MAILBOX ?? "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(m) ? m : null;
}

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string; mailbox: string };

/** FORGE's Microsoft Graph app registration and mailbox, or null until all four are set. */
export function graphConfig(env: Record<string, string | undefined> = process.env): GraphConfig | null {
  const tenantId = (env.MS_GRAPH_TENANT_ID ?? "").trim();
  const clientId = (env.MS_GRAPH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.MS_GRAPH_CLIENT_SECRET ?? "").trim();
  const mailbox = inboundMailbox(env);
  return tenantId && clientId && clientSecret && mailbox ? { tenantId, clientId, clientSecret, mailbox } : null;
}

/** Receiving is set up: the company addresses' domain, and the mailbox they arrive in through Graph. */
export function receivingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return inboundDomain(env) !== null && graphConfig(env) !== null;
}
