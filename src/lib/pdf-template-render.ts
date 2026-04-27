/**
 * Compose a proposal's sections + the chosen template into a single
 * HTML document suitable for handing to the PDF provider.
 */
import type {
  Organization,
  Proposal,
  ProposalSection,
  ProposalTemplate,
} from "@/db/schema";
import { renderDocToHtml } from "@/lib/tiptap-html";

export type RenderInput = {
  organization: Pick<Organization, "id" | "name" | "uei" | "cageCode">;
  proposal: Pick<Proposal, "id" | "title" | "submittedAt"> & {
    agency: string;
    solicitationNumber: string;
  };
  sections: Pick<
    ProposalSection,
    "id" | "title" | "ordering" | "bodyDoc" | "status" | "wordCount" | "kind"
  >[];
  template: Pick<
    ProposalTemplate,
    | "name"
    | "coverHtml"
    | "headerHtml"
    | "footerHtml"
    | "pageCss"
    | "brandPrimary"
    | "brandAccent"
    | "fontDisplay"
    | "fontBody"
    | "logoUrl"
  > | null;
};

const FALLBACK_PAGE_CSS = `
@page { size: Letter; margin: 1in 0.85in 1in 0.85in; }
body { font-family: var(--font-body, "Inter"), system-ui, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
h1, h2, h3 { font-family: var(--font-display, "Inter"), system-ui, sans-serif; color: var(--brand-primary, #2DD4BF); page-break-after: avoid; }
section.proposal-section { page-break-before: always; }
section.proposal-section:first-of-type { page-break-before: avoid; }
section.proposal-section h1 { margin-top: 0; }
.section-meta { font-size: 8.5pt; color: #666; margin-bottom: 12pt; text-transform: uppercase; letter-spacing: 0.08em; }
ul, ol { padding-left: 1.4em; }
blockquote { border-left: 2pt solid var(--brand-primary, #2DD4BF); padding-left: 12pt; color: #444; margin: 12pt 0; }
table { width: 100%; border-collapse: collapse; margin: 12pt 0; }
th, td { border: 0.5pt solid #999; padding: 4pt 6pt; vertical-align: top; }
th { background: #f0f0f0; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; }
img { max-width: 100%; }
hr { border: 0; border-top: 0.5pt solid #999; margin: 12pt 0; }
code { font-family: var(--font-mono, "JetBrains Mono"), monospace; font-size: 9.5pt; background: #f5f5f5; padding: 0 2pt; }
pre { background: #f5f5f5; padding: 8pt; border: 0.5pt solid #ddd; font-family: var(--font-mono, "JetBrains Mono"), monospace; font-size: 9pt; }
`;

const FALLBACK_COVER = `
<section class="cover">
  <h1 class="cover-title">{{proposalTitle}}</h1>
  <div class="cover-meta">
    <div><span>Customer</span> <strong>{{agency}}</strong></div>
    <div><span>Solicitation</span> <strong>{{solicitationNumber}}</strong></div>
    <div><span>Submitted by</span> <strong>{{organizationName}}</strong></div>
    <div><span>Submitted</span> <strong>{{submittedDate}}</strong></div>
  </div>
</section>`;

export function renderProposalHtml(input: RenderInput): string {
  const t = input.template;
  const vars: Record<string, string> = {
    organizationName: input.organization.name,
    organizationUei: input.organization.uei ?? "",
    organizationCage: input.organization.cageCode ?? "",
    proposalTitle: input.proposal.title,
    solicitationNumber: input.proposal.solicitationNumber || "—",
    agency: input.proposal.agency || "—",
    submittedDate: input.proposal.submittedAt
      ? new Date(input.proposal.submittedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    logoUrl: t?.logoUrl ?? "",
  };

  const brandPrimary = t?.brandPrimary ?? "#2DD4BF";
  const brandAccent = t?.brandAccent ?? "#EC4899";
  const fontDisplay = t?.fontDisplay ?? "Inter";
  const fontBody = t?.fontBody ?? "Inter";

  const cover = substitute(t?.coverHtml || FALLBACK_COVER, vars);
  const headerHtml = substitute(t?.headerHtml ?? "", vars);
  const footerHtml = substitute(t?.footerHtml ?? "", vars);
  const pageCss = t?.pageCss || FALLBACK_PAGE_CSS;

  const sortedSections = [...input.sections].sort(
    (a, b) => a.ordering - b.ordering,
  );

  const sectionsHtml = sortedSections
    .map((s) => {
      const body = renderDocToHtml(s.bodyDoc) || "<p><em>No content yet.</em></p>";
      return `<section class="proposal-section" data-section-id="${s.id}">
  <h1>${escapeHtml(s.title)}</h1>
  <div class="section-meta">§${s.ordering} · ${escapeHtml(humanKind(s.kind))} · ${s.wordCount} words</div>
  ${body}
</section>`;
    })
    .join("\n");

  const styleVars = `
  :root {
    --brand-primary: ${brandPrimary};
    --brand-accent: ${brandAccent};
    --font-display: "${fontDisplay}", "Inter", system-ui, sans-serif;
    --font-body: "${fontBody}", "Inter", system-ui, sans-serif;
  }`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.proposal.title)}</title>
  <style>
${styleVars}
${pageCss}

/* Running headers/footers — kept simple in v1. */
.page-header-inline { display: none; }
.page-footer-inline { display: none; }
@media print {
  .page-header-inline { display: block; position: running(pageHeader); }
  .page-footer-inline { display: block; position: running(pageFooter); }
}
  </style>
</head>
<body>
  ${headerHtml ? `<div class="page-header-inline">${headerHtml}</div>` : ""}
  ${footerHtml ? `<div class="page-footer-inline">${footerHtml}</div>` : ""}
  ${cover}
  ${sectionsHtml}
</body>
</html>`;
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/{{\s*([\w]+)\s*}}/g, (_full, key: string) => {
    const v = vars[key];
    return v === undefined ? "" : escapeHtml(v);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanKind(k: string): string {
  switch (k) {
    case "executive_summary":
      return "Executive Summary";
    case "technical":
      return "Technical";
    case "management":
      return "Management";
    case "past_performance":
      return "Past Performance";
    case "pricing":
      return "Pricing";
    case "compliance":
      return "Compliance";
    default:
      return k;
  }
}
