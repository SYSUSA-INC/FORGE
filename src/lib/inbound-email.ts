/**
 * BL-SCOUT-INBOX — a company's bid email address, server side.
 *
 * `receiveInboundMessage` files one email read from FORGE's shared
 * mailbox (src/lib/inbound-graph.ts): it finds the company the email was
 * sent to by its address (`<company>@INBOUND_EMAIL_DOMAIN`, or plus
 * addressing on the mailbox), keeps the message and its attachments in
 * that company's storage, and records the email once (its Internet
 * Message-ID): sender, sender authentication, text preview, links,
 * attachments' names and a first reading of its kind. Mail for an
 * address FORGE doesn't know is left unrouted. The other functions read
 * and create a company's address; callers own auth. Server-only.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { inboundAddresses, inboundEmails, organizations, type InboundEmail } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import {
  classifyInbound,
  companyLocalPart,
  emailLinks,
  emailText,
  forgeLocalPart,
  inboundDomain,
  inboundMailbox,
  receivingConfigured,
  recipientsOf,
  senderAuth,
  type InboundMessage,
} from "@/lib/inbound-email-logic";
import { queueInboundRead } from "@/lib/inbound-bids";
import { log } from "@/lib/log";
import { getStorageProvider } from "@/lib/storage";

export type ReceiveResult =
  | { status: "stored"; organizationId: string; emailId: string }
  | { status: "duplicate"; organizationId: string }
  | { status: "unrouted"; reason: string };

export type InboundFile = { name: string; contentType: string; bytes: Uint8Array };

const PROVIDER = "exchange";

/** File one email under the company it was sent to. Never throws for a message it can't route. */
export async function receiveInboundMessage(msg: Omit<InboundMessage, "attachments">, files: InboundFile[]): Promise<ReceiveResult> {
  const domain = inboundDomain();
  const mailbox = inboundMailbox();
  if (!domain) return { status: "unrouted", reason: "INBOUND_EMAIL_DOMAIN is not set" };
  // The first recipient that names a live company address.
  let address: { id: string; organizationId: string; to: string } | null = null;
  for (const r of recipientsOf(msg)) {
    const local = companyLocalPart(r, { domain, mailbox });
    if (!local) continue;
    const [row] = await db
      .select({ id: inboundAddresses.id, organizationId: inboundAddresses.organizationId })
      .from(inboundAddresses)
      .where(and(eq(inboundAddresses.localPart, local), eq(inboundAddresses.domain, ""), isNull(inboundAddresses.disabledAt)))
      .limit(1);
    if (row) {
      address = { ...row, to: `${local}@${domain}` };
      break;
    }
  }
  if (!address) return { status: "unrouted", reason: "no company address among the recipients" };
  const { organizationId } = address;

  const [dup] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.organizationId, organizationId), eq(inboundEmails.provider, PROVIDER), eq(inboundEmails.providerMessageId, msg.messageId)))
    .limit(1);
  if (dup) return { status: "duplicate", organizationId };

  const text = emailText(msg);
  const auth = senderAuth(msg.headers.map((h) => ({ Name: h.name, Value: h.value })));
  const from = msg.from.trim().toLowerCase().slice(0, 320);
  const id = crypto.randomUUID();
  const storage = getStorageProvider();
  // The attachments beside the message, each its own object; the message lists them.
  const attachments: InboundMessage["attachments"] = [];
  for (const [n, f] of files.entries()) {
    const name = (f.name || "attachment").replace(/[\u0000-\u001f/\\]+/g, "_").replace(/^\.+/, "_").slice(0, 150) || "attachment";
    const storagePath = `org/${organizationId}/inbound/${id}/${n}-${name}`;
    await storage.put({ key: storagePath, bytes: f.bytes, contentType: f.contentType || "application/octet-stream" });
    attachments.push({ name, contentType: f.contentType || "application/octet-stream", size: f.bytes.length, storagePath });
  }
  const storagePath = `org/${organizationId}/inbound/${id}.json`;
  const json = new TextEncoder().encode(JSON.stringify({ ...msg, attachments } satisfies InboundMessage));
  await storage.put({ key: storagePath, bytes: json, contentType: "application/json" });
  const rawSize = json.length + attachments.reduce((a, b) => a + b.size, 0);
  const posted = new Date(msg.date);
  const inserted = await db
    .insert(inboundEmails)
    .values({
      id,
      organizationId,
      addressId: address.id,
      provider: PROVIDER,
      providerMessageId: msg.messageId,
      fromAddress: from,
      fromName: msg.fromName.slice(0, 300),
      toAddress: address.to,
      subject: msg.subject.slice(0, 1000),
      textPreview: text.slice(0, 4000),
      links: emailLinks(msg),
      spf: auth.spf,
      dkim: auth.dkim,
      authenticated: auth.authenticated,
      kind: classifyInbound(msg.subject, text),
      status: "received",
      storagePath,
      rawSize,
      attachments: attachments.slice(0, 50).map((a) => ({ name: a.name, contentType: a.contentType.slice(0, 200), size: a.size })),
      receivedAt: Number.isNaN(posted.getTime()) ? new Date() : posted,
    })
    .onConflictDoNothing()
    .returning({ id: inboundEmails.id });
  if (inserted.length === 0) {
    // A second read of the same message won the race: drop this copy's files.
    for (const key of [storagePath, ...attachments.map((a) => a.storagePath)]) await storage.delete(key).catch(() => undefined);
    return { status: "duplicate", organizationId };
  }
  await recordAudit({
    organizationId,
    actor: { userId: null },
    action: "inbound_email.receive",
    resourceType: "inbound_email",
    resourceId: id,
    metadata: { from, authenticated: auth.authenticated, attachments: attachments.length, size: rawSize },
  }).catch((err) => log.warn("[inbound-email]", "audit failed", { organizationId, error: err }));
  // BL-SCOUT-INBOX phase 2 — read its bids in the background (an unverified sender is held there).
  await queueInboundRead(organizationId, id, classifyInbound(msg.subject, text)).catch((err) => log.warn("[inbound-email]", "read not queued", { organizationId, emailId: id, error: err }));
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
  if (!receivingConfigured()) return { ok: false, error: "Receiving email isn't set up on this FORGE yet: a platform admin connects FORGE's Exchange mailbox (ADMIN_MANUAL §3.7)." };
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

export type InboundEmailView = Pick<InboundEmail, "id" | "fromAddress" | "fromName" | "subject" | "kind" | "status" | "authenticated" | "bidsFound" | "links" | "error"> & {
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
    error: r.error,
    links: r.links ?? [],
    receivedAt: r.receivedAt.toISOString(),
    preview: r.textPreview.slice(0, 600),
    attachments: (r.attachments ?? []).length,
  }));
}
