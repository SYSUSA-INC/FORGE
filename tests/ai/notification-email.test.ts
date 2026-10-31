/**
 * BL-AIP-3 — the pure email builders behind the rules engine's email
 * channel. Until this slice the channel recorded "sent" and sent nothing.
 */

import { describe, expect, it } from "vitest";
import {
  buildDigestEmail,
  buildRuleNotificationEmail,
  escapeHtml,
  joinAppUrl,
} from "@/lib/notification-email";

describe("joinAppUrl", () => {
  it("joins origin and path without doubling slashes", () => {
    expect(joinAppUrl("https://forge.example.com/", "/proposals/1")).toBe(
      "https://forge.example.com/proposals/1",
    );
    expect(joinAppUrl("https://forge.example.com", "proposals/1")).toBe(
      "https://forge.example.com/proposals/1",
    );
  });

  it("falls back to the inbox when no path is given", () => {
    expect(joinAppUrl("https://forge.example.com", undefined)).toBe(
      "https://forge.example.com/notifications",
    );
    expect(joinAppUrl("https://forge.example.com", "   ")).toBe(
      "https://forge.example.com/notifications",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });
});

describe("buildRuleNotificationEmail", () => {
  const built = buildRuleNotificationEmail({
    subject: `Proposal advanced to <pink>`,
    body: "Stage moved from draft to pink.",
    linkPath: "/proposals/abc",
    ruleName: "Stage watch & alerts",
    appUrl: "https://forge.example.com",
  });

  it("prefixes the subject and keeps it under the cap", () => {
    expect(built.subject).toBe("[FORGE] Proposal advanced to <pink>");
    const long = buildRuleNotificationEmail({
      subject: "x".repeat(500),
      ruleName: "r",
      appUrl: "https://forge.example.com",
    });
    expect(long.subject.length).toBeLessThanOrEqual(120);
  });

  it("escapes user-controlled text in the HTML but not in the text part", () => {
    expect(built.html).toContain("Proposal advanced to &lt;pink&gt;");
    expect(built.html).not.toContain("<pink>");
    expect(built.html).toContain("Stage watch &amp; alerts");
    expect(built.text).toContain("Proposal advanced to <pink>");
    expect(built.text).toContain('rule "Stage watch & alerts"');
  });

  it("links to the absolute in-app URL in both parts", () => {
    expect(built.html).toContain('href="https://forge.example.com/proposals/abc"');
    expect(built.text).toContain("Open in FORGE: https://forge.example.com/proposals/abc");
  });

  it("omits the body paragraph when there is no body", () => {
    const noBody = buildRuleNotificationEmail({
      subject: "Hello",
      ruleName: "r",
      appUrl: "https://forge.example.com",
    });
    expect(noBody.html).not.toContain("<p style=\"margin:0;font-size:14px");
    expect(noBody.text.split("\n\n")[0]).toBe("Hello");
  });
});

describe("buildDigestEmail", () => {
  it("pluralises and names the cadence", () => {
    const one = buildDigestEmail({
      ruleName: "Daily review digest",
      count: 1,
      cadence: "daily",
      appUrl: "https://forge.example.com",
    });
    expect(one.subject).toBe("[FORGE] Daily review digest — 1 daily update");
    const many = buildDigestEmail({
      ruleName: "Weekly wrap",
      count: 12,
      cadence: "weekly",
      appUrl: "https://forge.example.com",
    });
    expect(many.subject).toBe("[FORGE] Weekly wrap — 12 weekly updates");
    expect(many.text).toContain("12 updates waiting");
  });

  it("lists the reader's next actions when given, each linking into FORGE (BL-NEXT-ACTION 5b)", () => {
    const d = buildDigestEmail({
      ruleName: "Weekly wrap",
      count: 2,
      cadence: "weekly",
      appUrl: "https://forge.example.com",
      nextActions: [
        { title: "Draft the 2 sections not started", pursuit: "Help desk <VA>", href: "/proposals/p1/sections" },
        { title: "Take the bid / no-bid decision", pursuit: "Cloud migration", href: "/opportunities/o1/evaluation" },
      ],
    });
    expect(d.html).toContain("Next actions on your pursuits");
    expect(d.html).toContain('href="https://forge.example.com/proposals/p1/sections"');
    expect(d.html).toContain("Help desk &lt;VA&gt;");
    expect(d.text).toContain("- Take the bid / no-bid decision — Cloud migration: https://forge.example.com/opportunities/o1/evaluation");
    const none = buildDigestEmail({ ruleName: "Weekly wrap", count: 2, cadence: "weekly", appUrl: "https://forge.example.com", nextActions: [] });
    expect(none.html).not.toContain("Next actions");
  });

  it("always links to the inbox and never goes negative", () => {
    const d = buildDigestEmail({
      ruleName: "r",
      count: -3,
      cadence: "daily",
      appUrl: "https://forge.example.com/",
    });
    expect(d.subject).toContain("0 daily updates");
    expect(d.html).toContain('href="https://forge.example.com/notifications"');
  });
});
