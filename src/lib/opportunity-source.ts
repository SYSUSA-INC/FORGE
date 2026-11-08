/**
 * BL-OPP-SOURCE (owner, 2026-11-07) — where an opportunity came from, kept
 * on it with a link back: SAM.gov, GSA eBuy, a GSA email, a GWAC, a state,
 * local, commercial or prime portal, an email to the bid inbox, an
 * uploaded document, a USAspending recompete, or entered by hand. Every
 * importer sets it; anyone who can edit the opportunity can correct it.
 * Pure.
 */

export const OPPORTUNITY_SOURCES = [
  { key: "samgov", label: "SAM.gov" },
  { key: "gsa_ebuy", label: "GSA eBuy" },
  { key: "gsa_email", label: "GSA email" },
  { key: "gwac", label: "GWAC" },
  { key: "state", label: "State portal" },
  { key: "local", label: "Local portal" },
  { key: "commercial", label: "Commercial or prime portal" },
  { key: "portal_email", label: "Portal email (bid inbox)" },
  { key: "usaspending", label: "USAspending recompete" },
  { key: "document", label: "Uploaded document" },
  { key: "manual", label: "Entered by hand" },
] as const;

export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number]["key"];

export function isOpportunitySource(v: unknown): v is OpportunitySource {
  return typeof v === "string" && OPPORTUNITY_SOURCES.some((s) => s.key === v);
}

export function sourceLabel(v: string): string {
  return OPPORTUNITY_SOURCES.find((s) => s.key === v)?.label ?? "Entered by hand";
}

/** SAM.gov's public page for a notice, or "" without one. */
export function samNoticeUrl(noticeId: string): string {
  const id = noticeId.trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(id) ? `https://sam.gov/opp/${id}/view` : "";
}

export const SOURCE_URL_MAX = 2000;

/**
 * A link as it is kept: http(s) only, no credentials in it, at most 2,000
 * characters; anything else is "" (so a `javascript:` or `data:` link can
 * never be stored or rendered). A bare host ("sam.gov/opp/…") gets https.
 */
export function normalizeSourceUrl(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  if (!url.hostname.includes(".")) return "";
  const out = url.toString();
  return out.length > SOURCE_URL_MAX ? "" : out;
}

/** Whether a typed link is acceptable (empty is: it clears the link). */
export function sourceUrlProblem(raw: string): string | null {
  if (!raw.trim()) return null;
  return normalizeSourceUrl(raw) ? null : "Use a web address starting with https://.";
}

/**
 * The first web link in pasted text, preferring the given hosts (and their
 * subdomains), e.g. the eBuy or gsa.gov link in a forwarded email.
 */
export function firstLink(text: string, preferHosts: readonly string[] = []): string {
  const found = (text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((u) => normalizeSourceUrl(u.replace(/[.,;:]+$/, ""))).filter(Boolean);
  const onHost = (u: string, h: string) => {
    const host = new URL(u).hostname.toLowerCase();
    return host === h || host.endsWith(`.${h}`);
  };
  for (const h of preferHosts) {
    const hit = found.find((u) => onHost(u, h));
    if (hit) return hit;
  }
  return found[0] ?? "";
}

/** A Scout find's source and link: its SAM.gov page, the portal email's link, or the expiring award. */
export function scoutSourceFields(findSource: string, noticeId: string, uiLink: string): { source: OpportunitySource; sourceUrl: string } {
  if (findSource === "watchlist_award") return { source: "usaspending", sourceUrl: normalizeSourceUrl(uiLink) };
  if (findSource === "portal_email") return { source: "portal_email", sourceUrl: normalizeSourceUrl(uiLink) };
  return { source: "samgov", sourceUrl: samNoticeUrl(noticeId) || normalizeSourceUrl(uiLink) };
}

/** The host shown beside the source ("sam.gov"), or "". */
export function sourceHost(url: string): string {
  const u = normalizeSourceUrl(url);
  return u ? new URL(u).hostname.replace(/^www\./, "") : "";
}
