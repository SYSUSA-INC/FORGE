/**
 * BL-SCOUT-INBOX phase 2 — the bids in a portal's email become Scout finds
 * (Postgres, AI in stub mode, two tenants): a bid alert from a verified
 * sender is queued to be read and read into a find, once; an unverified
 * sender is held until an admin reads it; an account email isn't queued;
 * a solicitation already in the pipeline is skipped; adding the find to
 * the pipeline files the email's attachment on the new opportunity; the
 * other tenant sees none of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The read is run here, not in the background, so the test sees one reading.
vi.mock("@/lib/background", () => ({ runInBackground: () => undefined }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs, inboundEmails, opportunities, scoutCandidates, solicitations } from "@/db/schema";
import { createInboundAddress, receiveInboundMessage } from "@/lib/inbound-email";
import { readInboundEmail } from "@/lib/inbound-bids";
import { decideScoutCandidate } from "@/lib/scout";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

let address = "";
/** One email as FORGE's Exchange reader hands it over. */
const send = async (o: { MessageID: string; Subject: string; TextBody?: string; Headers?: { Name: string; Value: string }[]; Attachments?: { Name: string; ContentType: string; Content: string }[] }) =>
  receiveInboundMessage(
    {
      messageId: o.MessageID,
      from: "noreply@eva.virginia.gov",
      fromName: "eVA",
      recipients: [address],
      subject: o.Subject,
      text: o.TextBody ?? "A new bid was posted. View it: https://eva.virginia.gov/bid/26-001",
      html: "",
      date: new Date().toISOString(),
      headers: (o.Headers ?? [{ Name: "Received-SPF", Value: "Pass" }]).map((h) => ({ name: h.Name, value: h.Value })),
    },
    (o.Attachments ?? []).map((a) => ({ name: a.Name, contentType: a.ContentType, bytes: Uint8Array.from(Buffer.from(a.Content, "base64")) })),
  );
const emailId = async (messageId: string) =>
  (await db.select({ id: inboundEmails.id }).from(inboundEmails).where(eq(inboundEmails.providerMessageId, messageId)))[0]!.id;

describe("BL-SCOUT-INBOX — reading a portal's email into Scout finds", () => {
  let fx: TwoTenantFixture;
  let tier: { cleanup: () => Promise<void> } | null = null;
  beforeEach(async () => {
    fx = await createTwoTenants("inbound-bids");
    // A plan, so the attachment can be stored.
    tier = await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `ib-${Date.now()}`, name: "IB" });
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "bids.forgeaxi.test");
    vi.stubEnv("INBOUND_MAILBOX", "bids@forgeaxi.test");
    vi.stubEnv("MS_GRAPH_TENANT_ID", "tenant");
    vi.stubEnv("MS_GRAPH_CLIENT_ID", "client");
    vi.stubEnv("MS_GRAPH_CLIENT_SECRET", "secret");
    const created = await createInboundAddress({ organizationId: fx.orgA.organizationId, actor: { userId: fx.orgA.userId } });
    address = created.ok ? created.address.address : "";
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await tier?.cleanup();
    await fx.cleanup();
  });

  it("reads a bid alert into one find, once, and its attachment goes to the opportunity", async () => {
    const org = fx.orgA.organizationId;
    await send({
      MessageID: "bid-1",
      Subject: "New Solicitation RFP-26-001 IT Help Desk Services",
      Attachments: [{ Name: "RFP-26-001.pdf", ContentType: "application/pdf", Content: Buffer.from("%PDF-1.4 x").toString("base64") }],
    });
    const id = await emailId("bid-1");
    const [job] = await db.select({ kind: backgroundJobs.kind }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, org), eq(backgroundJobs.resourceId, id)));
    expect(job?.kind).toBe("inbound_email_parse");

    expect(await readInboundEmail({ organizationId: org, emailId: id })).toEqual({ ok: true, bids: 1, created: 1 });
    expect(await readInboundEmail({ organizationId: org, emailId: id })).toEqual({ ok: true, bids: 1, created: 0 });
    const finds = await db.select().from(scoutCandidates).where(eq(scoutCandidates.organizationId, org));
    expect(finds).toHaveLength(1);
    expect(finds[0]).toMatchObject({ source: "portal_email", title: "New Solicitation RFP-26-001 IT Help Desk Services", solicitationNumber: "RFP-26-001", uiLink: "https://eva.virginia.gov/bid/26-001", inboundEmailId: id, status: "new" });
    const [email] = await db.select().from(inboundEmails).where(eq(inboundEmails.id, id));
    expect(email).toMatchObject({ status: "parsed", kind: "bid_alert", bidsFound: 1 });
    expect(await db.select().from(scoutCandidates).where(eq(scoutCandidates.organizationId, fx.orgB.organizationId))).toHaveLength(0);

    const added = await decideScoutCandidate({ organizationId: org, candidateId: finds[0]!.id, decision: "imported", actor: { userId: fx.orgA.userId } });
    expect(added.ok).toBe(true);
    const oppId = added.ok ? added.opportunityId! : "";
    const [opp] = await db.select({ noticeId: opportunities.noticeId }).from(opportunities).where(eq(opportunities.id, oppId));
    expect(opp!.noticeId).toBe("");
    const filed = await db.select({ fileName: solicitations.fileName, source: solicitations.source, storagePath: solicitations.storagePath }).from(solicitations).where(and(eq(solicitations.organizationId, org), eq(solicitations.opportunityId, oppId)));
    expect(filed).toEqual([expect.objectContaining({ fileName: "RFP-26-001.pdf", source: "portal-email" })]);
    expect(filed[0]!.storagePath.startsWith(`org/${org}/solicitation/`)).toBe(true);
  });

  it("holds an unverified sender until an admin reads it, skips a solicitation in the pipeline, and doesn't queue an account email", async () => {
    const org = fx.orgA.organizationId;
    await db.insert(opportunities).values({ organizationId: org, title: "Already ours", solicitationNumber: "RFP 26-002" });
    await send({ MessageID: "bid-2", Subject: "New Solicitation RFP-26-002 Cloud Hosting", Headers: [] });
    const id = await emailId("bid-2");
    const held = await readInboundEmail({ organizationId: org, emailId: id });
    expect(held).toMatchObject({ ok: false, held: true });
    expect((await db.select({ error: inboundEmails.error }).from(inboundEmails).where(eq(inboundEmails.id, id)))[0]!.error).toContain("Held");
    // The admin reads it: the bid is read, but its solicitation is already in the pipeline.
    expect(await readInboundEmail({ organizationId: org, emailId: id, actor: { userId: fx.orgA.userId }, force: true })).toEqual({ ok: true, bids: 1, created: 0 });

    await send({ MessageID: "acct-1", Subject: "Please verify your email address", TextBody: "Confirm your registration: https://eva.virginia.gov/verify" });
    const acct = await emailId("acct-1");
    expect(await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, org), eq(backgroundJobs.resourceId, acct)))).toHaveLength(0);
    // Another organization can't read A's email.
    expect(await readInboundEmail({ organizationId: fx.orgB.organizationId, emailId: id })).toEqual({ ok: false, error: "Email not found." });
  });
});
