/**
 * BL-SCOUT-INBOX — routing and reading an email from FORGE's Exchange mailbox.
 */
import { describe, expect, it } from "vitest";
import {
  classifyInbound,
  companyLocalPart,
  emailLinks,
  emailText,
  forgeLocalPart,
  graphConfig,
  htmlToText,
  inboundDomain,
  inboundMailbox,
  receivingConfigured,
  recipientsOf,
  senderAuth,
} from "@/lib/inbound-email-logic";

describe("BL-SCOUT-INBOX — addresses", () => {
  it("reads the inbound domain only when it is a domain", () => {
    expect(inboundDomain({ INBOUND_EMAIL_DOMAIN: " Bids.Forge.App " })).toBe("bids.forge.app");
    expect(inboundDomain({ INBOUND_EMAIL_DOMAIN: "not a domain" })).toBeNull();
    expect(inboundDomain({})).toBeNull();
  });
  it("makes a company's local part from its name and four random characters", () => {
    expect(forgeLocalPart("Acme Federal, LLC", "K3Q9ZZ")).toBe("acme-federal-llc-k3q9");
    expect(forgeLocalPart("—", "a")).toBe("bids-a000");
    expect(forgeLocalPart("A".repeat(60), "abcd").length).toBeLessThanOrEqual(35);
  });

  it("lists every recipient once, the envelope recipients Exchange keeps first", () => {
    const headers = [
      { name: "X-MS-Exchange-Organization-OriginalEnvelopeRecipients", value: "acme-k3q9@bids.forgeaxi.com" },
      { name: "To", value: "Bids <BIDS@acme.com>, other@x.com" },
    ];
    expect(recipientsOf({ recipients: ["other@x.com", "c@x.com"], headers })).toEqual(["acme-k3q9@bids.forgeaxi.com", "bids@acme.com", "other@x.com", "c@x.com"]);
  });
  it("names the company an address belongs to: the bid domain, or plus addressing on the mailbox", () => {
    const inbound = { domain: "bids.forgeaxi.com", mailbox: "bids@forgeaxi.com" };
    expect(companyLocalPart("Acme-K3Q9@bids.forgeaxi.com", inbound)).toBe("acme-k3q9");
    expect(companyLocalPart("acme-k3q9+eva@bids.forgeaxi.com", inbound)).toBe("acme-k3q9");
    expect(companyLocalPart("bids+acme-k3q9@forgeaxi.com", inbound)).toBe("acme-k3q9");
    expect(companyLocalPart("bids@forgeaxi.com", inbound)).toBeNull();
    expect(companyLocalPart("acme-k3q9@elsewhere.com", inbound)).toBeNull();
  });
  it("is set up only with the domain, the mailbox and the app registration", () => {
    const env = { INBOUND_EMAIL_DOMAIN: "bids.forgeaxi.com", INBOUND_MAILBOX: "Bids@ForgeAxi.com", MS_GRAPH_TENANT_ID: "t", MS_GRAPH_CLIENT_ID: "c", MS_GRAPH_CLIENT_SECRET: "s" };
    expect(inboundMailbox(env)).toBe("bids@forgeaxi.com");
    expect(graphConfig(env)).toEqual({ tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "bids@forgeaxi.com" });
    expect(receivingConfigured(env)).toBe(true);
    expect(receivingConfigured({ ...env, MS_GRAPH_CLIENT_SECRET: "" })).toBe(false);
    expect(receivingConfigured({ ...env, INBOUND_EMAIL_DOMAIN: "" })).toBe(false);
  });
});

describe("BL-SCOUT-INBOX — the email", () => {
  it("reads SPF and DKIM; either passing vouches for the sender", () => {
    expect(senderAuth([{ Name: "Received-SPF", Value: "Pass (sender SPF authorized) identity=mailfrom" }])).toEqual({ spf: "pass", dkim: "", authenticated: true });
    // Exchange Online's own header: spf=… dkim=… for the sender's domain.
    expect(senderAuth([{ Name: "Authentication-Results", Value: "spf=softfail (sender IP is 1.2.3.4) smtp.mailfrom=eva.virginia.gov; dkim=pass (signature was verified) header.d=eva.virginia.gov" }, { Name: "Received-SPF", Value: "SoftFail" }])).toEqual({ spf: "softfail", dkim: "pass", authenticated: true });
    expect(senderAuth([])).toEqual({ spf: "", dkim: "", authenticated: false });
  });
  it("reads HTML as text and finds the links", () => {
    const html = '<p>New bid: <a href="https://eva.virginia.gov/bid/123?a=1&amp;b=2">RFP 123</a></p><script>x()</script><div>Due&nbsp;12/10</div>';
    expect(htmlToText(html)).toBe("New bid: RFP 123\nDue 12/10");
    expect(emailText({ text: "", html })).toContain("RFP 123");
    expect(emailLinks({ text: "See https://emma.maryland.gov/x. Thanks", html })).toEqual(["https://eva.virginia.gov/bid/123?a=1&b=2", "https://emma.maryland.gov/x"]);
  });
  it("tells a bid alert from a portal account email", () => {
    expect(classifyInbound("New Solicitation Posted: IT Help Desk Services", "Closing date 12/10/2026")).toBe("bid_alert");
    expect(classifyInbound("Please verify your email address", "Click to confirm your registration")).toBe("account");
    expect(classifyInbound("Password reset request", "")).toBe("account");
    expect(classifyInbound("Amendment 2 to RFP 26-001", "Your account settings")).toBe("bid_alert");
    expect(classifyInbound("Holiday hours", "Our office is closed")).toBe("other");
  });
});
