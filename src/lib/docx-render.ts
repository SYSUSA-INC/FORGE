/**
 * Render a proposal into a .docx using a Word template the user has
 * uploaded in Phase 12a.
 *
 *   template.docx + data dict --[docxtemplater]--> proposal.docx
 *
 * The data dict is built from the proposal, its opportunity, and the
 * organization. Section bodies are flattened to plain text in v1 —
 * Phase 12c will wire a TipTap-doc-to-Word converter for headings,
 * lists, bold/italic, and tables.
 *
 * docxtemplater uses single-brace delimiters: {organizationName}.
 * That's what the cheat sheet in the editor advertises.
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type {
  Opportunity,
  Organization,
  Proposal,
  ProposalSection,
  ProposalTemplate,
  TipTapDoc,
  TipTapNode,
} from "@/db/schema";

export type DocxRenderInput = {
  template: ProposalTemplate;
  templateBytes: Uint8Array;
  proposal: Proposal;
  opportunity: Opportunity;
  organization: Organization;
  sections: ProposalSection[];
};

export type DocxRenderResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

export function renderProposalToDocx(input: DocxRenderInput): DocxRenderResult {
  // Build the substitution dict. Keys match the catalog in
  // src/lib/docx-template.ts → KNOWN_TEMPLATE_VARIABLES.
  const data = buildTemplateData(input);

  let zip: PizZip;
  try {
    zip = new PizZip(input.templateBytes);
  } catch (err) {
    return {
      ok: false,
      error:
        "Could not read the uploaded Word template. Re-upload it on the template settings page. (" +
        (err instanceof Error ? err.message : "unknown") +
        ")",
    };
  }

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Single-brace delimiters — what we advertise to users.
      delimiters: { start: "{", end: "}" },
      // If a placeholder isn't in the data dict, leave it as-is in the
      // output. That way users see exactly what didn't substitute and
      // can fix the template; the alternative (default null) silently
      // drops content.
      nullGetter() {
        return "";
      },
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Template could not be loaded: ${err.message}`
          : "Template could not be loaded.",
    };
  }

  try {
    doc.render(data);
  } catch (err) {
    // docxtemplater throws a structured error when a template tag is
    // invalid. Surface the first one to the caller so the user can
    // fix it; raw Error.message is usually a cryptic stack.
    const detail = extractDocxError(err);
    return {
      ok: false,
      error: `Template render failed: ${detail}`,
    };
  }

  const out = doc.getZip().generate({
    type: "uint8array",
    compression: "DEFLATE",
  }) as Uint8Array;

  return { ok: true, bytes: out };
}

function buildTemplateData(input: DocxRenderInput): Record<string, unknown> {
  const { template, proposal, opportunity, organization, sections } = input;

  const submittedDate = (proposal.submittedAt ?? new Date()).toISOString().slice(0, 10);
  const dueDate = opportunity.responseDueDate
    ? opportunity.responseDueDate.toISOString().slice(0, 10)
    : "";

  return {
    // Organization
    organizationName: organization.name,
    organizationAddress: composeAddress(organization),
    organizationUei: organization.uei,
    organizationCage: organization.cageCode,
    organizationDuns: organization.dunsNumber,
    organizationNaics: organization.primaryNaics,
    // The corporate logo URL is on the template (per-brand). Phase 12c
    // can swap this for an embedded image via the docxtemplater image
    // module if needed; for now it just substitutes as a string.
    logoUrl: template.logoUrl,

    // Proposal
    proposalTitle: proposal.title,
    proposalDate: submittedDate,
    submittedDate,

    // Opportunity context
    agency: opportunity.agency,
    office: opportunity.office,
    solicitationNumber: opportunity.solicitationNumber,
    naicsCode: opportunity.naicsCode,
    setAside: opportunity.setAside,
    responseDueDate: dueDate,

    // Primary contact (from organization profile)
    primaryContactName: organization.contactName,
    primaryContactTitle: organization.contactTitle,
    primaryContactPhone: organization.phone,
    primaryContactEmail: organization.email,

    // Sections — used by the loop pattern
    // {#sections}{title}{body}{/sections}
    sections: sections
      .slice()
      .sort((a, b) => a.ordering - b.ordering)
      .map((s) => ({
        title: s.title,
        body: tiptapDocToPlainText(s.bodyDoc as TipTapDoc),
        kind: s.kind,
        ordering: s.ordering,
      })),
  };
}

function composeAddress(org: Organization): string {
  const lines = [
    org.addressLine1,
    org.addressLine2,
    [org.city, org.state, org.zip].filter(Boolean).join(", "),
    org.country !== "USA" ? org.country : "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.join("\n");
}

/**
 * Flatten a TipTap document to plain text. We preserve paragraph
 * breaks (so Word's linebreaks: true option turns them into real
 * paragraphs) but drop formatting marks. Phase 12c replaces this
 * with a converter that emits proper Word runs and styles.
 */
function tiptapDocToPlainText(doc: TipTapDoc | null | undefined): string {
  if (!doc || !doc.content) return "";
  const lines: string[] = [];
  for (const node of doc.content) {
    walk(node, lines);
  }
  // Collapse 3+ newlines to 2 — keep paragraph breaks but no big gaps.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function walk(node: TipTapNode, lines: string[]): void {
  switch (node.type) {
    case "paragraph":
    case "heading":
      lines.push(textOf(node));
      lines.push(""); // blank line between block elements
      break;
    case "bulletList":
    case "orderedList":
      if (Array.isArray(node.content)) {
        let i = 1;
        for (const item of node.content) {
          const prefix = node.type === "orderedList" ? `${i}. ` : "• ";
          const itemText = textOf(item).split("\n").join(" ").trim();
          if (itemText) lines.push(prefix + itemText);
          i += 1;
        }
        lines.push("");
      }
      break;
    case "blockquote":
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          const t = textOf(child).trim();
          if (t) lines.push("> " + t);
        }
        lines.push("");
      }
      break;
    case "codeBlock":
      lines.push(textOf(node));
      lines.push("");
      break;
    case "horizontalRule":
      lines.push("---");
      lines.push("");
      break;
    case "table":
      // Tables flatten to TSV-ish so the data isn't lost. 12c will
      // emit real Word tables.
      if (Array.isArray(node.content)) {
        for (const row of node.content) {
          if (!Array.isArray(row.content)) continue;
          const cells = row.content.map((cell) =>
            textOf(cell).replace(/\n/g, " ").trim(),
          );
          lines.push(cells.join("\t"));
        }
        lines.push("");
      }
      break;
    default:
      // Unknown block — recurse defensively.
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child, lines);
      }
  }
}

function textOf(node: TipTapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map((c) => textOf(c)).join("");
}

function extractDocxError(err: unknown): string {
  if (!err) return "unknown error";
  // docxtemplater errors carry .properties.errors[].
  const e = err as {
    properties?: { errors?: Array<{ message?: string; properties?: { explanation?: string } }> };
    message?: string;
  };
  const first = e.properties?.errors?.[0];
  if (first) {
    return (
      first.properties?.explanation ?? first.message ?? "template syntax error"
    );
  }
  return e.message ?? "render failed";
}
