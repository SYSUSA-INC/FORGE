/**
 * BL-AI-SCAN-FULLTEXT — shared input builder for the proposal health scan.
 *
 * Both scan paths (the on-demand action and the background cron) used to
 * carry their own copy of the system prompt and their own section-line
 * builder, and both sent the model a 500-character excerpt per section.
 * That made win-theme coverage and contradiction detection blind to
 * anything past a section's opening paragraph, and the two prompt copies
 * had already drifted.
 *
 * This module is the single source of truth for:
 *   - SCAN_SYSTEM, the analyst persona + output schema + rules
 *   - the token budget and how it is shared across sections
 *   - the user prompt layout
 *
 * Budgeting: every section gets its full body up to a per-section cap.
 * If the sum exceeds the total budget, allowances are scaled down
 * proportionally to length, never below a floor, so a long Technical
 * Volume cannot starve a short Pricing narrative. Truncation is always
 * marked in the text so the model knows it is looking at a prefix.
 *
 * Pure module: no DB, no server-only, testable without fixtures.
 */
import type { TipTapDoc } from "@/db/schema";
import { projectToPlain } from "@/lib/tiptap-doc";

export const SCAN_MAX_TOKENS = 2000;
export const SCAN_TEMPERATURE = 0.2;

export const SCAN_SYSTEM = `You are a proposal quality analyst inside FORGE reviewing an in-progress federal proposal. Your job is an honest health check: flag what's missing, thin, or off-target so the team knows exactly what to fix before submission.

Output ONLY a single JSON object:
{
  "overallScore": "strong" | "needs_work" | "critical",
  "summary": "<2-3 sentences — overall health and the single most important gap to close>",
  "sectionIssues": [
    {
      "sectionId": "<echo the id from input>",
      "sectionTitle": "<echo the title>",
      "issue": "<1-2 sentences describing the specific problem>",
      "severity": "high" | "medium" | "low"
    }
  ],
  "topRecommendations": ["<specific next action>", ...],
  "sectionThemeCoverage": [
    {
      "sectionId": "<echo the id from input>",
      "sectionTitle": "<echo the title>",
      "reinforced": ["<theme title that this section clearly reinforces>"],
      "missing": ["<theme title not reinforced or contradicted in this section>"]
    }
  ],
  "contradictions": [
    {
      "section1Id": "<echo id of first section>",
      "section1Title": "<echo title>",
      "section2Id": "<echo id of second section>",
      "section2Title": "<echo title>",
      "claim1": "<specific claim from section 1 that conflicts>",
      "claim2": "<specific claim from section 2 that contradicts claim1>",
      "explanation": "<1-2 sentences explaining the incompatibility>",
      "severity": "high" | "medium" | "low"
    }
  ]
}

Input format:
- Each section arrives as a block: "=== SECTION id=… | title | kind | status | words | FLAG ===", then the drafted body text, then "=== END SECTION ===".
- Bodies are the actual drafted text. When a body was cut for length it ends with "[… truncated: showing X of Y characters]" — judge only what is present and do not infer content past the cut.
- FLAG is EMPTY (under 30 words), THIN (well under the page-limit expectation) or OK.

Score calibration:
- strong: most sections drafted and on-target, minor gaps only
- needs_work: key sections empty or thin, deadline risk if not addressed soon
- critical: majority empty or compliance is at risk, immediate action required

Rules:
- Only include sections with genuine issues in sectionIssues. Skip sections that look good.
- topRecommendations: 3-5 specific actions for the next 48 hours.
- Echo sectionId and sectionTitle exactly from the input.
- Be direct. No flattery.
- sectionThemeCoverage: include ALL sections when win themes are provided. Judge reinforcement on the whole body, not the opening. For empty/thin sections put all themes in missing. When no win themes are in the prompt, return "sectionThemeCoverage": [].
- contradictions: compare concrete claims across ALL section bodies — staffing levels and hours, dates and durations, quantities, locations, named tools and platforms, team members and roles, past-performance facts. Only report pairs that are specific and mutually incompatible (e.g., one section commits to 24/7 operations, another staffs a single business-hours shift). Quote the conflicting claims. Skip EMPTY sections. Max 5 entries. Return [] when none found.`;

export type ScanSectionSource = {
  id: string;
  title: string;
  kind: string;
  status: string;
  wordCount: number;
  pageLimit: number | null;
  bodyDoc: TipTapDoc | null | undefined;
  content: string | null | undefined;
};

export type ScanBudget = {
  /** Hard cap on characters sent for any single section. */
  perSectionCapChars: number;
  /** Target for the sum of all section bodies. */
  totalBodyBudgetChars: number;
  /** Minimum kept per non-empty section when scaling down. */
  floorChars: number;
};

/**
 * ~80k characters is roughly 20k tokens of body text — comfortably inside
 * every supported model's context alongside the prompt, and about 40×
 * what the 500-character excerpts allowed in total for a 4-section
 * proposal. Per-section 10k characters keeps one giant volume from
 * consuming the whole allowance.
 */
export const DEFAULT_SCAN_BUDGET: ScanBudget = {
  perSectionCapChars: 10_000,
  totalBodyBudgetChars: 80_000,
  floorChars: 1_500,
};

const WORDS_PER_PAGE = 350;
const THIN_RATIO = 0.6;
const EMPTY_WORDS = 30;

export type ScanSectionFlag = "EMPTY" | "THIN" | "OK";

export type ScanSectionLine = {
  id: string;
  flag: ScanSectionFlag;
  /** Characters of body actually included. */
  included: number;
  /** Characters of body available. */
  total: number;
  truncated: boolean;
  block: string;
};

export type ScanInput = {
  sections: ScanSectionLine[];
  blocks: string[];
  truncatedSections: number;
  totalBodyChars: number;
  includedBodyChars: number;
};

export function scanSectionFlag(
  wordCount: number,
  pageLimit: number | null,
): { flag: ScanSectionFlag; expectedMin: number } {
  const expectedMin = pageLimit ? pageLimit * WORDS_PER_PAGE * THIN_RATIO : 80;
  const flag: ScanSectionFlag =
    wordCount < EMPTY_WORDS
      ? "EMPTY"
      : pageLimit && wordCount < expectedMin
        ? "THIN"
        : "OK";
  return { flag, expectedMin };
}

function sectionPlain(s: ScanSectionSource): string {
  return (projectToPlain(s.bodyDoc ?? null) || s.content || "").trim();
}

/**
 * Compute how many characters each section may send. Returns one
 * allowance per input, in order. Pure arithmetic, exported for tests.
 */
export function allocateScanAllowances(
  lengths: number[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): number[] {
  const capped = lengths.map((n) => Math.min(n, budget.perSectionCapChars));
  const sum = capped.reduce((a, b) => a + b, 0);
  if (sum <= budget.totalBodyBudgetChars) return capped;

  // Scale proportionally, hold a floor so short sections survive. If the
  // floors alone blow the budget, halve the floor until it fits or hits
  // a sane minimum; a modest overage past that is acceptable.
  let floor = budget.floorChars;
  for (;;) {
    const scale = budget.totalBodyBudgetChars / sum;
    const scaled = capped.map((n) =>
      n === 0 ? 0 : Math.min(n, Math.max(floor, Math.round(n * scale))),
    );
    const scaledSum = scaled.reduce((a, b) => a + b, 0);
    if (scaledSum <= budget.totalBodyBudgetChars * 1.05 || floor <= 250) {
      return scaled;
    }
    floor = Math.max(250, Math.floor(floor / 2));
  }
}

/** Cut at the last whitespace inside the allowance so we never split a word. */
function cutAtWord(text: string, allowance: number): string {
  if (text.length <= allowance) return text;
  const head = text.slice(0, allowance);
  const lastSpace = head.lastIndexOf(" ");
  // Only back off to whitespace if it does not cost more than 10% of the allowance.
  return lastSpace > allowance * 0.9 ? head.slice(0, lastSpace) : head;
}

export function buildScanSectionBlocks(
  sections: ScanSectionSource[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): ScanInput {
  const plains = sections.map(sectionPlain);
  const allowances = allocateScanAllowances(
    plains.map((p) => p.length),
    budget,
  );

  let truncatedSections = 0;
  let totalBodyChars = 0;
  let includedBodyChars = 0;

  const lines: ScanSectionLine[] = sections.map((s, i) => {
    const plain = plains[i]!;
    const allowance = allowances[i]!;
    const { flag, expectedMin } = scanSectionFlag(s.wordCount, s.pageLimit);
    const truncated = plain.length > allowance;
    const body = truncated ? cutAtWord(plain, allowance) : plain;

    totalBodyChars += plain.length;
    includedBodyChars += body.length;
    if (truncated) truncatedSections += 1;

    const header =
      `=== SECTION id=${s.id} | "${s.title}" | kind=${s.kind} | status=${s.status} | words=${s.wordCount}` +
      `${s.pageLimit ? `/${Math.round(expectedMin)}min` : ""} | ${flag} ===`;
    const bodyText = body
      ? truncated
        ? `${body}\n[… truncated: showing ${body.length} of ${plain.length} characters]`
        : body
      : "(no content)";

    return {
      id: s.id,
      flag,
      included: body.length,
      total: plain.length,
      truncated,
      block: `${header}\n${bodyText}\n=== END SECTION ===`,
    };
  });

  return {
    sections: lines,
    blocks: lines.map((l) => l.block),
    truncatedSections,
    totalBodyChars,
    includedBodyChars,
  };
}

export type ScanPromptInput = {
  proposalTitle: string;
  agency: string | null | undefined;
  solicitationNumber: string | null | undefined;
  naicsCode: string | null | undefined;
  setAside: string | null | undefined;
  winThemes: { title?: string | null; statement?: string | null }[];
  sectionMSummary: string;
  requirements: { kind: string; text: string; ref: string }[];
  sections: ScanSectionSource[];
  budget?: ScanBudget;
};

/** Build the full user prompt for a scan. Returns the budget report too. */
export function buildScanUserPrompt(input: ScanPromptInput): {
  prompt: string;
  input: ScanInput;
} {
  const scan = buildScanSectionBlocks(input.sections, input.budget);

  const requirementsBlock =
    input.requirements.length > 0
      ? `\nEvaluation criteria (Section M): ${input.sectionMSummary.slice(0, 400)}\n` +
        `Requirements (top ${Math.min(input.requirements.length, 20)}):\n` +
        input.requirements
          .slice(0, 20)
          .map(
            (r, i) =>
              `${i + 1}. [${r.ref || "?"}] ${r.kind}: ${r.text.slice(0, 200)}`,
          )
          .join("\n")
      : "";

  // BL-FB-GEN-THEMES — feed win themes into the scan so it can flag
  // sections that drift off-theme.
  const themes = input.winThemes.slice(0, 3);
  const themesBlock =
    themes.length > 0
      ? `\nWin themes (the proposal team committed to these — flag any section that doesn't reinforce them):\n${themes
          .map((t, i) => `  ${i + 1}. ${t.title ?? ""}: ${t.statement ?? ""}`)
          .join("\n")}`
      : "";

  const coverageNote =
    scan.truncatedSections > 0
      ? `Section bodies follow. ${scan.truncatedSections} of ${input.sections.length} were truncated for length and are marked where cut.`
      : `Section bodies follow in full.`;

  const prompt = [
    `Proposal: ${input.proposalTitle}`,
    `Agency: ${input.agency || "(unknown)"}`,
    `Solicitation: ${input.solicitationNumber || "(none)"}`,
    `NAICS: ${input.naicsCode || "(unknown)"}`,
    `Set-aside: ${input.setAside || "(unrestricted)"}`,
    themesBlock,
    requirementsBlock,
    ``,
    `Sections (${input.sections.length} total). ${coverageNote}`,
    ...scan.blocks,
    ``,
    `Return strict JSON per the schema in the system prompt. Echo each sectionId and sectionTitle exactly.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { prompt, input: scan };
}
