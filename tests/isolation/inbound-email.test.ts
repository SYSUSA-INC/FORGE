/**
 * BL-SCOUT-INBOX — Postmark's inbound webhook against Postgres, two
 * tenants: mail to company A's bid address is stored for A only, once per
 * MessageID, with its sender check, text, links and kind; mail to an
 * unknown address is dropped with 200; a wrong password is 401 and no
 * secret refuses the route; the company's storage meter counts the email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, inboundEmails } from "@/db/schema";
import { createInboundAddress, getInboundAddress, listInboundEmails } from "@/lib/inbound-email";
import { getStorageBytesUsed } from "@/lib/subscription-gates";
import { POST } from "@/app/api/webhooks/postmark-inbound/route";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const SECRET = "inbound-secret-0123456789";
const basic = (pw: string) => `Basic ${Buffer.from(`inbound:${pw}`).toString("base64")}`;
const req = (body: unknown, pw = SECRET) =>
  new NextRequest("http://localhost/api/webhooks/postmark-inbound", { method: "POST", headers: { authorization: basic(pw), "content-type": "application/json" }, body: JSON.stringify(body) });
const payload = (to: string, o: Record<string, unknown> = {}) => ({
  MessageID: "pm-1",
  From: "noreply@eva.virginia.gov",
  FromFull: { Email: "NoReply@eva.virginia.gov", Name: "eVA" },
  OriginalRecipient: to,
  ToFull: [{ Email: to, Name: "" }],
  Subject: "New Solicitation: IT Help Desk Services (RFP 26-001)",
  TextBody: "A new bid matching your commodity codes was posted.\nView it: https://eva.virginia.gov/bid/26-001\nClosing date 12/10/2026.",
  HtmlBody: "",
  Date: "Fri, 6 Nov 2026 14:00:00 -0500",
  Headers: [{ Name: "Received-SPF", Value: "Pass (sender SPF authorized)" }],
  Attachments: [{ Name: "RFP 26-001.pdf", ContentType: "application/pdf", ContentLength: 12, Content: Buffer.from("%PDF-1.4 x").toString("base64") }],
  ...o,
});

describe("BL-SCOUT-INBOX — the Postmark inbound webhook", () => {
  let fx: TwoTenantFixture;
  beforeEach(async () => {
    fx = await createTwoTenants("inbound");
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "bids.forge.test");
    vi.stubEnv("INBOUND_WEBHOOK_SECRET", SECRET);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fx.cleanup();
  });

  it("stores mail to a company's address for that company only, once", async () => {
    const created = await createInboundAddress({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId } });
    expect(created.ok).toBe(true);
    const address = created.ok ? created.address.address : "";
    expect(address).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}@bids\.forge\.test$/);
    // Created once: asking again returns the same address.
    expect((await createInboundAddress({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId } })).ok && (await getInboundAddress(fx.orgA.organizationId))?.address).toBe(address);

    const before = await getStorageBytesUsed(fx.orgA.organizationId);
    const res = await POST(req(payload(address.toUpperCase().replace("@", "+eva@"))));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "stored" });

    const listA = await listInboundEmails(fx.orgA.organizationId);
    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({ fromAddress: "noreply@eva.virginia.gov", fromName: "eVA", kind: "bid_alert", status: "received", authenticated: true, attachments: 1, links: ["https://eva.virginia.gov/bid/26-001"] });
    expect(await listInboundEmails(fx.orgB.organizationId)).toEqual([]);
    const [row] = await db.select().from(inboundEmails).where(eq(inboundEmails.organizationId, fx.orgA.organizationId));
    expect(row!.storagePath.startsWith(`org/${fx.orgA.organizationId}/inbound/`)).toBe(true);
    expect(row!.toAddress).toBe(address);
    expect(await getStorageBytesUsed(fx.orgA.organizationId)).toBe(before + row!.rawSize);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "inbound_email.receive")));
    expect(audits).toHaveLength(1);

    // Postmark retries a delivery: recognised by its MessageID.
    const again = await POST(req(payload(address)));
    expect(await again.json()).toEqual({ ok: true, status: "duplicate" });
    expect(await listInboundEmails(fx.orgA.organizationId)).toHaveLength(1);
  });

  it("drops mail for an unknown address, refuses a wrong password, and won't run without a secret", async () => {
    const unknown = await POST(req(payload("nobody-1234@bids.forge.test", { MessageID: "pm-2" })));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: true, status: "unrouted" });
    // Another domain's address with a known local part is not routed either.
    const created = await createInboundAddress({ organizationId: fx.orgB.organizationId, actor: { userId: fx.orgB.userId } });
    const local = created.ok ? created.address.address.split("@")[0] : "";
    expect(await (await POST(req(payload(`${local}@elsewhere.test`, { MessageID: "pm-3" })))).json()).toEqual({ ok: true, status: "unrouted" });
    expect(await listInboundEmails(fx.orgB.organizationId)).toEqual([]);

    expect((await POST(req(payload("x@bids.forge.test"), "wrong-secret-0123456789"))).status).toBe(401);
    expect((await POST(req({ hello: "world" }))).status).toBe(400);
    vi.stubEnv("INBOUND_WEBHOOK_SECRET", "");
    expect((await POST(req(payload("x@bids.forge.test")))).status).toBe(500);
  });
});
