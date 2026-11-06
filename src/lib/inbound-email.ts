/**
 * BL-SCOUT-INBOX — a company's bid email address, server side.
 *
 * `receivePostmarkEmail` takes one inbound email from Postmark's webhook
 * (the route checked the webhook's credentials): it finds the company the
 * email was sent to by its address on FORGE's inbound domain, keeps the
 * raw payload in that company's storage, and records the email once
 * (Postmark's MessageID): sender, sender authentication, text preview,
 * links, attachments' names and a first reading of its kind. Mail for an
 * address FORGE doesn't know is dropped. The other functions read and
 * create a company's address; callers own auth. Server-only.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { inboundAddresses, inboundEmails, organizations, type InboundEmail } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  classifyInbound,
  emailLinks,
  emailText,
  forgeLocalPart,
  inboundDomain,
  recipientsOf,
  senderAuth,
  splitAddress,
  type PostmarkInbound,
} from "@/lib/inbound-email-logic";
import { log } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";

export type ReceiveResult =
  | { status: "stored"; organizationId: string; emailId: string }
  | { status: "duplicate"; organizationId: string }
  | { status: "unrouted"; reason: string };

/** File one inbound email under the company it was sent to. Never throws for a payload it can't route. */
export async function receivePostmarkEmail(p: PostmarkInbound, rawJson: string): Promise<ReceiveResult> {
  const domain = inboundDomain();
  if (!domain) return { status: "unrouted", reason: "INBOUND_EMAIL_DOMAIN is not set" };
  // The first recipient on FORGE's domain that is a live company address.
  let address: { id: string; organizationId: string; to: string } | null = null;
  for (const r of recipientsOf(p)) {
    const parts = splitAddress(r);
    if (!parts || parts.domain !== domain) continue;
    const [row] = await db
      .select({ id: inboundAddresses.id, organizationId: inboundAddresses.organizationId })
      .from(inboundAddresses)
      .where(and(eq(inboundAddresses.localPart, parts.local), eq(inboundAddresses.domain, ""), isNull(inboundAddresses.disabledAt)))
      .limit(1);
    if (row) {
      address = { ...row, to: `${parts.local}@${domain}` };
      break;
    }
  }
  if (!address) return { status: "unrouted", reason: "no company address among the recipients" };
  const { organizationId } = address;

  const [dup] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.provider, "postmark"), eq(inboundEmails.providerMessageId, p.MessageID)))
    .limit(1);
  if (dup) return { status: "duplicate", organizationId };

  const text = emailText(p);
  const auth = senderAuth(p.Headers);
  const from = (p.FromFull?.Email || p.From || "").trim().toLowerCase().slice(0, 320);
  const id = crypto.randomUUID();
  const storagePath = `org/${organizationId}/inbound/${id}.json`;
  const bytes = new TextEncoder().encode(rawJson);
  await getStorageProvider().put({ key: storagePath, bytes, contentType: "application/json" });
  const posted = new Date(p.Date);
  const inserted = await db
    .insert(inboundEmails)
    .values({
      id,
      organizationId,
      addressId: address.id,
      provider: "postmark",
      providerMessageId: p.MessageID,
      fromAddress: from,
      fromName: (p.FromFull?.Name || p.FromName || "").slice(0, 300),
      toAddress: address.to,
      subject: p.Subject.slice(0, 1000),
      textPreview: text.slice(0, 4000),
      links: emailLinks(p),
      spf: auth.spf,
      dkim: auth.dkim,
      authenticated: auth.authenticated,
      kind: classifyInbound(p.Subject, text),
      status: "received",
      storagePath,
      rawSize: bytes.length,
      attachments: p.Attachments.slice(0, 50).map((a) => ({ name: String(a.Name).slice(0, 300), contentType: String(a.ContentType).slice(0, 200), size: Number(a.ContentLength) || 0 })),
      receivedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    })
    .onConflictDoNothing()
    .returning({ id: inboundEmails.id });
  if (inserted.length === 0) {
    // A retry of the same delivery won the race: drop this copy's file.
    await getStorageProvider().delete(storagePath).catch(() => undefined);
    return { status: "duplicate", organizationId };
  }
  await recordAudit({
    organizationId,
    actor: { userId: null },
    action: "inbound_email.receive",
    resourceType: "inbound_email",
    resourceId: id,
    metadata: { from, authenticated: auth.authenticated, attachments: p.Attachments.length, size: bytes.length },
  }).catch((err) => log.warn("[inbound-email]", "audit failed", { organizationId, error: err }));
  return { status: "stored", organizationId, emailId: id };
}

export type InboundAddressView = { id: string; address: string; createdAt: string };

/** The company's live address on FORGE's domain, or null. */
export async function getInboundAddress(organizationId: string): Promise<InboundAddressView | null> {
  const domain = inboundDomain();
  if (!domain) return null;
  const [row] = await db
    .select({ id: inboundAddresses.id, localPart: inboundAddresses.localPart, createdAt: inboundAddresses.createdAt })
    .from(inboundAddresses)
    .where(and(eq(inboundAddresses.organizationId, organizationId), eq(inboundAddresses.domain, ""), isNull(inboundAddresses.disabledAt)))
    .orderBy(desc(inboundAddresses.createdAt))
    .limit(1);
  return row ? { id: row.id, address: `${row.localPart}@${domain}`, createdAt: row.createdAt.toISOString() } : null;
}

/** Create the company's address (once): its name and four random characters, on FORGE's domain. */
export async function createInboundAddress(input: { organizationId: string; actor: { userId: string; email?: string | null } }): Promise<{ ok: true; address: InboundAddressView } | { ok: false; error: string }> {
  const { organizationId } = input;
  if (!inboundDomain()) return { ok: false, error: "Receiving email isn't set up on this FORGE yet: a platform admin sets INBOUND_EMAIL_DOMAIN and the Postmark inbound webhook (ADMIN_MANUAL §3.7)." };
  const existing = await getInboundAddress(organizationId);
  if (existing) return { ok: true, address: existing };
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  for (let attempt = 0; attempt < 5; attempt++) {
    const localPart = forgeLocalPart(org?.name ?? "", randomBytes(4).toString("hex"));
    const [row] = await db
      .insert(inboundAddresses)
      .values({ organizationId, localPart, domain: "", createdByUserId: input.actor.userId })
      .onConflictDoNothing()
      .returning({ id: inboundAddresses.id });
    if (!row) continue;
    await recordAudit({ organizationId, actor: input.actor, action: "inbound_address.create", resourceType: "inbound_address", resourceId: row.id, metadata: { localPart } });
    const created = await getInboundAddress(organizationId);
    if (created) return { ok: true, address: created };
  }
  return { ok: false, error: "Could not create the address; try again." };
}

export type InboundEmailView = Pick<InboundEmail, "id" | "fromAddress" | "fromName" | "subject" | "kind" | "status" | "authenticated" | "bidsFound" | "links"> & {
  receivedAt: string;
  preview: string;
  attachments: number;
};

/** The company's latest emails, newest first. */
export async function listInboundEmails(organizationId: string, limit = 50): Promise<InboundEmailView[]> {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.organizationId, organizationId))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    fromAddress: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    kind: r.kind,
    status: r.status,
    authenticated: r.authenticated,
    bidsFound: r.bidsFound,
    links: r.links ?? [],
    receivedAt: r.receivedAt.toISOString(),
    preview: r.textPreview.slice(0, 600),
    attachments: (r.attachments ?? []).length,
  }));
}
