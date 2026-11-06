/**
 * BL-SCOUT-INBOX — reading Postmark's inbound payload.
 */
import { describe, expect, it } from "vitest";
import {
  classifyInbound,
  emailLinks,
  emailText,
  forgeLocalPart,
  htmlToText,
  inboundDomain,
  postmarkInboundSchema,
  recipientsOf,
  senderAuth,
  splitAddress,
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
  it("splits an address, lower case, without a +tag", () => {
    expect(splitAddress("<Acme-k3q9+eva@Bids.Forge.App>")).toEqual({ local: "acme-k3q9", domain: "bids.forge.app" });
    expect(splitAddress("nobody")).toBeNull();
  });
  it("lists every recipient once, the original recipient first", () => {
    const p = postmarkInboundSchema.parse({ MessageID: "m", OriginalRecipient: "A@x.com", ToFull: [{ Email: "a@x.com" }, { Email: "b@x.com" }], CcFull: [{ Email: "c@x.com" }] });
    expect(recipientsOf(p)).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("BL-SCOUT-INBOX — the email", () => {
  it("reads SPF and DKIM; either passing vouches for the sender", () => {
    expect(senderAuth([{ Name: "Received-SPF", Value: "Pass (sender SPF authorized) identity=mailfrom" }])).toEqual({ spf: "pass", dkim: "", authenticated: true });
    expect(senderAuth([{ Name: "Authentication-Results", Value: "mx.example; spf=softfail; dkim=pass header.d=eva.virginia.gov" }, { Name: "Received-SPF", Value: "SoftFail" }])).toEqual({ spf: "softfail", dkim: "pass", authenticated: true });
    expect(senderAuth([])).toEqual({ spf: "", dkim: "", authenticated: false });
  });
  it("reads HTML as text and finds the links", () => {
    const html = '<p>New bid: <a href="https://eva.virginia.gov/bid/123?a=1&amp;b=2">RFP 123</a></p><script>x()</script><div>Due&nbsp;12/10</div>';
    expect(htmlToText(html)).toBe("New bid: RFP 123\nDue 12/10");
    expect(emailText({ TextBody: "", HtmlBody: html })).toContain("RFP 123");
    expect(emailLinks({ TextBody: "See https://emma.maryland.gov/x. Thanks", HtmlBody: html })).toEqual(["https://eva.virginia.gov/bid/123?a=1&b=2", "https://emma.maryland.gov/x"]);
  });
  it("tells a bid alert from a portal account email", () => {
    expect(classifyInbound("New Solicitation Posted: IT Help Desk Services", "Closing date 12/10/2026")).toBe("bid_alert");
    expect(classifyInbound("Please verify your email address", "Click to confirm your registration")).toBe("account");
    expect(classifyInbound("Password reset request", "")).toBe("account");
    expect(classifyInbound("Amendment 2 to RFP 26-001", "Your account settings")).toBe("bid_alert");
    expect(classifyInbound("Holiday hours", "Our office is closed")).toBe("other");
  });
});
