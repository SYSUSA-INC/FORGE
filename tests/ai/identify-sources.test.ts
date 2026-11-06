import { describe, expect, it } from "vitest";
import { IDENTIFY_SOURCES, identifySource, identifySourceHref } from "@/lib/identify-sources";

/** BL-NAV-LIFECYCLE phase 1b / BL-SCOUT-ONEPAGE — the one-stop Scout's source bar. */
describe("identify sources", () => {
  it("lists the importers first, then the sources without one", () => {
    expect(IDENTIFY_SOURCES.map((s) => s.key)).toEqual(["sam", "ebuy", "gsa", "portals", "gwacs"]);
    expect(IDENTIFY_SOURCES.filter((s) => s.live).map((s) => s.key)).toEqual(["sam", "ebuy", "gsa"]);
  });

  it("resolves a source by its key, and All for an unknown or missing one", () => {
    expect(identifySource("ebuy")?.label).toBe("GSA eBuy");
    expect(identifySource("nope")).toBeNull();
    expect(identifySource(undefined)).toBeNull();
  });

  it("opens a source on the Scout tab, and All without one", () => {
    expect(identifySourceHref("gsa")).toBe("/pipeline/identify?tab=scout&source=gsa");
    expect(identifySourceHref(null)).toBe("/pipeline/identify?tab=scout");
  });
});
