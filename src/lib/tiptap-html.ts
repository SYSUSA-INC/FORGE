/**
 * Server-side TipTap doc → HTML renderer.
 *
 * We deliberately don't pull in @tiptap/html (which needs all the
 * editor extensions on the server) — instead we walk the JSON tree
 * and emit safe HTML directly, which keeps the PDF render path
 * dependency-free.
 *
 * Covers the node + mark types our editor produces (StarterKit +
 * Underline, Link, Image, Table, Placeholder).
 */
import type { TipTapDoc, TipTapNode } from "@/db/schema";

export function renderDocToHtml(doc: TipTapDoc | null | undefined): string {
  if (!doc?.content?.length) return "";
  return doc.content.map(nodeToHtml).join("");
}

function nodeToHtml(node: TipTapNode): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${childrenToHtml(node)}</p>`;
    case "heading": {
      const level = clampLevel(node.attrs?.level);
      return `<h${level}>${childrenToHtml(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${childrenToHtml(node)}</blockquote>`;
    case "bulletList":
      return `<ul>${childrenToHtml(node)}</ul>`;
    case "orderedList":
      return `<ol>${childrenToHtml(node)}</ol>`;
    case "listItem":
      return `<li>${childrenToHtml(node)}</li>`;
    case "codeBlock":
      return `<pre><code>${escapeText(plainText(node))}</code></pre>`;
    case "horizontalRule":
      return `<hr />`;
    case "hardBreak":
      return `<br />`;
    case "image": {
      const src = stringAttr(node.attrs?.src);
      const alt = stringAttr(node.attrs?.alt);
      const title = stringAttr(node.attrs?.title);
      if (!src) return "";
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${
        title ? ` title="${escapeAttr(title)}"` : ""
      } />`;
    }
    case "table":
      return `<table>${childrenToHtml(node)}</table>`;
    case "tableRow":
      return `<tr>${childrenToHtml(node)}</tr>`;
    case "tableHeader":
      return `<th>${childrenToHtml(node)}</th>`;
    case "tableCell":
      return `<td>${childrenToHtml(node)}</td>`;
    case "text":
      return applyMarks(node.marks ?? [], escapeText(node.text ?? ""));
    default:
      // Unknown node: render its children if any, else nothing.
      if (node.content?.length) return childrenToHtml(node);
      return "";
  }
}

function childrenToHtml(node: TipTapNode): string {
  return (node.content ?? []).map(nodeToHtml).join("");
}

function plainText(node: TipTapNode): string {
  if (node.type === "text") return node.text ?? "";
  if (!node.content) return "";
  return node.content.map(plainText).join("");
}

function applyMarks(
  marks: { type: string; attrs?: Record<string, unknown> }[],
  inner: string,
): string {
  let result = inner;
  for (const m of marks) {
    switch (m.type) {
      case "bold":
        result = `<strong>${result}</strong>`;
        break;
      case "italic":
        result = `<em>${result}</em>`;
        break;
      case "underline":
        result = `<u>${result}</u>`;
        break;
      case "strike":
        result = `<s>${result}</s>`;
        break;
      case "code":
        result = `<code>${result}</code>`;
        break;
      case "link": {
        const href = stringAttr(m.attrs?.href) ?? "";
        if (!href) break;
        const safeHref = sanitizeHref(href);
        result = `<a href="${escapeAttr(safeHref)}" rel="noopener noreferrer">${result}</a>`;
        break;
      }
      default:
        // Unknown mark: pass through.
        break;
    }
  }
  return result;
}

function clampLevel(level: unknown): 1 | 2 | 3 {
  const n = typeof level === "number" ? level : Number(level ?? 1);
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return 2;
}

function stringAttr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function sanitizeHref(href: string): string {
  // Block javascript: / data: / vbscript: scheme injection in user-authored links.
  const trimmed = href.trim();
  if (/^(javascript:|vbscript:|data:)/i.test(trimmed)) return "#";
  return trimmed;
}
