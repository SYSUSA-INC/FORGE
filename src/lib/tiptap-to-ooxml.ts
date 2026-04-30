/**
 * Convert a TipTap document to a string of Word OOXML paragraphs.
 *
 * docxtemplater supports raw XML injection via the `@` prefix:
 *   `{@bodyXml}` injects the value verbatim (no escaping).
 *
 * We emit `<w:p>...</w:p>` blocks with paragraph properties (`w:pPr`)
 * for headings + lists, and runs (`w:r`) with run properties (`w:rPr`)
 * for bold/italic/underline. Style references (e.g. `Heading1`,
 * `ListBullet`) lean on Word's built-in styles — corporate templates
 * almost always have these defined, and Word falls back gracefully
 * when they don't.
 *
 * What we handle:
 *   - paragraph
 *   - heading (h1-h6 → Heading1..Heading6)
 *   - bulletList / orderedList (top-level, simple flat items)
 *   - blockquote
 *   - codeBlock (mono-styled paragraph)
 *   - hardBreak
 *   - bold / italic / underline / code (inline marks)
 *   - text with line breaks
 *   - simple tables (rows + cells; no merging)
 *
 * What we drop or approximate:
 *   - hyperlinks (text only)
 *   - images (text placeholder "[image]")
 *   - nested lists (flatten to one level)
 */
import type { TipTapDoc, TipTapNode } from "@/db/schema";

export function tiptapDocToOoxml(doc: TipTapDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return emptyParagraph();
  const out: string[] = [];
  for (const node of doc.content) {
    walkBlock(node, out, 0);
  }
  if (out.length === 0) return emptyParagraph();
  return out.join("");
}

function walkBlock(node: TipTapNode, out: string[], listDepth: number): void {
  switch (node.type) {
    case "paragraph":
      out.push(paragraph(runsFromInline(node.content ?? [])));
      return;
    case "heading": {
      const level = clampHeadingLevel(node.attrs?.level);
      out.push(
        paragraph(runsFromInline(node.content ?? []), {
          styleId: `Heading${level}`,
        }),
      );
      return;
    }
    case "blockquote":
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          // Style each child paragraph as Quote.
          if (child.type === "paragraph") {
            out.push(
              paragraph(runsFromInline(child.content ?? []), {
                styleId: "Quote",
              }),
            );
          } else {
            walkBlock(child, out, listDepth);
          }
        }
      }
      return;
    case "codeBlock":
      out.push(
        paragraph(runsFromInline(node.content ?? [], { code: true }), {
          styleId: "VerbatimChar",
        }),
      );
      return;
    case "horizontalRule":
      out.push(
        `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`,
      );
      return;
    case "bulletList":
    case "orderedList":
      if (Array.isArray(node.content)) {
        const styleId =
          node.type === "orderedList" ? "ListNumber" : "ListBullet";
        for (const item of node.content) {
          // Each listItem typically wraps one or more paragraphs.
          if (item.type === "listItem" && Array.isArray(item.content)) {
            for (const child of item.content) {
              if (child.type === "paragraph") {
                out.push(
                  paragraph(runsFromInline(child.content ?? []), { styleId }),
                );
              } else {
                walkBlock(child, out, listDepth + 1);
              }
            }
          } else {
            walkBlock(item, out, listDepth);
          }
        }
      }
      return;
    case "table":
      out.push(tableXml(node));
      return;
    default:
      // Unknown block — recurse defensively into children if any,
      // otherwise drop.
      if (Array.isArray(node.content)) {
        for (const child of node.content) walkBlock(child, out, listDepth);
      }
      return;
  }
}

type ActiveMarks = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  strike?: boolean;
};

function runsFromInline(
  nodes: TipTapNode[],
  forced: ActiveMarks = {},
): string {
  const runs: string[] = [];
  for (const n of nodes) {
    runs.push(...inlineToRuns(n, forced));
  }
  if (runs.length === 0) return emptyRun();
  return runs.join("");
}

function inlineToRuns(node: TipTapNode, forced: ActiveMarks): string[] {
  if (node.type === "hardBreak") return [`<w:r><w:br/></w:r>`];

  if (node.type === "text" && typeof node.text === "string") {
    const marks = mergeMarks(forced, node.marks ?? []);
    return splitTextOnNewlines(node.text).map((segment, i) => {
      if (segment === "\n") return `<w:r><w:br/></w:r>`;
      return runWithText(segment, marks);
    });
  }

  // Inline wrapper (e.g. link). Walk children carrying any inherited
  // marks; we don't emit anchor markup in v1.
  if (Array.isArray(node.content)) {
    const out: string[] = [];
    for (const child of node.content) {
      out.push(...inlineToRuns(child, forced));
    }
    return out;
  }

  return [];
}

function mergeMarks(base: ActiveMarks, marks: { type: string }[]): ActiveMarks {
  const out: ActiveMarks = { ...base };
  for (const m of marks) {
    if (m.type === "bold") out.bold = true;
    else if (m.type === "italic") out.italic = true;
    else if (m.type === "underline") out.underline = true;
    else if (m.type === "code") out.code = true;
    else if (m.type === "strike") out.strike = true;
  }
  return out;
}

/**
 * Split on newlines so we can emit `<w:br/>` between segments. Word
 * doesn't honour `\n` inside a `<w:t>` even with xml:space="preserve".
 */
function splitTextOnNewlines(text: string): string[] {
  if (!text.includes("\n")) return [text];
  const out: string[] = [];
  const parts = text.split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push("\n");
    if (parts[i]!.length > 0) out.push(parts[i]!);
  }
  return out;
}

function runWithText(text: string, marks: ActiveMarks): string {
  const escaped = escapeXml(text);
  const props: string[] = [];
  if (marks.bold) props.push(`<w:b/>`);
  if (marks.italic) props.push(`<w:i/>`);
  if (marks.underline) props.push(`<w:u w:val="single"/>`);
  if (marks.strike) props.push(`<w:strike/>`);
  if (marks.code) {
    props.push(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`);
    props.push(`<w:sz w:val="20"/>`);
  }
  const rPr = props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r>`;
}

function paragraph(
  runsXml: string,
  opts: { styleId?: string } = {},
): string {
  const props: string[] = [];
  if (opts.styleId) {
    props.push(`<w:pStyle w:val="${opts.styleId}"/>`);
  }
  const pPr = props.length > 0 ? `<w:pPr>${props.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runsXml}</w:p>`;
}

function emptyParagraph(): string {
  return `<w:p></w:p>`;
}

function emptyRun(): string {
  return `<w:r><w:t xml:space="preserve"></w:t></w:r>`;
}

function clampHeadingLevel(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(6, Math.max(1, Math.floor(n)));
}

function tableXml(node: TipTapNode): string {
  // Each row → `<w:tr>`; each cell → `<w:tc>` with at least one
  // paragraph inside (Word requires a child paragraph in every cell).
  if (!Array.isArray(node.content)) return "";
  const rows: string[] = [];
  for (const row of node.content) {
    if (!Array.isArray(row.content)) continue;
    const cells: string[] = [];
    for (const cell of row.content) {
      const inner: string[] = [];
      if (Array.isArray(cell.content)) {
        for (const child of cell.content) {
          walkBlock(child, inner, 0);
        }
      }
      if (inner.length === 0) inner.push(emptyParagraph());
      cells.push(`<w:tc><w:tcPr/>${inner.join("")}</w:tc>`);
    }
    rows.push(`<w:tr>${cells.join("")}</w:tr>`);
  }
  // Minimal table properties; Word picks sensible defaults.
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid/>${rows.join("")}</w:tbl>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
