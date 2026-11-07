/**
 * BL-OPP-SOURCE — the source vocabulary and its links: only http(s) links
 * are kept (never `javascript:` or credentials), a SAM.gov notice links to
 * its public page, a pasted email's preferred link is found, and a Scout
 * find carries its own link.
 */
import { describe, expect, it } from "vitest";
import { firstLink, isOpportunitySource, normalizeSourceUrl, samNoticeUrl, scoutSourceFields, sourceHost, sourceLabel, sourceUrlProblem } from "@/lib/opportunity-source";

describe("opportunity source", () => {
  it("knows its sources and labels an unknown one as by hand", () => {
    expect(isOpportunitySource("state")).toBe(true);
    expect(isOpportunitySource("ftp")).toBe(false);
    expect(sourceLabel("gsa_ebuy")).toBe("GSA eBuy");
    expect(sourceLabel("nonsense")).toBe("Entered by hand");
  });

  it("keeps http(s) links only", () => {
    expect(normalizeSourceUrl("https://sam.gov/opp/abc123def/view")).toBe("https://sam.gov/opp/abc123def/view");
    expect(normalizeSourceUrl("  bids.state.va.us/rfp/42 ")).toBe("https://bids.state.va.us/rfp/42");
    expect(normalizeSourceUrl("javascript:alert(1)")).toBe("");
    expect(normalizeSourceUrl("data:text/html,hi")).toBe("");
    expect(normalizeSourceUrl("https://user:pw@evil.example/x")).toBe("");
    expect(normalizeSourceUrl("localhost")).toBe("");
    expect(normalizeSourceUrl(`https://a.gov/${"x".repeat(2100)}`)).toBe("");
    expect(normalizeSourceUrl("")).toBe("");
    expect(sourceUrlProblem("")).toBeNull();
    expect(sourceUrlProblem("javascript:alert(1)")).toMatch(/https/);
    expect(sourceHost("https://www.ebuy.gsa.gov/ebuy/x")).toBe("ebuy.gsa.gov");
  });

  it("links a SAM.gov notice to its public page", () => {
    expect(samNoticeUrl("0a1b2c3d4e5f")).toBe("https://sam.gov/opp/0a1b2c3d4e5f/view");
    expect(samNoticeUrl("")).toBe("");
    expect(samNoticeUrl("bad id/../x")).toBe("");
  });

  it("finds the preferred link in pasted text", () => {
    const text = "See https://www.example.com/tracking. RFQ at https://www.ebuy.gsa.gov/ebuy/seller/RFQ1234567, and sam.gov";
    expect(firstLink(text, ["ebuy.gsa.gov"])).toBe("https://www.ebuy.gsa.gov/ebuy/seller/RFQ1234567");
    expect(firstLink(text)).toBe("https://www.example.com/tracking");
    expect(firstLink("no links here")).toBe("");
  });

  it("gives a Scout find its source and link", () => {
    expect(scoutSourceFields("org_naics", "0a1b2c3d4e5f", "")).toEqual({ source: "samgov", sourceUrl: "https://sam.gov/opp/0a1b2c3d4e5f/view" });
    expect(scoutSourceFields("portal_email", "email:abc", "https://bids.county.gov/rfp/9")).toEqual({ source: "portal_email", sourceUrl: "https://bids.county.gov/rfp/9" });
    expect(scoutSourceFields("watchlist_award", "award:1", "https://www.usaspending.gov/award/X")).toEqual({ source: "usaspending", sourceUrl: "https://www.usaspending.gov/award/X" });
  });
});
