/**
 * BL-NAV-LIFECYCLE phase 1b (FORGE II, footnote 3) — the sources the
 * Scout tab brings opportunities in from, on one page. BL-SCOUT-ONEPAGE —
 * they are the tabs of one source bar: All (the nightly scout's finds),
 * SAM.gov (a live search), GSA eBuy and GSA email (paste); enterprise
 * portals (state, prime and commercial, owner 2026-11-06) and GWACs
 * (BL-SCOUT-GWAC) have no importer yet, so they file a source request,
 * which records the demand. Pure; unit-tested.
 */
export type IdentifySourceKey = "sam" | "ebuy" | "gsa" | "portals" | "gwacs";

export type IdentifySource = {
  key: IdentifySourceKey;
  label: string;
  /** One line under the source bar. */
  hint: string;
  /** False: no importer yet, the source-request form stands in. */
  live: boolean;
};

export const IDENTIFY_SOURCES: readonly IdentifySource[] = [
  { key: "sam", label: "SAM.gov", hint: "Search SAM.gov live for something specific: any window up to 90 days, words a notice must mention, GSA vehicles and notice types.", live: true },
  { key: "ebuy", label: "GSA eBuy", hint: "eBuy has no public API: paste an RFQ and FORGE reads its fields.", live: true },
  { key: "gsa", label: "GSA email", hint: "Paste a forwarded GSA notification; drop its attachments alongside.", live: true },
  { key: "portals", label: "Enterprise portals", hint: "State procurement portals, primes' supplier portals and commercial aggregators: being researched; tell us which ones you use.", live: false },
  { key: "gwacs", label: "GWACs", hint: "Task orders under the contract vehicles you hold (OASIS+, Alliant, SEWP and others): on the backlog; tell us which ones you hold.", live: false },
] as const;

/** The source a `?source=` value names, or null (All) for none or an unknown one. */
export function identifySource(raw: string | null | undefined): IdentifySource | null {
  return IDENTIFY_SOURCES.find((s) => s.key === raw) ?? null;
}

/** Where a source opens: the Scout tab with that source chosen; null is All. */
export function identifySourceHref(key: IdentifySourceKey | null): string {
  return key ? `/pipeline/identify?tab=scout&source=${key}` : "/pipeline/identify?tab=scout";
}
