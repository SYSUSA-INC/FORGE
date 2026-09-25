/**
 * BL-AUTH-DOMAIN — the pure domain rules behind domain-scoped tenant
 * membership: parsing, ownership checks and the approval predicate.
 */
import { describe, expect, it } from "vitest";
import {
  crossDomainReason,
  domainOf,
  inviteAwaitsApproval,
  inviteIsApproved,
  isCrossDomainInvite,
  isPublicEmailDomain,
  normalizeDomain,
  parseDomainList,
  tenantAllowsEmail,
} from "@/lib/email-domain";

const sysusa = { emailDomains: ["sysusa.com"], approvedExternalDomains: ["partner.io"] };
const noDomains = { emailDomains: [], approvedExternalDomains: [] };

describe("BL-AUTH-DOMAIN — domainOf / normalizeDomain", () => {
  it("lower-cases and validates the domain part", () => {
    expect(domainOf("  Muneer.Baig@SysUSA.com ")).toBe("sysusa.com");
    expect(domainOf("a@b.co.uk")).toBe("b.co.uk");
    expect(domainOf("no-at-sign")).toBeNull();
    expect(domainOf("@nouser.com")).toBeNull();
    expect(domainOf("x@not a domain")).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it("normalises hand-typed domains", () => {
    expect(normalizeDomain(" @Acme.COM. ")).toBe("acme.com");
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
  });

  it("knows public mailbox providers", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("GMAIL.COM")).toBe(true);
    expect(isPublicEmailDomain("sysusa.com")).toBe(false);
  });
});

describe("BL-AUTH-DOMAIN — parseDomainList", () => {
  it("splits on commas, whitespace and newlines, dedupes, and reports problems", () => {
    const res = parseDomainList("Acme.com, acme.com\npartner.io; gmail.com not-a-domain");
    expect(res.domains).toEqual(["acme.com", "partner.io"]);
    expect(res.publicProviders).toEqual(["gmail.com"]);
    expect(res.invalid).toEqual(["not-a-domain"]);
  });

  it("returns empty lists for empty input", () => {
    expect(parseDomainList("  \n ")).toEqual({ domains: [], invalid: [], publicProviders: [] });
  });
});

describe("BL-AUTH-DOMAIN — tenantAllowsEmail / isCrossDomainInvite", () => {
  it("allows owned and approved external domains, case-insensitively", () => {
    expect(tenantAllowsEmail("a@sysusa.com", sysusa)).toBe(true);
    expect(tenantAllowsEmail("a@SYSUSA.COM", sysusa)).toBe(true);
    expect(tenantAllowsEmail("b@partner.io", sysusa)).toBe(true);
    expect(isCrossDomainInvite("a@sysusa.com", sysusa)).toBe(false);
  });

  it("treats every other domain as cross-domain — including public providers", () => {
    expect(isCrossDomainInvite("x@enablenow.com", sysusa)).toBe(true);
    expect(isCrossDomainInvite("x@gmail.com", sysusa)).toBe(true);
    expect(isCrossDomainInvite("sub@mail.sysusa.com", sysusa)).toBe(true);
    expect(isCrossDomainInvite("garbage", sysusa)).toBe(true);
  });

  it("allows nobody by default when the tenant has no domains", () => {
    expect(tenantAllowsEmail("a@sysusa.com", noDomains)).toBe(false);
    expect(crossDomainReason("a@sysusa.com", noDomains)).toMatch(/no email domains on file/);
    expect(crossDomainReason("x@enablenow.com", sysusa)).toMatch(/enablenow\.com is not one of this workspace's domains \(sysusa\.com\)/);
  });
});

describe("BL-AUTH-DOMAIN — inviteIsApproved", () => {
  it("same-domain invites are always usable", () => {
    expect(inviteIsApproved({ crossDomain: false, platformApprovedAt: null })).toBe(true);
    expect(inviteAwaitsApproval({ crossDomain: false, platformApprovedAt: undefined })).toBe(false);
  });

  it("cross-domain invites need the platform stamp", () => {
    expect(inviteIsApproved({ crossDomain: true, platformApprovedAt: null })).toBe(false);
    expect(inviteAwaitsApproval({ crossDomain: true, platformApprovedAt: null })).toBe(true);
    expect(inviteIsApproved({ crossDomain: true, platformApprovedAt: new Date() })).toBe(true);
    expect(inviteIsApproved({ crossDomain: true, platformApprovedAt: "2026-09-25T00:00:00Z" })).toBe(true);
  });
});
