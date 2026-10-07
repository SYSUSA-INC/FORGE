/**
 * BL-AIX Phase 2b — read Sections L and M into structured data at
 * intake. One structured call per section found (feature
 * `solicitation_structure`, variants `section_l` / `section_m`), in
 * parallel; a section the document lacks costs nothing, and a failed
 * call leaves that section empty rather than failing the parse. Every
 * quoted item is located in the document like a requirement.
 */
import { completeStructuredForTenant } from "@/lib/ai";
import { PROMPT_VERSIONS } from "@/lib/ai-prompt-versions";
import {
  buildSectionLStructurePrompt,
  buildSectionMStructurePrompt,
  sectionLStructureSchema,
  sectionMStructureSchema,
} from "@/lib/ai-prompts";
import { log } from "@/lib/log";
import { createLocator } from "@/lib/requirement-provenance";
import { lmExcerpt, locateLm, normalizeSectionL, normalizeSectionM, type LmStructure } from "@/lib/solicitation-lm";
import { segmentSolicitation, type Segment } from "@/lib/solicitation-segments";

const L_MAX_TOKENS = 3_000;
const M_MAX_TOKENS = 2_400;

export async function extractLmStructure(input: {
  organizationId: string;
  rawText: string;
  documentLabel: string;
  pageStarts?: number[];
  segments?: Segment[];
  /** BL-AIX Phase 1i-2 — a candidate model for eval runs; unset follows routing. */
  model?: string;
}): Promise<{ structure: LmStructure; stubbed: boolean; calls: number }> {
  const segments = input.segments ?? segmentSolicitation(input.rawText);
  const l = lmExcerpt(input.rawText, segments, "L");
  const m = lmExcerpt(input.rawText, segments, "M");
  if (!l && !m) return { structure: {}, stubbed: false, calls: 0 };

  const base = {
    organizationId: input.organizationId,
    feature: "solicitation_structure" as const,
    model: input.model || undefined,
    temperature: 0,
    cacheSystem: true,
  };
  const safe = async <T>(part: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      log.warn("[extractLmStructure]", `section ${part} failed`, { error: err });
      return null;
    }
  };
  const [lRes, mRes] = await Promise.all([
    l
      ? safe("L", () => {
          const prompt = buildSectionLStructurePrompt({ documentLabel: input.documentLabel, partLabel: l.label, text: l.text, truncated: l.truncated });
          return completeStructuredForTenant({
            ...base,
            variant: "section_l",
            schema: sectionLStructureSchema,
            toolName: "record_section_l",
            toolDescription: "Record the volumes, format rules and submission rules Section L states.",
            system: prompt.system,
            messages: prompt.messages,
            maxTokens: L_MAX_TOKENS,
          });
        })
      : null,
    m
      ? safe("M", () => {
          const prompt = buildSectionMStructurePrompt({ documentLabel: input.documentLabel, partLabel: m.label, text: m.text, truncated: m.truncated });
          return completeStructuredForTenant({
            ...base,
            variant: "section_m",
            schema: sectionMStructureSchema,
            toolName: "record_section_m",
            toolDescription: "Record the award basis and the evaluation factors Section M states, in order.",
            system: prompt.system,
            messages: prompt.messages,
            maxTokens: M_MAX_TOKENS,
          });
        })
      : null,
  ]);

  const stubbed = Boolean(lRes?.stubbed || mRes?.stubbed);
  const located = locateLm(
    {
      sectionL: lRes && !lRes.stubbed ? normalizeSectionL(lRes.data) : null,
      sectionM: mRes && !mRes.stubbed ? normalizeSectionM(mRes.data) : null,
    },
    createLocator(input.rawText, { pageStarts: input.pageStarts, segments }),
  );
  return {
    structure: {
      ...located,
      promptVersion: PROMPT_VERSIONS.solicitation_structure,
      model: lRes?.model || mRes?.model || "",
    },
    stubbed,
    calls: (l ? 1 : 0) + (m ? 1 : 0),
  };
}
