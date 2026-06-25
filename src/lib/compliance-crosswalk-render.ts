/**
 * BL-FB-CM-GATE — render the compliance crosswalk as HTML for the
 * PDF provider. Used by `renderComplianceCrosswalkAction`.
 *
 * The crosswalk is a one-document Section L/M traceability table:
 * one row per requirement → which proposal section it maps to →
 * status → attached evidence.
 */

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STATUS_TONE: Record<string, { label: string; bg: string; color: string }> = {
  complete: { label: "COMPLETE", bg: "#dcfce7", color: "#166534" },
  partial: { label: "PARTIAL", bg: "#fef3c7", color: "#854d0e" },
  not_addressed: { label: "NOT ADDRESSED", bg: "#fee2e2", color: "#991b1b" },
  not_applicable: { label: "N/A", bg: "#e5e7eb", color: "#374151" },
};

const KIND_LABEL: Record<string, string> = {
  past_performance: "PP",
  knowledge_entry: "KB",
  section_paragraph: "§",
};

export type CrosswalkRenderInput = {
  organization: { name: string };
  proposal: {
    title: string;
    agency: string;
    solicitationNumber: string;
  };
  items: {
    id: string;
    category: string;
    number: string;
    requirementText: string;
    rfpPageReference: string;
    sectionTitle: string | null;
    sectionOrdering: number | null;
    proposalPageReference: string;
    status: string;
    evidence: { kind: string; label: string }[];
  }[];
  generatedAt: Date;
};

export function renderCrosswalkHtml(input: CrosswalkRenderInput): string {
  const stats = {
    total: input.items.length,
    complete: input.items.filter((i) => i.status === "complete").length,
    partial: input.items.filter((i) => i.status === "partial").length,
    notAddressed: input.items.filter((i) => i.status === "not_addressed").length,
    na: input.items.filter((i) => i.status === "not_applicable").length,
  };

  const rows = input.items
    .map((it) => {
      const tone = STATUS_TONE[it.status] ?? STATUS_TONE.not_addressed!;
      const evidenceCell = it.evidence.length === 0
        ? '<span class="muted">—</span>'
        : it.evidence
            .map(
              (e) =>
                `<div class="ev"><span class="ev-kind">${escape(KIND_LABEL[e.kind] ?? e.kind)}</span> ${escape(e.label || "(unnamed)")}</div>`,
            )
            .join("");
      const sectionCell = it.sectionTitle
        ? `${it.sectionOrdering ?? ""}${it.sectionOrdering != null ? ". " : ""}${escape(it.sectionTitle)}`
        : '<span class="muted">unmapped</span>';
      return `
<tr>
  <td class="num">${escape(it.number || "—")}</td>
  <td class="cat">${escape(it.category.replace(/_/g, " "))}</td>
  <td>${escape(it.requirementText)}${it.rfpPageReference ? ` <span class="ref">[${escape(it.rfpPageReference)}]</span>` : ""}</td>
  <td>${sectionCell}${it.proposalPageReference ? ` <span class="ref">p. ${escape(it.proposalPageReference)}</span>` : ""}</td>
  <td><span class="status" style="background:${tone.bg};color:${tone.color}">${tone.label}</span></td>
  <td class="ev-cell">${evidenceCell}</td>
</tr>`.trim();
    })
    .join("\n");

  const generatedAt = input.generatedAt.toISOString().replace("T", " ").slice(0, 16);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Compliance Crosswalk — ${escape(input.proposal.title)}</title>
  <style>
    @page { size: Letter landscape; margin: 0.6in 0.5in; }
    body {
      font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
      font-size: 9pt;
      color: #111;
      line-height: 1.35;
    }
    .header { border-bottom: 1.5pt solid #111; padding-bottom: 8pt; margin-bottom: 12pt; }
    .header h1 { font-size: 14pt; margin: 0 0 4pt; }
    .header .meta { font-size: 8pt; color: #555; }
    .header .meta strong { color: #111; font-weight: 600; }
    .stats { display: table; width: 100%; margin-bottom: 12pt; border-collapse: collapse; }
    .stats .cell { display: table-cell; padding: 6pt 8pt; border: 0.5pt solid #ccc; text-align: center; }
    .stats .cell .num { display: block; font-size: 14pt; font-weight: 700; }
    .stats .cell .lbl { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
    table.matrix { width: 100%; border-collapse: collapse; }
    table.matrix th {
      background: #1f2937; color: #fff;
      text-align: left; padding: 5pt 6pt;
      font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em;
      border: 0.5pt solid #1f2937;
    }
    table.matrix td {
      border: 0.5pt solid #ccc; padding: 5pt 6pt; vertical-align: top;
      page-break-inside: avoid;
    }
    table.matrix tr:nth-child(even) td { background: #fafafa; }
    .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; white-space: nowrap; }
    .cat { font-size: 7.5pt; text-transform: uppercase; color: #555; white-space: nowrap; }
    .ref { display: inline-block; font-family: ui-monospace, monospace; font-size: 7.5pt; color: #555; margin-left: 4pt; }
    .status {
      display: inline-block; font-size: 7.5pt; font-weight: 600;
      padding: 2pt 6pt; border-radius: 2pt;
      text-transform: uppercase; letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .ev { font-size: 7.5pt; margin-bottom: 2pt; }
    .ev:last-child { margin-bottom: 0; }
    .ev-kind {
      display: inline-block; font-family: ui-monospace, monospace;
      font-weight: 700; color: #4338ca; min-width: 1.4em;
    }
    .muted { color: #999; font-style: italic; }
    .footer { margin-top: 12pt; font-size: 7.5pt; color: #777; text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Compliance Crosswalk</h1>
    <div class="meta">
      <strong>${escape(input.proposal.title)}</strong>
      ${input.proposal.agency ? `· ${escape(input.proposal.agency)}` : ""}
      ${input.proposal.solicitationNumber ? `· Solicitation ${escape(input.proposal.solicitationNumber)}` : ""}
      · Prepared by <strong>${escape(input.organization.name)}</strong>
      · Generated ${escape(generatedAt)} UTC
    </div>
  </div>

  <div class="stats">
    <div class="cell"><span class="num">${stats.total}</span><span class="lbl">Total</span></div>
    <div class="cell" style="color:#166534"><span class="num">${stats.complete}</span><span class="lbl">Complete</span></div>
    <div class="cell" style="color:#854d0e"><span class="num">${stats.partial}</span><span class="lbl">Partial</span></div>
    <div class="cell" style="color:#991b1b"><span class="num">${stats.notAddressed}</span><span class="lbl">Not addressed</span></div>
    <div class="cell" style="color:#374151"><span class="num">${stats.na}</span><span class="lbl">N/A</span></div>
  </div>

  <table class="matrix">
    <thead>
      <tr>
        <th style="width:7%">#</th>
        <th style="width:8%">Cat.</th>
        <th style="width:34%">Requirement</th>
        <th style="width:18%">Proposal section</th>
        <th style="width:11%">Status</th>
        <th style="width:22%">Evidence</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" style="text-align:center;padding:14pt;color:#777">No compliance items recorded yet.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    Compliance crosswalk generated by FORGE — keep with the proposal submission package as evidence of Section L/M traceability.
  </div>
</body>
</html>`;
}
