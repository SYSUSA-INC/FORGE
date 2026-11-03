/**
 * BL-NAV-LIFECYCLE phase 1b (FORGE II, footnote 3) — the sources the
 * Scout tab brings opportunities in from, on one page. SAM.gov search,
 * GSA eBuy and GSA email are working importers; enterprise portals and
 * GWACs have no integration yet, so they file a source request, which
 * records the demand. Pure; unit-tested.
 */
export type IdentifySourceKey = "sam" | "ebuy" | "gsa" | "portals" | "gwacs";

export type IdentifySource = {
  key: IdentifySourceKey;
  label: string;
  /** One line under the picker. */
  hint: string;
  /** False: no importer yet, the source-request form stands in. */
  live: boolean;
};

export const IDENTIFY_SOURCES: readonly IdentifySource[] = [
  { key: "sam", label: "SAM.gov search", hint: "Search live SAM.gov notices by your NAICS codes and keywords.", live: true },
  { key: "ebuy", label: "GSA eBuy", hint: "eBuy has no public API: paste an RFQ and FORGE reads its fields.", live: true },
  { key: "gsa", label: "GSA email", hint: "Paste a forwarded GSA notification; drop its attachments alongside.", live: true },
  { key: "portals", label: "Enterprise portals", hint: "State, local and commercial portals your team watches.", live: false },
  { key: "gwacs", label: "GWACs", hint: "Contract vehicles your company holds: GSA MAS, OASIS+, Alliant, SEWP and the like.", live: false },
] as const;

/** The source a `?source=` value names, or null for none or an unknown one. */
export function identifySource(raw: string | null | undefined): IdentifySource | null {
  return IDENTIFY_SOURCES.find((s) => s.key === raw) ?? null;
}

/** Where a source opens: the Scout tab with that source chosen. */
export function identifySourceHref(key: IdentifySourceKey): string {
  return `/pipeline/identify?tab=scout&source=${key}`;
}
