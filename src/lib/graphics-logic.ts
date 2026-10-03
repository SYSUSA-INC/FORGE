/**
 * BL-FB-GEN-GRAPHICS — graphics suggestions for a section, pure parts.
 *
 * A diagram is a small spec (kind, nodes, edges) that the model proposes
 * from the section's own text — or, without a live provider, that a
 * heuristic mines from it. This module validates a spec, draws it as a
 * self-contained SVG (print colours from THEME_HEX, no external fonts
 * or scripts), writes the equivalent Mermaid block and packs the SVG
 * as a data URI the editor's image node can carry. Unit-tested.
 */
import { THEME_HEX } from "@/lib/theme-colors";

export type GraphicKind = "architecture" | "process" | "org" | "timeline";
export type GraphicNode = { id: string; label: string; group?: string };
export type GraphicEdge = { from: string; to: string; label?: string };
export type GraphicSpec = {
  kind: GraphicKind;
  title: string;
  /** One sentence for the panel: why this section benefits. */
  why: string;
  nodes: GraphicNode[];
  edges: GraphicEdge[];
};

export const GRAPHIC_LIMITS = {
  maxSuggestions: 3,
  maxNodes: 12,
  maxEdges: 24,
  maxLabelChars: 40,
  maxTitleChars: 80,
  /** Words a section needs before suggestions are attempted. */
  minWords: 40,
} as const;

export const GRAPHIC_KIND_LABELS: Record<GraphicKind, string> = {
  architecture: "Notional architecture",
  process: "Process flow",
  org: "Organization chart",
  timeline: "Timeline",
};

const KINDS: readonly GraphicKind[] = ["architecture", "process", "org", "timeline"];

export function slugId(label: string, index: number): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return s ? `${s}_${index}` : `n${index}`;
}

function clip(s: unknown, max: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A model's (or heuristic's) raw spec made safe: shape, caps, labels, edge ends. */
export function sanitizeSpec(raw: unknown): GraphicSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.find((k) => k === r.kind);
  if (!kind) return null;
  const title = clip(r.title, GRAPHIC_LIMITS.maxTitleChars);
  const rawNodes = Array.isArray(r.nodes) ? r.nodes : [];
  const ids = new Map<string, string>();
  const nodes: GraphicNode[] = [];
  for (const n of rawNodes) {
    if (!n || typeof n !== "object") continue;
    const nn = n as Record<string, unknown>;
    const label = clip(nn.label, GRAPHIC_LIMITS.maxLabelChars);
    if (!label) continue;
    const given = clip(nn.id, 40) || label;
    if (ids.has(given)) continue;
    const id = slugId(given, nodes.length + 1);
    ids.set(given, id);
    const group = clip(nn.group, GRAPHIC_LIMITS.maxLabelChars);
    nodes.push(group ? { id, label, group } : { id, label });
    if (nodes.length >= GRAPHIC_LIMITS.maxNodes) break;
  }
  if (nodes.length < 2 || !title) return null;
  const rawEdges = Array.isArray(r.edges) ? r.edges : [];
  const edges: GraphicEdge[] = [];
  const seen = new Set<string>();
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue;
    const ee = e as Record<string, unknown>;
    const from = ids.get(clip(ee.from, 40));
    const to = ids.get(clip(ee.to, 40));
    if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    const label = clip(ee.label, GRAPHIC_LIMITS.maxLabelChars);
    edges.push(label ? { from, to, label } : { from, to });
    if (edges.length >= GRAPHIC_LIMITS.maxEdges) break;
  }
  return { kind, title, why: clip(r.why, 240), nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────
// Heuristic proposals (stub mode, or when the model returns nothing)
// ─────────────────────────────────────────────────────────────────────

const STEP_LINE = /^\s*(?:step\s*)?(\d{1,2})[.):]\s+(.{6,})$/i;
const SEQUENCE_WORD = /\b(first|second|third|then|next|after that|finally|lastly)\b[,:]?\s+([^.;]{8,90})/gi;
/** "days 1-10 we inventory", "week 3: cutover" — the tail stops at a comma so periods stay separate. */
const TIMELINE = /\b(?:(?:within|by|at|on|during|in)\s+)?(day|days|week|weeks|month|months|phase|phases)\s+(\d{1,3}(?:\s*(?:–|-|to)\s*\d{1,3})?)\b([^.;,]{0,40})/gi;
const ACRONYMS = new Set(["api", "siem", "soc", "aws", "idp", "etl", "sso", "govcloud"]);
const ROLE = /\b(program manager|project manager|deputy program manager|technical lead|team lead|task lead|site lead|quality (?:assurance )?(?:manager|lead)|security (?:officer|lead)|transition manager|contracts? manager|architect|systems? engineer|analysts?|engineers?|help desk|subject matter experts?|smes?)\b/gi;
const COMPONENT = /\b(users?|operators?|analysts?|customers?|portal|web application|dashboard|mobile app|api gateway|api|services?|microservices?|message queue|pipeline|etl|data lake|data warehouse|database|data store|siem|soc|ticketing|service desk|identity provider|idp|single sign-on|firewall|network|cloud|aws|azure|govcloud|kubernetes|containers?|monitoring|logging)\b/gi;

const TIERS: { group: string; re: RegExp }[] = [
  { group: "Users", re: /^(users?|operators?|analysts?|customers?)$/i },
  { group: "Application", re: /^(portal|web application|dashboard|mobile app|api gateway|api|services?|microservices?|ticketing|service desk|help desk)$/i },
  { group: "Data", re: /^(message queue|pipeline|etl|data lake|data warehouse|database|data store|logging|siem)$/i },
  { group: "Platform", re: /^(cloud|aws|azure|govcloud|kubernetes|containers?|network|firewall|identity provider|idp|single sign-on|soc|monitoring)$/i },
];

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "api gateway" → "API Gateway", "govcloud" → "GovCloud"-ish upper-casing for known acronyms. */
function componentLabel(c: string): string {
  return c
    .split(" ")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : titleCase(w)))
    .join(" ");
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function uniqueByKey<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = key(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Diagrams the section's own words support, most relevant to its kind first. */
export function proposeGraphics(section: { kind: string; title: string; text: string }): GraphicSpec[] {
  const text = section.text.replace(/\r\n?/g, "\n");
  const out: GraphicSpec[] = [];

  // Process: numbered steps, else sequence words.
  const steps: string[] = [];
  for (const line of text.split("\n")) {
    const m = STEP_LINE.exec(line);
    if (m) steps.push(clip(m[2], GRAPHIC_LIMITS.maxLabelChars));
  }
  if (steps.length < 3) {
    for (const m of text.matchAll(SEQUENCE_WORD)) steps.push(clip(m[2], GRAPHIC_LIMITS.maxLabelChars));
  }
  const stepNodes = uniqueByKey(steps, (s) => s.toLowerCase()).slice(0, 8);
  if (stepNodes.length >= 3) {
    const nodes = stepNodes.map((label, i) => ({ id: slugId(label, i + 1), label }));
    out.push({
      kind: "process",
      title: `${section.title || "Approach"} — process flow`,
      why: `The section walks through ${nodes.length} steps; a flow lets the evaluator see the sequence at a glance.`,
      nodes,
      edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })),
    });
  }

  // Timeline: periods named in order of appearance.
  const periods: string[] = [];
  for (const m of text.matchAll(TIMELINE)) {
    periods.push(clip(capitalizeFirst(`${m[1]} ${m[2]}${m[3] ?? ""}`.replace(/[:\s]+$/, "")), GRAPHIC_LIMITS.maxLabelChars));
  }
  const periodNodes = uniqueByKey(periods, (p) => p.toLowerCase()).slice(0, 8);
  if (periodNodes.length >= 2) {
    const nodes = periodNodes.map((label, i) => ({ id: slugId(label, i + 1), label }));
    out.push({
      kind: "timeline",
      title: `${section.title || "Plan"} — timeline`,
      why: `The section names ${nodes.length} periods or milestones; a timeline shows the evaluator when each lands.`,
      nodes,
      edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })),
    });
  }

  // Org chart: roles, program manager on top.
  const roles = uniqueByKey(
    [...text.matchAll(ROLE)].map((m) => titleCase(m[1]!.toLowerCase())),
    (r) => r.toLowerCase().replace(/s$/, ""),
  ).slice(0, 9);
  if (roles.length >= 3) {
    const rootIdx = Math.max(0, roles.findIndex((r) => /program manager|project manager/i.test(r)));
    const ordered = [roles[rootIdx]!, ...roles.filter((_, i) => i !== rootIdx)];
    const nodes = ordered.map((label, i) => ({ id: slugId(label, i + 1), label }));
    out.push({
      kind: "org",
      title: `${section.title || "Team"} — organization`,
      why: `The section names ${nodes.length} roles; an org chart shows the evaluator who reports to whom.`,
      nodes,
      edges: nodes.slice(1).map((n) => ({ from: nodes[0]!.id, to: n.id })),
    });
  }

  // Architecture: components grouped into tiers, flow Users → Application → Data → Platform.
  const comps = uniqueByKey(
    [...text.matchAll(COMPONENT)].map((m) => m[1]!.toLowerCase()),
    (c) => c.replace(/s$/, ""),
  ).slice(0, 10);
  if (comps.length >= 3) {
    const nodes: GraphicNode[] = comps.map((c, i) => {
      const tier = TIERS.find((t) => t.re.test(c))?.group ?? "Application";
      return { id: slugId(c, i + 1), label: componentLabel(c), group: tier };
    });
    const byTier = (g: string) => nodes.filter((n) => n.group === g);
    const order = ["Users", "Application", "Data", "Platform"].filter((g) => byTier(g).length > 0);
    const edges: GraphicEdge[] = [];
    for (let i = 0; i + 1 < order.length; i++) {
      const a = byTier(order[i]!)[0]!;
      for (const b of byTier(order[i + 1]!).slice(0, 3)) edges.push({ from: a.id, to: b.id });
    }
    out.push({
      kind: "architecture",
      title: `${section.title || "Solution"} — notional architecture`,
      why: `The section names ${nodes.length} components; a notional architecture shows the evaluator how they fit together.`,
      nodes,
      edges,
    });
  }

  const favoured: Record<string, GraphicKind[]> = {
    technical: ["architecture", "process"],
    management: ["org", "timeline", "process"],
    past_performance: ["timeline"],
    executive_summary: ["architecture", "process"],
    pricing: ["timeline"],
    compliance: ["process"],
  };
  const rank = (k: GraphicKind) => {
    const i = (favoured[section.kind] ?? []).indexOf(k);
    return i === -1 ? 9 : i;
  };
  return out.sort((a, b) => rank(a.kind) - rank(b.kind)).slice(0, GRAPHIC_LIMITS.maxSuggestions);
}

// ─────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Up to two lines of about `width` characters, the second ending with an ellipsis when cut. */
function wrapLabel(label: string, width = 18): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(" ");
  return [lines[0]!, `${second.slice(0, width - 1).trimEnd()}…`];
}

type Box = { id: string; x: number; y: number; w: number; h: number; label: string };

const BOX_W = 150;
const BOX_H = 56;
const GAP = 44;
const PAD = 24;
const FONT = "Inter, Arial, Helvetica, sans-serif";

function boxSvg(b: Box, fill: string, stroke: string, text: string): string {
  const lines = wrapLabel(b.label);
  const lineH = 15;
  const y0 = b.y + b.h / 2 - ((lines.length - 1) * lineH) / 2;
  return [
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
    ...lines.map(
      (l, i) =>
        `<text x="${b.x + b.w / 2}" y="${y0 + i * lineH}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="12" fill="${text}">${esc(l)}</text>`,
    ),
  ].join("");
}

function arrowSvg(a: Box, b: Box, stroke: string, label?: string): string {
  // From the nearest side of a to the nearest side of b.
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  let x1 = ax;
  let y1 = ay;
  let x2 = bx;
  let y2 = by;
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    x1 = bx > ax ? a.x + a.w : a.x;
    x2 = bx > ax ? b.x : b.x + b.w;
  } else {
    y1 = by > ay ? a.y + a.h : a.y;
    y2 = by > ay ? b.y : b.y + b.h;
  }
  const mid = label
    ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${stroke}">${esc(label)}</text>`
    : "";
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.5" marker-end="url(#arrow)"/>${mid}`;
}

/** A self-contained SVG of the spec, print colours, no scripts or external assets. */
export function renderDiagramSvg(spec: GraphicSpec): string {
  const stroke = THEME_HEX.cobaltDeep;
  const fill = THEME_HEX.layer;
  const text = THEME_HEX.canvas;
  const accent = THEME_HEX.brass;
  const muted = THEME_HEX.subtle;
  const boxes = new Map<string, Box>();
  let width = 0;
  let height = 0;
  const extras: string[] = [];

  if (spec.kind === "process" || spec.kind === "timeline") {
    const perRow = spec.kind === "timeline" ? spec.nodes.length : Math.min(spec.nodes.length, 5);
    const rows = Math.ceil(spec.nodes.length / perRow);
    spec.nodes.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      const col = row % 2 === 0 ? i % perRow : perRow - 1 - (i % perRow);
      boxes.set(n.id, { id: n.id, x: PAD + col * (BOX_W + GAP), y: PAD + 24 + row * (BOX_H + GAP + 10), w: BOX_W, h: BOX_H, label: n.label });
    });
    width = PAD * 2 + perRow * BOX_W + (perRow - 1) * GAP;
    height = PAD * 2 + 24 + rows * BOX_H + (rows - 1) * (GAP + 10);
    if (spec.kind === "timeline") {
      const y = PAD + 24 + BOX_H + 18;
      height = Math.max(height, y + PAD);
      extras.push(`<line x1="${PAD}" y1="${y}" x2="${width - PAD}" y2="${y}" stroke="${muted}" stroke-width="1"/>`);
      for (const b of boxes.values()) {
        extras.push(`<circle cx="${b.x + b.w / 2}" cy="${y}" r="4" fill="${accent}"/>`);
      }
    }
  } else if (spec.kind === "org") {
    const incoming = new Set(spec.edges.map((e) => e.to));
    const root = spec.nodes.find((n) => !incoming.has(n.id)) ?? spec.nodes[0]!;
    const levels: string[][] = [[root.id]];
    const placed = new Set([root.id]);
    while (placed.size < spec.nodes.length && levels.length < 4) {
      const last = levels[levels.length - 1]!;
      const next = spec.edges.filter((e) => last.includes(e.from) && !placed.has(e.to)).map((e) => e.to);
      const level = uniqueByKey(next, (x) => x);
      if (level.length === 0) {
        levels.push(spec.nodes.filter((n) => !placed.has(n.id)).map((n) => n.id));
        break;
      }
      level.forEach((id) => placed.add(id));
      levels.push(level);
    }
    const widest = Math.max(...levels.map((l) => l.length));
    width = PAD * 2 + widest * BOX_W + (widest - 1) * GAP;
    levels.forEach((level, li) => {
      const rowW = level.length * BOX_W + (level.length - 1) * GAP;
      const x0 = (width - rowW) / 2;
      level.forEach((id, ci) => {
        const n = spec.nodes.find((x) => x.id === id)!;
        boxes.set(id, { id, x: x0 + ci * (BOX_W + GAP), y: PAD + 24 + li * (BOX_H + GAP), w: BOX_W, h: BOX_H, label: n.label });
      });
    });
    height = PAD * 2 + 24 + levels.length * BOX_H + (levels.length - 1) * GAP;
  } else {
    // architecture: one band per tier, in the order the tiers first appear.
    const tiers = uniqueByKey(spec.nodes.map((n) => n.group || "Components"), (g) => g);
    const widest = Math.max(...tiers.map((g) => spec.nodes.filter((n) => (n.group || "Components") === g).length));
    width = PAD * 2 + 110 + widest * BOX_W + (widest - 1) * GAP;
    tiers.forEach((g, ti) => {
      const y = PAD + 24 + ti * (BOX_H + GAP);
      extras.push(
        `<rect x="${PAD}" y="${y - 10}" width="${width - PAD * 2}" height="${BOX_H + 20}" rx="8" fill="${THEME_HEX.cobalt}" fill-opacity="0.06" stroke="none"/>`,
        `<text x="${PAD + 10}" y="${y + BOX_H / 2}" dominant-baseline="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${muted}">${esc(g.toUpperCase())}</text>`,
      );
      spec.nodes
        .filter((n) => (n.group || "Components") === g)
        .forEach((n, ci) => {
          boxes.set(n.id, { id: n.id, x: PAD + 110 + ci * (BOX_W + GAP), y, w: BOX_W, h: BOX_H, label: n.label });
        });
    });
    height = PAD * 2 + 24 + tiers.length * BOX_H + (tiers.length - 1) * GAP;
  }

  const edgeSvg = spec.edges
    .map((e) => {
      const a = boxes.get(e.from);
      const b = boxes.get(e.to);
      return a && b ? arrowSvg(a, b, stroke, e.label) : "";
    })
    .join("");
  const nodeSvg = [...boxes.values()].map((b) => boxSvg(b, fill, stroke, text)).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(spec.title)}">`,
    `<title>${esc(spec.title)}</title>`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${stroke}"/></marker></defs>`,
    `<rect width="${width}" height="${height}" fill="${fill}"/>`,
    `<text x="${PAD}" y="${PAD}" font-family="${FONT}" font-size="13" font-weight="600" fill="${text}">${esc(spec.title)}</text>`,
    ...extras,
    edgeSvg,
    nodeSvg,
    `<text x="${width - PAD}" y="${height - 8}" text-anchor="end" font-family="${FONT}" font-size="9" fill="${muted}">Notional — ${esc(GRAPHIC_KIND_LABELS[spec.kind])}</text>`,
    `</svg>`,
  ].join("");
}

/** The same diagram as a Mermaid block the author can paste into other tools. */
export function toMermaid(spec: GraphicSpec): string {
  const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
  const lines: string[] = [];
  if (spec.kind === "architecture") {
    lines.push("flowchart TB");
    const tiers = uniqueByKey(spec.nodes.map((n) => n.group || "Components"), (g) => g);
    for (const g of tiers) {
      lines.push(`  subgraph ${q(g)}`);
      for (const n of spec.nodes.filter((x) => (x.group || "Components") === g)) lines.push(`    ${n.id}[${q(n.label)}]`);
      lines.push("  end");
    }
  } else {
    lines.push(spec.kind === "org" ? "flowchart TD" : "flowchart LR");
    for (const n of spec.nodes) lines.push(`  ${n.id}[${q(n.label)}]`);
  }
  for (const e of spec.edges) lines.push(`  ${e.from} -->${e.label ? `|${q(e.label)}|` : ""} ${e.to}`);
  return lines.join("\n");
}

/** The SVG as an image source the editor's image node can store. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
