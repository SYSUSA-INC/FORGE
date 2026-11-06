/**
 * BL-SCOUT-INBOX — a company's bid email address, pure parts (owner,
 * 2026-11-06): "Forge should have the capability to ingest these emails
 * directly from the sources without any human in the middle forwarding
 * them". A company registers its FORGE address as the bid-notification
 * email on each portal; the portals mail it directly; FORGE receives the
 * mail through Postmark's inbound webhook. These helpers read Postmark's
 * payload: who it was sent to, whether the sender's domain vouched for it
 * (SPF or DKIM), its text, its links and what kind of email it is.
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

/** An address split at the last @, lower case, any "+tag" dropped from the local part. */
export function splitAddress(address: string): { local: string; domain: string } | null {
  const a = address.trim().toLowerCase().replace(/^<|>$/g, "");
  const at = a.lastIndexOf("@");
  if (at < 1 || at === a.length - 1) return null;
  return { local: a.slice(0, at).replace(/\+.*$/, ""), domain: a.slice(at + 1) };
}

const contact = z.object({ Email: z.string().optional().default(""), Name: z.string().optional().default("") }).passthrough();

/** What FORGE reads of Postmark's inbound payload; anything else is kept, in storage, as received. */
export const postmarkInboundSchema = z
  .object({
    MessageID: z.string().min(1).max(500),
    From: z.string().optional().default(""),
    FromName: z.string().optional().default(""),
    FromFull: contact.optional(),
    OriginalRecipient: z.string().optional().default(""),
    ToFull: z.array(contact).optional().default([]),
    CcFull: z.array(contact).optional().default([]),
    BccFull: z.array(contact).optional().default([]),
    Subject: z.string().optional().default(""),
    TextBody: z.string().optional().default(""),
    HtmlBody: z.string().optional().default(""),
    Date: z.string().optional().default(""),
    Headers: z.array(z.object({ Name: z.string(), Value: z.string() }).passthrough()).optional().default([]),
    Attachments: z
      .array(z.object({ Name: z.string().optional().default("attachment"), ContentType: z.string().optional().default(""), ContentLength: z.number().optional().default(0) }).passthrough())
      .optional()
      .default([]),
  })
  .passthrough();
export type PostmarkInbound = z.infer<typeof postmarkInboundSchema>;

/** Every address the email was delivered to, the original recipient first. */
export function recipientsOf(p: PostmarkInbound): string[] {
  const all = [p.OriginalRecipient, ...[...p.ToFull, ...p.CcFull, ...p.BccFull].map((c) => c.Email)].map((a) => (a ?? "").trim().toLowerCase()).filter((a) => a.includes("@"));
  return [...new Set(all)];
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
export function emailText(p: Pick<PostmarkInbound, "TextBody" | "HtmlBody">): string {
  return (p.TextBody || "").trim() || htmlToText(p.HtmlBody || "");
}

/** The web links in an email (href targets and bare URLs), first 30, each once. */
export function emailLinks(p: Pick<PostmarkInbound, "TextBody" | "HtmlBody">): string[] {
  const found: string[] = [];
  for (const m of (p.HtmlBody || "").matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.push(m[1]!);
  for (const m of `${p.TextBody || ""}\n${htmlToText(p.HtmlBody || "")}`.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) found.push(m[0]!);
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
