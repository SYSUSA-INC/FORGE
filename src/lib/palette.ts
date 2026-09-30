/**
 * BL-AIP-7d — the ⌘K command palette, pure parts.
 *
 * The header's search box was a dead input with a ⌘K badge (assessment
 * §5 row 1). The palette behind it does three things from one box:
 *
 *   go to     — every page the person's sidebar lists, ranked by how
 *               well the label matches what they typed;
 *   find      — records of the workspace (opportunities, proposals,
 *               solicitations, companies, knowledge entries) found by
 *               the server (`palette-search.ts`);
 *   ask       — a question answered from the org's own Brain with
 *               citations (`brain-answer.ts`).
 *
 * This module holds what needs no server: the command list derived from
 * the navigation trees (so the palette can never offer a page the
 * sidebar would hide), the ranking, and the "is this a question" rule.
 * Unit-tested.
 */
import { visibleNavChildren, visibleNavGroups, type NavVisibility } from "@/lib/nav-visibility";
import { availableWorkspaces, NAV_BY_WORKSPACE } from "@/lib/nav-workspaces";
import type { Workspace } from "@/lib/nav-workspaces";

/** Window event the header box dispatches to open the palette. */
export const PALETTE_OPEN_EVENT = "forge:palette:open";

/** Shortest query the palette searches records for. */
export const PALETTE_MIN_SEARCH = 2;
/** Shortest question the Brain accepts (searchBrain refuses under 6). */
export const PALETTE_MIN_QUESTION = 6;
export const PALETTE_MAX_QUESTION = 500;

export type PaletteCommand = {
  /** Stable id — the href. */
  id: string;
  label: string;
  /** The sidebar group the page sits under. */
  group: string;
  workspace: Workspace;
  href: string;
};

export type PaletteRecordKind = "opportunity" | "proposal" | "solicitation" | "company" | "knowledge";

export type PaletteRecord = {
  kind: PaletteRecordKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export const PALETTE_KIND_LABELS: Record<PaletteRecordKind, string> = {
  opportunity: "Opportunity",
  proposal: "Proposal",
  solicitation: "Solicitation",
  company: "Company",
  knowledge: "Knowledge",
};

/**
 * Every page this person's sidebar lists, across the workspaces they may
 * switch to, in switcher order. A page listed in more than one workspace
 * (Settings, Users & Roles…) appears once, under the first that lists it.
 */
export function paletteCommands(v: NavVisibility): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const seen = new Set<string>();
  for (const ws of availableWorkspaces(v)) {
    for (const group of visibleNavGroups(NAV_BY_WORKSPACE[ws], v)) {
      const items = group.href
        ? [{ href: group.href, label: group.label }]
        : visibleNavChildren(group.children, v);
      for (const item of items) {
        if (seen.has(item.href)) continue;
        seen.add(item.href);
        out.push({ id: item.href, label: item.label, group: group.label, workspace: ws, href: item.href });
      }
    }
  }
  return out;
}

/** Lower-case, collapsed whitespace, no leading/trailing space. */
export function normalizeQuery(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(q: string): string[] {
  return normalizeQuery(q)
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * How well a command matches the query: 0 = no match. Label prefix
 * beats label word-prefix beats label substring beats group match; every
 * query token must land somewhere in label or group.
 */
export function scoreCommand(cmd: PaletteCommand, query: string): number {
  const ts = tokens(query);
  if (ts.length === 0) return 0;
  const label = cmd.label.toLowerCase();
  const group = cmd.group.toLowerCase();
  const labelWords = label.split(/[^a-z0-9()]+/).filter(Boolean);
  let score = 0;
  for (const t of ts) {
    if (label.startsWith(t)) score += 4;
    else if (labelWords.some((w) => w.startsWith(t))) score += 3;
    else if (label.includes(t)) score += 2;
    else if (group.includes(t)) score += 1;
    else return 0;
  }
  return score;
}

/** Commands that match, best first; ties keep sidebar order. */
export function rankCommands(commands: readonly PaletteCommand[], query: string, limit = 8): PaletteCommand[] {
  if (tokens(query).length === 0) return commands.slice(0, limit);
  return commands
    .map((cmd, index) => ({ cmd, index, score: scoreCommand(cmd, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.cmd);
}

const QUESTION_STARTS = new Set([
  "how", "what", "which", "when", "where", "why", "who", "whom",
  "do", "does", "did", "can", "could", "should", "would", "is", "are",
  "was", "were", "have", "has", "had", "will", "tell", "explain", "summarize", "summarise",
]);

/** A question mark, or a question word up front, reads as a question for the Brain. */
export function isQuestion(raw: string): boolean {
  const q = normalizeQuery(raw);
  if (q.length < PALETTE_MIN_QUESTION) return false;
  if (q.endsWith("?")) return true;
  const first = q.split(" ")[0] ?? "";
  return QUESTION_STARTS.has(first);
}

/** Whether the Brain row is offered for this text at all. */
export function canAsk(raw: string): boolean {
  const q = normalizeQuery(raw);
  return q.length >= PALETTE_MIN_QUESTION && q.length <= PALETTE_MAX_QUESTION;
}

/** Whether the server should be asked for records. */
export function canSearch(raw: string): boolean {
  return normalizeQuery(raw).length >= PALETTE_MIN_SEARCH;
}

/** One Brain source as the palette shows it (`brain-answer.ts` builds these). */
export type BrainAnswerSource = {
  n: number;
  title: string;
  href: string;
  source: "entry" | "corpus";
  kind: string;
  outcomeLabel: string;
  preview: string;
  /** The model relied on this source. */
  cited: boolean;
};

export type BrainAnswerView = {
  question: string;
  answer: string;
  confidence: number;
  sources: BrainAnswerSource[];
  /** No model call was made or its output was unusable; the answer is an excerpt. */
  extractive: boolean;
  stubbed: boolean;
  model: string;
};

export type BrainAnswerResult = { ok: true; view: BrainAnswerView } | { ok: false; error: string };

export type PaletteRow =
  | { type: "ask"; question: string }
  | { type: "record"; record: PaletteRecord }
  | { type: "command"; command: PaletteCommand };

/**
 * The rows in the order the palette shows them: the Brain row first when
 * the text reads as a question, records, commands, and the Brain row
 * last otherwise (any text long enough can be asked).
 */
export function paletteRows(input: {
  query: string;
  records: readonly PaletteRecord[];
  commands: readonly PaletteCommand[];
}): PaletteRow[] {
  const q = input.query.trim();
  const ask: PaletteRow[] = canAsk(q) ? [{ type: "ask", question: q }] : [];
  const records: PaletteRow[] = input.records.map((record) => ({ type: "record", record }));
  const commands: PaletteRow[] = input.commands.map((command) => ({ type: "command", command }));
  return isQuestion(q) ? [...ask, ...records, ...commands] : [...records, ...commands, ...ask];
}
