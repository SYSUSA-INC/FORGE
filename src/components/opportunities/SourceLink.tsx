import { normalizeSourceUrl, sourceHost, sourceLabel } from "@/lib/opportunity-source";

/**
 * BL-OPP-SOURCE — the link back to where an opportunity came from, on
 * every list that shows it (owner, 2026-11-07: "we need the source link
 * at every stage"), styled like Scout's "notice ↗". Nothing without a link.
 */
export function SourceLink({ source, url, className = "" }: { source: string; url: string; className?: string }) {
  const href = normalizeSourceUrl(url);
  if (!href) return null;
  const label = source === "samgov" ? "notice" : source === "usaspending" ? "award" : sourceHost(href);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`Open on ${sourceLabel(source)} (${sourceHost(href)})`} className={`normal-case tracking-normal text-cobalt hover:underline ${className}`}>
      {label} ↗
    </a>
  );
}
