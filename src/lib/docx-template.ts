/**
 * Helpers for the DOCX template path.
 *
 * Phase 12a: parse an uploaded .docx file and extract the placeholder
 * variables it contains so we can show the user which substitutions
 * the template understands. We don't run docxtemplater here — that
 * lands in 12b when we wire actual rendering. For now we just need to
 * walk the document XML and pull out anything between single curly
 * braces (the docxtemplater default delimiters).
 *
 * docxtemplater splits text runs across XML elements when Word
 * fragments a paragraph internally, so a placeholder like
 * `{organizationName}` can land as `<w:t>{org</w:t><w:t>aniz</w:t>...`
 * across many runs. We strip XML tags first and join everything before
 * scanning, which gives us the same continuous text the templater sees.
 */

const DOCX_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

export function isLikelyDocx(contentType: string, fileName: string): boolean {
  if (DOCX_MEDIA_TYPES.includes((contentType || "").toLowerCase())) return true;
  return fileName.toLowerCase().endsWith(".docx");
}

export type DocxScanResult = {
  variables: string[];
  /** Paths inside the zip that contained at least one placeholder. */
  parts: string[];
  warnings: string[];
};

/**
 * Walk the .docx file (it's a ZIP of XML) and collect every distinct
 * `{variable}` placeholder. We scan document.xml, headers, footers,
 * and footnotes — anywhere docxtemplater would substitute on render.
 */
export async function scanDocxForVariables(
  bytes: Uint8Array,
): Promise<DocxScanResult> {
  const JSZip = (await import("jszip")).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return {
      variables: [],
      parts: [],
      warnings: [
        `Could not read the file as a .docx — is it actually a Word document? (${err instanceof Error ? err.message : "unknown error"})`,
      ],
    };
  }

  // Targets we care about — the rest of the zip is styles/relationships.
  const targets = Object.keys(zip.files).filter(
    (p) =>
      !zip.files[p]!.dir &&
      (p === "word/document.xml" ||
        /^word\/header\d+\.xml$/.test(p) ||
        /^word\/footer\d+\.xml$/.test(p) ||
        p === "word/footnotes.xml" ||
        p === "word/endnotes.xml" ||
        p === "word/comments.xml"),
  );

  const variables = new Set<string>();
  const partsWithVars = new Set<string>();
  const warnings: string[] = [];

  for (const path of targets) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    // Strip XML tags so split runs collapse into continuous text.
    const text = xml.replace(/<[^>]+>/g, "");
    // Pull every {placeholder}. Reject obviously malformed ones (whitespace
    // or punctuation inside the braces). docxtemplater also supports loop
    // constructs like {#sections}…{/sections} — we surface those bare too.
    const re = /\{(#?[\/\^]?[A-Za-z0-9_.\- ]+)\}/g;
    let match: RegExpExecArray | null;
    let foundAny = false;
    while ((match = re.exec(text)) !== null) {
      const raw = (match[1] ?? "").trim();
      if (!raw) continue;
      foundAny = true;
      variables.add(raw);
    }
    if (foundAny) partsWithVars.add(path);
  }

  // Heuristics — give the user a heads-up about common authoring mistakes.
  if (variables.size === 0) {
    warnings.push(
      "No {placeholder} variables were detected. If you intended to put placeholders in the template, make sure they use single curly braces (e.g. {organizationName}, not {{organizationName}}).",
    );
  }
  for (const v of variables) {
    if (v.includes(" ")) {
      warnings.push(
        `Placeholder "${v}" contains a space — Word may have split it into separate runs. Re-type it without breaks if substitution fails.`,
      );
    }
  }

  return {
    variables: Array.from(variables).sort(),
    parts: Array.from(partsWithVars).sort(),
    warnings,
  };
}

/**
 * The substitution variables FORGE knows how to fill in automatically
 * when rendering. Anything in a template OUTSIDE this set will be
 * surfaced in the UI as "you'll need to fill this manually after
 * download" so the user isn't surprised.
 */
export const KNOWN_TEMPLATE_VARIABLES: { key: string; description: string }[] = [
  { key: "organizationName", description: "Your company's legal name" },
  { key: "organizationAddress", description: "Mailing address" },
  { key: "organizationUei", description: "SAM.gov UEI" },
  { key: "organizationCage", description: "CAGE code" },
  { key: "organizationDuns", description: "DUNS (legacy)" },
  { key: "organizationNaics", description: "Primary NAICS code" },
  { key: "logoUrl", description: "Corporate logo URL (image)" },

  { key: "proposalTitle", description: "Proposal title" },
  { key: "proposalDate", description: "Submission date (formatted)" },
  { key: "submittedDate", description: "Alias of proposalDate" },

  { key: "agency", description: "Issuing agency" },
  { key: "office", description: "Issuing office" },
  { key: "solicitationNumber", description: "Solicitation / RFP number" },
  { key: "naicsCode", description: "Solicitation NAICS code" },
  { key: "setAside", description: "Set-aside designation" },
  { key: "responseDueDate", description: "Response due date" },

  { key: "primaryContactName", description: "Primary point of contact" },
  { key: "primaryContactTitle", description: "POC title" },
  { key: "primaryContactPhone", description: "POC phone" },
  { key: "primaryContactEmail", description: "POC email" },

  {
    key: "sections",
    description:
      "Loop variable. Use {body} for plain text or {@bodyXml} for rich Word formatting (headings, bold, lists).",
  },
  {
    key: "title",
    description:
      "Inside {#sections}…{/sections}: the section title (escape-safe).",
  },
  {
    key: "body",
    description:
      "Inside {#sections}…{/sections}: plain-text body (escape-safe).",
  },
  {
    key: "@bodyXml",
    description:
      "Inside {#sections}…{/sections}: rich Word body — preserves headings, bold/italic, and lists.",
  },
];

/**
 * Split detected variables into "we can fill this" vs "user fills".
 * Loop tokens like #sections, /sections, ^foo are bucketed as known
 * because they're structural, not data fields.
 */
export function classifyDetectedVariables(detected: string[]): {
  recognized: string[];
  unrecognized: string[];
} {
  const known = new Set(KNOWN_TEMPLATE_VARIABLES.map((v) => v.key));
  const recognized: string[] = [];
  const unrecognized: string[] = [];

  for (const v of detected) {
    // Loop control tokens — strip the leading sigil and check root.
    const trimmed = v.replace(/^[#\/^]/, "");
    if (known.has(trimmed)) recognized.push(v);
    else unrecognized.push(v);
  }

  return { recognized, unrecognized };
}
