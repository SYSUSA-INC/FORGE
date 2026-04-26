import type { TemplateSectionSeed, ProposalTemplate } from "@/db/schema";

/**
 * Three starter templates we ship in seed data so a new org can pick a
 * sensible default on day one. These are stored in code (not the DB)
 * because they're intended as a baseline; orgs can clone-and-edit
 * them via the Templates page or build their own from scratch.
 */

export type StarterTemplate = Pick<
  ProposalTemplate,
  | "name"
  | "description"
  | "coverHtml"
  | "headerHtml"
  | "footerHtml"
  | "pageCss"
  | "sectionSeed"
  | "brandPrimary"
  | "brandAccent"
  | "fontDisplay"
  | "fontBody"
  | "logoUrl"
>;

const CIVILIAN_SECTIONS: TemplateSectionSeed[] = [
  { kind: "executive_summary", title: "Executive Summary", ordering: 1, pageLimit: 2 },
  { kind: "technical", title: "Technical Approach", ordering: 2, pageLimit: 25 },
  { kind: "management", title: "Management Approach", ordering: 3, pageLimit: 15 },
  { kind: "past_performance", title: "Past Performance", ordering: 4, pageLimit: 10 },
  { kind: "pricing", title: "Price Volume", ordering: 5, pageLimit: null },
  { kind: "compliance", title: "Compliance Matrix", ordering: 6, pageLimit: null },
];

const DOD_SECTIONS: TemplateSectionSeed[] = [
  { kind: "executive_summary", title: "Executive Summary", ordering: 1, pageLimit: 2 },
  { kind: "technical", title: "Volume I — Technical / Mission Capability", ordering: 2, pageLimit: 30 },
  { kind: "management", title: "Volume II — Management & Staffing", ordering: 3, pageLimit: 20 },
  { kind: "past_performance", title: "Volume III — Past Performance", ordering: 4, pageLimit: 15 },
  { kind: "pricing", title: "Volume IV — Cost / Price", ordering: 5, pageLimit: null },
  { kind: "compliance", title: "Compliance Matrix", ordering: 6, pageLimit: null },
];

const BLANK_SECTIONS: TemplateSectionSeed[] = [
  { kind: "executive_summary", title: "Executive Summary", ordering: 1, pageLimit: null },
];

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Civilian — Standard",
    description:
      "Six-section civilian agency baseline (GSA / NSF / DOI / etc.). Page caps tuned for typical Section L. Use as-is or fork.",
    sectionSeed: CIVILIAN_SECTIONS,
    coverHtml: defaultCoverHtml(),
    headerHtml: defaultHeaderHtml(),
    footerHtml: defaultFooterHtml(),
    pageCss: defaultPageCss(),
    brandPrimary: "#2DD4BF",
    brandAccent: "#34D399",
    fontDisplay: "Inter",
    fontBody: "Inter",
    logoUrl: "",
  },
  {
    name: "DoD — Standard",
    description:
      "DoD volume-based structure (Vol I Technical, Vol II Management, Vol III Past Perf, Vol IV Cost). Adjusted page caps for typical major-system sols.",
    sectionSeed: DOD_SECTIONS,
    coverHtml: defaultCoverHtml(),
    headerHtml: defaultHeaderHtml(),
    footerHtml: defaultFooterHtml(),
    pageCss: defaultPageCss(),
    brandPrimary: "#1E40AF",
    brandAccent: "#EAB308",
    fontDisplay: "Inter",
    fontBody: "Inter",
    logoUrl: "",
  },
  {
    name: "Blank — Color-team scratch",
    description:
      "Single Executive Summary section. For when the team wants to define structure during pursuit rather than borrow from a template.",
    sectionSeed: BLANK_SECTIONS,
    coverHtml: defaultCoverHtml(),
    headerHtml: defaultHeaderHtml(),
    footerHtml: defaultFooterHtml(),
    pageCss: defaultPageCss(),
    brandPrimary: "#2DD4BF",
    brandAccent: "#EC4899",
    fontDisplay: "Inter",
    fontBody: "Inter",
    logoUrl: "",
  },
];

/**
 * Each helper returns a starting-point HTML/CSS string. Customers fork
 * via the Templates page; the PDF chapter (PR-7c) renders these into
 * the final document via Browserless.
 */
function defaultCoverHtml(): string {
  return `<section class="cover">
  <header>
    <img class="cover-logo" src="{{logoUrl}}" alt="" />
    <div class="cover-org">{{organizationName}}</div>
  </header>
  <h1 class="cover-title">{{proposalTitle}}</h1>
  <div class="cover-meta">
    <div><span>Solicitation</span> <strong>{{solicitationNumber}}</strong></div>
    <div><span>Customer</span> <strong>{{agency}}</strong></div>
    <div><span>Submitted</span> <strong>{{submittedDate}}</strong></div>
  </div>
</section>`;
}

function defaultHeaderHtml(): string {
  return `<div class="page-header">
  <span class="page-header-org">{{organizationName}}</span>
  <span class="page-header-title">{{proposalTitle}}</span>
</div>`;
}

function defaultFooterHtml(): string {
  return `<div class="page-footer">
  <span class="page-footer-classification">UNCLASSIFIED</span>
  <span class="page-footer-num">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
}

function defaultPageCss(): string {
  return `@page {
  size: Letter;
  margin: 1in 0.85in 1in 0.85in;
  @top-center { content: element(pageHeader); }
  @bottom-center { content: element(pageFooter); }
}

body {
  font-family: var(--font-body, "Inter"), system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  color: #111;
}

h1, h2, h3 {
  font-family: var(--font-display, "Inter"), system-ui, sans-serif;
  color: var(--brand-primary, #2DD4BF);
  page-break-after: avoid;
}

.cover {
  page-break-after: always;
  min-height: 9in;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.cover header { display: flex; align-items: center; gap: 16px; margin-bottom: 64px; }
.cover-logo { height: 48px; width: auto; }
.cover-org { font-size: 11pt; letter-spacing: 0.18em; text-transform: uppercase; color: var(--brand-primary, #2DD4BF); }
.cover-title { font-size: 32pt; line-height: 1.15; margin: 0 0 32px 0; }
.cover-meta { font-size: 10pt; }
.cover-meta div { margin-bottom: 4px; }
.cover-meta span { color: #666; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 8.5pt; }

.page-header, .page-footer {
  font-size: 8.5pt;
  color: #666;
  display: flex;
  justify-content: space-between;
  border-bottom: 0.5pt solid #ccc;
  padding-bottom: 4pt;
}
.page-footer { border-top: 0.5pt solid #ccc; border-bottom: none; padding-top: 4pt; }
`;
}
