import type { TipTapDoc, TipTapNode } from "@/db/schema";

export const EMPTY_DOC: TipTapDoc = { type: "doc", content: [] };

/**
 * Wrap a plain-text body in a minimal TipTap doc so backfilled
 * sections (and any non-rich callers) can still round-trip through
 * the rich editor.
 */
export function fromPlainText(text: string): TipTapDoc {
  const trimmed = text.trim();
  if (!trimmed) return EMPTY_DOC;
  const paragraphs = trimmed
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

/**
 * Project a TipTap doc back to plain text so existing search,
 * compliance previews, AI prompts, and section rollups keep working
 * without changes. Block-level nodes are joined with double newlines;
 * inline text/code is concatenated within a block.
 */
export function projectToPlain(doc: TipTapDoc | null | undefined): string {
  if (!doc?.content?.length) return "";
  return doc.content
    .map(blockToText)
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

function blockToText(node: TipTapNode): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
      return inlineToText(node.content ?? []);
    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((li, i) => {
          const text = inlineToText(
            li.content?.flatMap((c) => c.content ?? []) ?? [],
          );
          const bullet = node.type === "orderedList" ? `${i + 1}.` : "•";
          return text ? `${bullet} ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
    case "table":
      return (node.content ?? [])
        .map((row) =>
          (row.content ?? [])
            .map((cell) =>
              inlineToText(cell.content?.flatMap((c) => c.content ?? []) ?? []),
            )
            .join(" | "),
        )
        .join("\n");
    case "horizontalRule":
      return "---";
    case "image": {
      const alt = (node.attrs?.alt as string | undefined) ?? "image";
      return `[${alt}]`;
    }
    default:
      // Unknown block: try to walk its inline content if any.
      return inlineToText(node.content ?? []);
  }
}

function inlineToText(nodes: TipTapNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.text ?? "";
      if (n.type === "hardBreak") return "\n";
      // Nested block → recurse
      return blockToText(n);
    })
    .join("")
    .trim();
}

/**
 * Word count from the projected plain text. Anything that contains
 * at least one alphanumeric character counts as a word.
 */
export function countWords(doc: TipTapDoc | string | null | undefined): number {
  const text = typeof doc === "string" ? doc : projectToPlain(doc);
  if (!text) return 0;
  return text
    .split(/\s+/g)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Cheap structural validation so we don't persist arbitrary JSON to
 * the body_doc column. Returns the input on success or null on failure;
 * call sites should fall back to EMPTY_DOC when it returns null.
 */
export function validateDoc(value: unknown): TipTapDoc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as { type?: unknown; content?: unknown };
  if (doc.type !== "doc") return null;
  if (doc.content !== undefined && !Array.isArray(doc.content)) return null;
  return value as TipTapDoc;
}
