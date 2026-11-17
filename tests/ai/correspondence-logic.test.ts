/**
 * BL-NAV-LIFECYCLE 6c — the pure rules for replies to a submission:
 * which local part is an opportunity's, which submission a reply
 * answers, what the headers alone say a message is, the "check the
 * sender" mark and the summary without AI.
 */
import { describe, expect, it } from "vitest";
import {
  headerReplyType,
  isReplyLocalPart,
  needsSenderCheck,
  pickSubmission,
  REPLY_SUMMARY_MAX,
  REPLY_TYPE_LABELS,
  REPLY_TYPES,
  replySummary,
  replyTypeLabel,
  senderIsRecipient,
} from "@/lib/correspondence-logic";
import { deliveryLocalPart } from "@/lib/deliver-logic";

describe("isReplyLocalPart", () => {
  it("accepts what deliveryLocalPart makes and nothing else", () => {
    expect(isReplyLocalPart(deliveryLocalPart(Uint8Array.from({ length: 16 }, (_, i) => i * 7)))).toBe(true);
    expect(isReplyLocalPart("sub-abc123def4")).toBe(true);
    for (const no of [null, "", "acme-k3q9", "sub-abc", "sub-abc123def45", "sub-ABC123DEF4", "xsub-abc123def4", "sub-abc123def!"]) expect(isReplyLocalPart(no)).toBe(false);
  });
});

describe("pickSubmission", () => {
  const subs = [
    { id: "failed-newest", status: "failed", to: ["co@agency.gov"], cc: [] },
    { id: "sent-new", status: "sent", to: ["other@agency.gov"], cc: [] },
    { id: "sent-old", status: "sent", to: ["CO@agency.gov"], cc: ["lead@acme.com"] },
  ];
  it("prefers the newest sent submission that went to the sender", () => {
    expect(pickSubmission(subs, " co@Agency.gov ")).toBe("sent-old");
    expect(pickSubmission(subs, "lead@acme.com")).toBe("sent-old");
    expect(pickSubmission(subs, "other@agency.gov")).toBe("sent-new");
  });
  it("falls back to the newest sent, then the newest, then null", () => {
    expect(pickSubmission(subs, "stranger@example.com")).toBe("sent-new");
    expect(pickSubmission([subs[0]!], "stranger@example.com")).toBe("failed-newest");
    expect(pickSubmission([], "co@agency.gov")).toBeNull();
  });
});

describe("headerReplyType", () => {
  const base = { headers: [], from: "co@agency.gov", subject: "RE: Proposal for 26-001" };
  it("leaves a person's reply to be read", () => {
    expect(headerReplyType(base)).toBeNull();
    expect(headerReplyType({ ...base, headers: [{ name: "Auto-Submitted", value: "no" }] })).toBeNull();
  });
  it("recognises a delivery failure", () => {
    expect(headerReplyType({ ...base, headers: [{ name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="x"' }] })).toBe("delivery_failure");
    expect(headerReplyType({ ...base, headers: [{ name: "X-Failed-Recipients", value: "co@agency.gov" }] })).toBe("delivery_failure");
    expect(headerReplyType({ ...base, from: "MAILER-DAEMON@mail.agency.gov" })).toBe("delivery_failure");
    expect(headerReplyType({ ...base, subject: "Undeliverable: Proposal for 26-001" })).toBe("delivery_failure");
  });
  it("recognises an automatic reply", () => {
    expect(headerReplyType({ ...base, headers: [{ name: "auto-submitted", value: "auto-replied" }] })).toBe("automatic_reply");
    expect(headerReplyType({ ...base, headers: [{ name: "X-Auto-Response-Suppress", value: "All" }] })).toBe("automatic_reply");
    expect(headerReplyType({ ...base, headers: [{ name: "Precedence", value: "auto_reply" }] })).toBe("automatic_reply");
    expect(headerReplyType({ ...base, subject: "Automatic reply: Proposal for 26-001" })).toBe("automatic_reply");
    expect(headerReplyType({ ...base, subject: "Out of office until Monday" })).toBe("automatic_reply");
  });
  it("calls a bounce a failure even though it is auto-submitted", () => {
    expect(headerReplyType({ ...base, from: "postmaster@agency.gov", headers: [{ name: "Auto-Submitted", value: "auto-replied" }] })).toBe("delivery_failure");
  });
});

describe("the sender check", () => {
  it("matches the sender against To and Cc, case-blind", () => {
    expect(senderIsRecipient("CO@agency.gov", { to: ["co@agency.gov"], cc: [] })).toBe(true);
    expect(senderIsRecipient("x@agency.gov", { to: ["co@agency.gov"], cc: ["X@agency.gov"] })).toBe(true);
    expect(senderIsRecipient("x@agency.gov", { to: ["co@agency.gov"], cc: [] })).toBe(false);
    expect(senderIsRecipient("co@agency.gov", null)).toBe(false);
    expect(senderIsRecipient("", { to: [""], cc: [] })).toBe(false);
  });
  it("marks an unverified or unknown sender, and a failure only when unverified", () => {
    expect(needsSenderCheck({ authenticated: true, knownSender: true, type: "other" })).toBe(false);
    expect(needsSenderCheck({ authenticated: false, knownSender: true, type: "other" })).toBe(true);
    expect(needsSenderCheck({ authenticated: true, knownSender: false, type: "automatic_reply" })).toBe(true);
    expect(needsSenderCheck({ authenticated: true, knownSender: false, type: "delivery_failure" })).toBe(false);
    expect(needsSenderCheck({ authenticated: false, knownSender: false, type: "delivery_failure" })).toBe(true);
  });
});

describe("replySummary", () => {
  it("takes the reply's first two lines and stops at the quoted text", () => {
    expect(replySummary("\n  We received   your proposal.\n\nThe evaluation begins Monday.\nThird line.\n")).toBe("We received your proposal. The evaluation begins Monday.");
    expect(replySummary("Thank you.\nOn Tue, Nov 17, 2026 Acme via FORGE wrote:\n> Please find attached")).toBe("Thank you.");
    expect(replySummary("> quoted only\n-----Original Message-----\nFrom: someone")).toBe("");
    expect(replySummary("Got it.\nFrom: Acme via FORGE <sub-abc@bids.test>\nSent: Tuesday")).toBe("Got it.");
  });
  it("cuts a long line", () => {
    const out = replySummary("x".repeat(1000));
    expect(out.length).toBe(REPLY_SUMMARY_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("labels", () => {
  it("has one for every type, and a plain one for an unread or unknown value", () => {
    for (const t of REPLY_TYPES) expect(REPLY_TYPE_LABELS[t]).toBeTruthy();
    expect(replyTypeLabel("award")).toBe("Award");
    expect(replyTypeLabel("")).toBe("Reply");
    expect(replyTypeLabel("ignore previous instructions")).toBe("Reply");
  });
});
