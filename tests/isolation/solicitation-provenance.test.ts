/**
 * BL-AIX Phase 2a — intake end to end, with the model mocked: the sweep's
 * windows follow the solicitation's parts and say which, and every kept
 * requirement comes back with its page, part and paragraph, or flagged
 * when the document does not say it. BL-AIX Phase 2b — Sections L and M
 * are read on their own and come back structured and located. Runs
 * against Postgres for the gateway's tenant checks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setCompleteImplForTest, type AICompleteOptions } from "@/lib/ai";
import { aiExtractSolicitation } from "@/lib/solicitation-extract";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";
import { ucfSolicitation } from "../helpers/ucf-solicitation";

const frontMatter = {
  title: "Help Desk Support Services",
  agency: "Department of Examples",
  office: "",
  solicitationNumber: "70-RFP-0042",
  type: "rfp",
  naicsCode: "541513",
  setAside: "",
  responseDueDate: null,
  sectionLSummary: "Volume I is limited to 25 pages.",
  sectionMSummary: "Technical approach is most important.",
  requirements: [],
  keyDates: [],
};

const sectionL = {
  volumes: [
    {
      name: "Volume I",
      pageLimit: 25,
      pageLimitText: "shall not exceed 25 pages",
      contents: "",
      quote: "Volume I shall not exceed 25 pages in 12-point Times New Roman.",
    },
  ],
  formatRules: [{ rule: "12-point Times New Roman", quote: "in 12-point Times New Roman" }],
  submission: [],
};

const sectionM = {
  basis: "tradeoff",
  basisQuote: "",
  relativeImportance: "Technical approach is more important than past performance.",
  factors: [
    { name: "Technical approach", importance: "more important than past performance", quote: "Technical approach is more important than past performance.", subfactors: [] },
    { name: "Past performance", importance: "", quote: "", subfactors: [] },
  ],
};

const swept = [
  { kind: "shall", text: "The contractor shall complete transition within 30 days of award.", ref: "" },
  { kind: "shall", text: "Volume I shall not exceed 25 pages in 12-point Times New Roman.", ref: "L.5" },
  { kind: "shall", text: "The contractor shall keep every user happy at all times.", ref: "" },
];

describe("BL-AIX Phase 2a — solicitation intake with provenance (runtime)", () => {
  let fx: TwoTenantFixture;
  let windowPrompts: string[] = [];
  let lmPrompts: string[] = [];

  beforeEach(async () => {
    fx = await createTwoTenants("solicitation-provenance");
    windowPrompts = [];
    lmPrompts = [];
    __setCompleteImplForTest(async (opts: AICompleteOptions) => {
      const tool = opts.tool?.name;
      const isWindow = tool === "record_requirements";
      if (isWindow) windowPrompts.push(opts.messages.map((m) => m.content).join("\n"));
      if (tool === "record_section_l" || tool === "record_section_m") lmPrompts.push(opts.messages.map((m) => m.content).join("\n"));
      return {
        text: "",
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: 5,
        outputTokens: 5,
        stubbed: false,
        // The sweep finds the same clauses in whichever window it reads first; merging drops the repeats.
        structured: isWindow
          ? { requirements: swept }
          : tool === "record_section_l"
            ? sectionL
            : tool === "record_section_m"
              ? sectionM
              : frontMatter,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await fx.cleanup();
  });

  it("labels each window with its part and locates every requirement in the document", async () => {
    const { text, pageStarts } = ucfSolicitation();
    const res = await aiExtractSolicitation(fx.orgA.organizationId, text, { documentLabel: "rfp.pdf", pageStarts });
    if (!res.ok) throw new Error(res.error);

    expect(windowPrompts.length).toBeGreaterThan(0);
    expect(windowPrompts[0]).toMatch(/Part of the document: /);

    const [transition, volume, invented] = res.data.requirements as { source?: Record<string, unknown> }[];
    expect(transition!.source).toMatchObject({ quote: "exact", page: 2, section: "C", paragraph: "3.2.1" });
    expect(volume!.source).toMatchObject({ quote: "exact", page: 4, section: "L", paragraph: "L.5" });
    expect(invented!.source).toEqual({ quote: "none" });
    expect(res.coverage).toMatchObject({
      quotes: { exact: 2, partial: 0, none: 1 },
      parts: ["B", "C", "J", "L", "M", "Attachment J-1", "Attachment J-2"],
    });
  });

  it("reads Sections L and M on their own and locates each item", async () => {
    const { text, pageStarts } = ucfSolicitation();
    const res = await aiExtractSolicitation(fx.orgA.organizationId, text, { documentLabel: "rfp.pdf", pageStarts });
    if (!res.ok) throw new Error(res.error);

    // Each pass reads only its own section.
    expect(lmPrompts).toHaveLength(2);
    const lPrompt = lmPrompts.find((p) => p.includes("Part of the document: Section L"))!;
    expect(lPrompt).toContain("L.5 Volume I shall not exceed 25 pages");
    expect(lPrompt).not.toContain("M.1 Technical approach");

    expect(res.lm?.sectionL?.volumes[0]).toMatchObject({ name: "Volume I", pageLimit: 25, source: { quote: "exact", page: 4, section: "L" } });
    expect(res.lm?.sectionM?.basis).toBe("tradeoff");
    expect(res.lm?.sectionM?.factors.map((f) => f.name)).toEqual(["Technical approach", "Past performance"]);
    expect(res.lm?.sectionM?.factors[0]!.source).toMatchObject({ quote: "exact", page: 4, section: "M", paragraph: "M.1" });
    expect(res.lm?.promptVersion).toBeTruthy();
  });

  it("asks nothing about L and M of a document without them", async () => {
    const res = await aiExtractSolicitation(fx.orgA.organizationId, "The contractor shall migrate 400 mailboxes to the cloud within 90 days.");
    if (!res.ok) throw new Error(res.error);
    expect(lmPrompts).toHaveLength(0);
    expect(res.lm).toEqual({});
  });

  it("parses when the model sends lists as JSON text, never asks the front matter for requirements, and keeps key dates (production failure)", async () => {
    let frontMatterFields: string[] = [];
    __setCompleteImplForTest(async (opts: AICompleteOptions) => {
      const tool = opts.tool?.name;
      if (tool === "record_solicitation") {
        frontMatterFields = Object.keys((opts.tool?.inputSchema.properties ?? {}) as Record<string, unknown>);
      }
      return {
        text: "",
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: 5,
        outputTokens: 5,
        stubbed: false,
        structured:
          tool === "record_requirements"
            ? { requirements: JSON.stringify(swept) }
            : tool === "record_solicitation"
              ? {
                  ...frontMatter,
                  // The shape that failed the OED RFP: a list sent as text.
                  requirements: JSON.stringify(swept.slice(0, 1)),
                  keyDates: JSON.stringify([
                    { label: "Questions due", isoDate: "2026-10-20", type: "qa_cutoff" },
                    { isoDate: "2026-11-01", type: "proposal_due" },
                  ]),
                  naicsCode: 541513,
                }
              : null,
      };
    });
    const { text } = ucfSolicitation();
    const res = await aiExtractSolicitation(fx.orgA.organizationId, text, { documentLabel: "OED RFP.docx" });
    if (!res.ok) throw new Error(res.error);
    expect(frontMatterFields).not.toContain("requirements");
    expect(frontMatterFields).toContain("keyDates");
    expect(res.data.title).toBe("Help Desk Support Services");
    expect(res.data.requirements.map((r) => r.text)).toEqual(swept.map((r) => r.text));
    // An entry without a label is dropped; a malformed field falls back on its own.
    expect(res.data.keyDates).toEqual([{ label: "Questions due", isoDate: "2026-10-20", type: "qa_cutoff" }]);
    expect(res.data.naicsCode).toBe("");
  });

  it("fails the parse, with the reason, when no part of the document could be read for requirements", async () => {
    __setCompleteImplForTest(async (opts: AICompleteOptions) => ({
      text: "",
      provider: "stub" as const,
      model: "test-mock",
      inputTokens: 5,
      outputTokens: 5,
      stubbed: false,
      structured: opts.tool?.name === "record_solicitation" ? frontMatter : opts.tool?.name === "record_requirements" ? { requirements: 42 } : null,
    }));
    const { text } = ucfSolicitation();
    const res = await aiExtractSolicitation(fx.orgA.organizationId, text, { documentLabel: "rfp.docx" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Couldn't read the requirements from any part of the document/);
    expect(res.error).toMatch(/requirements: .*expected array/);
  });

  it("still locates requirements in a Word or text document, without pages", async () => {
    const { text } = ucfSolicitation();
    const res = await aiExtractSolicitation(fx.orgA.organizationId, text);
    if (!res.ok) throw new Error(res.error);
    const [transition] = res.data.requirements as { source?: Record<string, unknown> }[];
    expect(transition!.source).toMatchObject({ quote: "exact", section: "C" });
    expect(transition!.source!.page).toBeUndefined();
  });
});
