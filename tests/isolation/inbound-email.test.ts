/**
 * BL-SCOUT-INBOX — FORGE's Exchange mailbox against Postgres, two tenants,
 * Microsoft sign-in and Graph stubbed: the poll reads the unread messages,
 * downloads their attachments, files mail to company A's address for A
 * only (by the bid domain, or plus addressing on the mailbox), once per
 * Internet Message-ID, with its sender check, text, links and kind; it
 * marks each read; mail for no company is marked read and left; a message
 * FORGE fails to file stays unread; the storage meter counts the email and
 * its attachment; with no settings the poll does nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, inboundEmails } from "@/db/schema";
import { _resetGraphToken, pollInboundMailbox } from "@/lib/inbound-graph";
import { createInboundAddress, listInboundEmails } from "@/lib/inbound-email";
import { getStorageBytesUsed } from "@/lib/subscription-gates";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

type Msg = Record<string, unknown> & { id: string };
const message = (id: string, to: string, o: Record<string, unknown> = {}): Msg => ({
  id,
  internetMessageId: `<${id}@eva.virginia.gov>`,
  subject: "New Solicitation: IT Help Desk Services (RFP 26-001)",
  from: { emailAddress: { address: "NoReply@eva.virginia.gov", name: "eVA" } },
  toRecipients: [{ emailAddress: { address: to } }],
  ccRecipients: [],
  receivedDateTime: "2026-11-06T19:00:00Z",
  hasAttachments: false,
  body: { contentType: "html", content: '<p>A new bid was posted. <a href="https://eva.virginia.gov/bid/26-001">View it</a>. Closing date 12/10/2026.</p>' },
  internetMessageHeaders: [{ name: "Authentication-Results", value: "spf=pass smtp.mailfrom=eva.virginia.gov; dkim=pass header.d=eva.virginia.gov" }],
  ...o,
});

/** Microsoft's sign-in and Graph, over a list of unread messages; records what FORGE marked read. */
function stubGraph(inbox: Msg[], opts: { failAttachment?: string } = {}) {
  const marked: string[] = [];
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      const path = new URL(url).pathname;
      if (path.endsWith("/mailFolders/inbox/messages")) return new Response(JSON.stringify({ value: inbox.filter((m) => !marked.includes(m.id)) }), { status: 200 });
      const att = /\/messages\/([^/]+)\/attachments(?:\/([^/]+)\/\$value)?$/.exec(path);
      if (att && att[2]) {
        if (opts.failAttachment === att[1]) return new Response("boom", { status: 503 });
        return new Response("%PDF-1.4 rfp", { status: 200 });
      }
      if (att) return new Response(JSON.stringify({ value: [{ "@odata.type": "#microsoft.graph.fileAttachment", id: "a1", name: "RFP 26-001.pdf", contentType: "application/pdf", size: 12, isInline: false }, { "@odata.type": "#microsoft.graph.fileAttachment", id: "logo", name: "logo.png", contentType: "image/png", size: 5, isInline: true }] }), { status: 200 });
      const patch = /\/messages\/([^/]+)$/.exec(path);
      if (patch && init?.method === "PATCH") {
        marked.push(decodeURIComponent(patch[1]!));
        return new Response(null, { status: 204 });
      }
      return new Response("not stubbed", { status: 404 });
    }),
  );
  return { marked, calls };
}

describe("BL-SCOUT-INBOX — reading FORGE's Exchange mailbox", () => {
  let fx: TwoTenantFixture;
  let address = "";
  beforeEach(async () => {
    fx = await createTwoTenants("inbound");
    _resetGraphToken();
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "bids.forgeaxi.test");
    vi.stubEnv("INBOUND_MAILBOX", "bids@forgeaxi.test");
    vi.stubEnv("MS_GRAPH_TENANT_ID", "tenant");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "client");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "secret");
    const created = await createInboundAddress({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId } });
    address = created.ok ? created.address.address : "";
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  it("files mail to a company's address for that company only, once, with its attachment, and marks it read", async () => {
    expect(address).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}@bids\.forgeaxi\.test$/);
    const local = address.split("@")[0]!;
    const before = await getStorageBytesUsed(fx.orgA.organizationId);
    const g = stubGraph([
      message("m1", address.toUpperCase(), { hasAttachments: true }),
      // Plus addressing on the shared mailbox reaches the same company.
      message("m2", `bids+${local}@forgeaxi.test`, { subject: "Amendment 1 to RFP 26-001" }),
      message("m3", "nobody-1234@bids.forgeaxi.test"),
    ]);
    const s1 = await pollInboundMailbox();
    expect(s1).toMatchObject({ configured: true, read: 3, stored: 2, unrouted: 1, failed: 0, error: null });
    expect(g.marked.sort()).toEqual(["m1", "m2", "m3"]);
    // The inline logo is not downloaded.
    expect(g.calls.some((c) => c.includes("/attachments/logo/"))).toBe(false);

    const listA = await listInboundEmails(fx.orgA.organizationId);
    expect(listA.map((e) => e.subject).sort()).toEqual(["Amendment 1 to RFP 26-001", "New Solicitation: IT Help Desk Services (RFP 26-001)"]);
    const first = listA.find((e) => e.subject.startsWith("New Solicitation"))!;
    expect(first).toMatchObject({ fromAddress: "noreply@eva.virginia.gov", fromName: "eVA", kind: "bid_alert", authenticated: true, attachments: 1, links: ["https://eva.virginia.gov/bid/26-001"] });
    expect(await listInboundEmails(fx.orgB.organizationId)).toEqual([]);
    const [row] = await db.select().from(inboundEmails).where(and(eq(inboundEmails.organizationId, fx.orgA.organizationId), eq(inboundEmails.providerMessageId, "<m1@eva.virginia.gov>")));
    expect(row).toMatchObject({ provider: "exchange", toAddress: address });
    expect(row!.storagePath.startsWith(`org/${fx.orgA.organizationId}/inbound/`)).toBe(true);
    expect(await getStorageBytesUsed(fx.orgA.organizationId)).toBeGreaterThan(before + 12);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "inbound_email.receive")));
    expect(audits).toHaveLength(2);

    // The same message again (marked unread in Outlook, say): recognised by its Internet Message-ID.
    stubGraph([message("m1b", address, { internetMessageId: "<m1@eva.virginia.gov>" })]);
    expect(await pollInboundMailbox()).toMatchObject({ read: 1, duplicate: 1, stored: 0 });
    expect(await listInboundEmails(fx.orgA.organizationId)).toHaveLength(2);
  });

  it("leaves a message it couldn't file unread for the next run, and does nothing unconfigured", async () => {
    const g = stubGraph([message("m9", address, { hasAttachments: true })], { failAttachment: "m9" });
    expect(await pollInboundMailbox()).toMatchObject({ read: 1, failed: 1, stored: 0 });
    expect(g.marked).toEqual([]);
    expect(await listInboundEmails(fx.orgA.organizationId)).toEqual([]);

    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "");
    expect(await pollInboundMailbox()).toMatchObject({ configured: false, read: 0 });
  });

  it("says so when Microsoft refuses FORGE's app", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." }), { status: 401 })));
    const s = await pollInboundMailbox();
    expect(s.error).toContain("Microsoft sign-in refused FORGE's app: invalid_client (AADSTS7000215: Invalid client secret provided.)");
  });
});
