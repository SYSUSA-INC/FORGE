/**
 * BL-SCOUT-INBOX — reading FORGE's shared Exchange mailbox through
 * Microsoft Graph (owner, 2026-11-06: Exchange, not a separate mail
 * service).
 *
 * The portals mail each company's address; Exchange delivers it to one
 * shared mailbox (INBOUND_MAILBOX, e.g. bids@forgeaxi.com). Every couple
 * of minutes the cron route calls `pollInboundMailbox`: FORGE's app
 * registration signs in with its client secret, reads the inbox's unread
 * messages (with their headers, so the sender's SPF and DKIM results come
 * along), downloads each one's file attachments (20 MB each, ten at
 * most), files the message under its company (`receiveInboundMessage`)
 * and marks it read. A message FORGE can't file because of its own error
 * stays unread and is tried on the next run; one for no company address
 * is marked read and left in the mailbox for the platform admin.
 * Cross-tenant by design (a cron worker); each filing is scoped to the
 * company the address names. Server-only.
 */
import "server-only";

import { graphConfig, type GraphConfig, type InboundMessage } from "@/lib/inbound-email-logic";
import { receiveInboundMessage, type InboundFile } from "@/lib/inbound-email";
import { log } from "@/lib/log";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 20_000;
export const GRAPH_LIMITS = { messagesPerRun: 50, attachmentsPerMessage: 10, attachmentBytes: 20 * 1024 * 1024 } as const;

let cachedToken: { value: string; until: number } | null = null;

/** An app-only token for Microsoft Graph (client credentials), kept until a minute before it expires. */
async function graphToken(cfg: GraphConfig): Promise<string> {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new GraphError(`Microsoft sign-in refused FORGE's app: ${body.error ?? res.status}${body.error_description ? ` (${body.error_description.split("\r\n")[0]})` : ""}`);
  cachedToken = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
  return body.access_token;
}

export class GraphError extends Error {}

async function graph<T>(cfg: GraphConfig, path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const token = await graphToken(cfg);
  const res = await fetch(`${GRAPH}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new GraphError(`Microsoft Graph ${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}: ${detail}`);
  }
  if (init.raw) return new Uint8Array(await res.arrayBuffer()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: { name: string; value: string }[];
};
type GraphAttachment = { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean; "@odata.type"?: string };

const mbPath = (cfg: GraphConfig) => `/users/${encodeURIComponent(cfg.mailbox)}`;

/** A Graph message as FORGE stores it (attachments are added by the receiver). */
export function toInboundMessage(m: GraphMessage): Omit<InboundMessage, "attachments"> {
  const addr = (a?: GraphAddress) => (a?.emailAddress?.address ?? "").trim().toLowerCase();
  const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? "") : "";
  const text = m.body?.contentType?.toLowerCase() === "text" ? (m.body.content ?? "") : "";
  return {
    messageId: (m.internetMessageId || m.id).slice(0, 1000),
    from: addr(m.from),
    fromName: (m.from?.emailAddress?.name ?? "").slice(0, 300),
    recipients: [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(addr).filter(Boolean),
    subject: m.subject ?? "",
    text,
    html,
    date: m.receivedDateTime ?? "",
    headers: (m.internetMessageHeaders ?? []).map((h) => ({ name: h.name, value: h.value })),
  };
}

export type PollSummary = { configured: boolean; read: number; stored: number; duplicate: number; unrouted: number; failed: number; error: string | null };

/** Read the mailbox's unread messages and file each under its company. */
export async function pollInboundMailbox(opts: { until?: number } = {}): Promise<PollSummary> {
  const summary: PollSummary = { configured: false, read: 0, stored: 0, duplicate: 0, unrouted: 0, failed: 0, error: null };
  const cfg = graphConfig();
  if (!cfg) return summary;
  summary.configured = true;
  const until = opts.until ?? Date.now() + 240_000;
  let page: { value: GraphMessage[] };
  try {
    const select = "id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,body,internetMessageHeaders";
    page = await graph(cfg, `${mbPath(cfg)}/mailFolders/inbox/messages?$filter=isRead%20eq%20false&$top=${GRAPH_LIMITS.messagesPerRun}&$select=${select}`);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    log.error("[inbound-graph]", "listing the mailbox failed", { error: summary.error });
    return summary;
  }
  for (const m of page.value ?? []) {
    if (Date.now() > until) break;
    summary.read++;
    try {
      const files: InboundFile[] = [];
      if (m.hasAttachments) {
        const list = await graph<{ value: GraphAttachment[] }>(cfg, `${mbPath(cfg)}/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`);
        const wanted = (list.value ?? []).filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && !a.isInline && (a.size ?? 0) <= GRAPH_LIMITS.attachmentBytes);
        for (const a of wanted.slice(0, GRAPH_LIMITS.attachmentsPerMessage)) {
          const bytes = await graph<Uint8Array>(cfg, `${mbPath(cfg)}/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}/$value`, { raw: true });
          files.push({ name: a.name ?? "attachment", contentType: a.contentType ?? "application/octet-stream", bytes });
        }
      }
      const res = await receiveInboundMessage(toInboundMessage(m), files);
      summary[res.status]++;
      if (res.status === "unrouted") log.info("[inbound-graph]", "unrouted", { reason: res.reason, subject: (m.subject ?? "").slice(0, 120) });
      // Filed, already filed, or for no company: done with it.
      await graph(cfg, `${mbPath(cfg)}/messages/${encodeURIComponent(m.id)}`, { method: "PATCH", body: { isRead: true } });
    } catch (err) {
      // Left unread: the next run tries it again.
      summary.failed++;
      log.error("[inbound-graph]", "message not filed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

/** Tests only: forget the cached token. */
export function _resetGraphToken(): void {
  cachedToken = null;
}
