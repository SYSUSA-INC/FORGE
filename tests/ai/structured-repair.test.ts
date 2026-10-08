/**
 * BL-STAB-1 — structured answers that are slightly off no longer sink a
 * whole AI call:
 *   - the gateway decodes a list or object the model sent as JSON text,
 *     guided by the tool schema it was shown, and never touches free text;
 *   - solicitation answers degrade field by field;
 *   - validation errors say what was wrong even when zod's English
 *     messages are missing (as in production bundles).
 * Pure: no database.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeNestedJson, validateStructured, zodToToolSchema, type AICompleteResult } from "@/lib/ai";
import {
  choiceOf,
  KEY_DATE_TYPES,
  requirementsChunkSchema,
  SOLICITATION_TYPES,
  solicitationExtractionSchema,
  solicitationFrontMatterSchema,
} from "@/lib/ai-prompts";
import { normalizeRequirementList, requirementKindOf } from "@/lib/requirements-text";
import { describeZodIssue, describeZodIssues } from "@/lib/zod-issues";

const base: AICompleteResult = { text: "", provider: "stub", model: "m", stubbed: false };

const requirement = { kind: "shall", text: "The contractor shall provide 24/7 help desk support.", ref: "C.3" };

const frontMatter = {
  title: "OED Help Desk",
  agency: "Office of Economic Development",
  office: "",
  solicitationNumber: "OED-26-001",
  type: "rfp",
  naicsCode: "541513",
  setAside: "",
  responseDueDate: "2026-11-08",
  sectionLSummary: "",
  sectionMSummary: "",
  keyDates: [],
};

describe("decodeNestedJson", () => {
  const schema = z.object({
    note: z.string(),
    items: z.array(z.object({ name: z.string(), tags: z.array(z.string()) })),
    meta: z.object({ count: z.number() }).nullable(),
  });
  const json = zodToToolSchema(schema);

  it("decodes lists and objects sent as JSON text, at any depth, and lists where", () => {
    const repaired: string[] = [];
    const out = decodeNestedJson(
      json,
      {
        note: "[not decoded: this field is text]",
        items: JSON.stringify([{ name: "a", tags: JSON.stringify(["x", "y"]) }]),
        meta: ' {"count": 2} ',
      },
      repaired,
    );
    expect(out).toEqual({ note: "[not decoded: this field is text]", items: [{ name: "a", tags: ["x", "y"] }], meta: { count: 2 } });
    expect(repaired).toEqual(["items", "items.0.tags", "meta"]);
  });

  it("leaves a union with several object branches alone rather than guessing", () => {
    const union = zodToToolSchema(
      z.object({
        step: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("list"), body: z.array(z.string()) }),
          z.object({ kind: z.literal("note"), body: z.string() }),
        ]),
      }),
    );
    const repaired: string[] = [];
    const input = { step: { kind: "note", body: "[1, 2]" } };
    expect(decodeNestedJson(union, input, repaired)).toBe(input);
    expect(repaired).toEqual([]);
  });

  it("leaves text that is not the expected JSON, and returns untouched input as is", () => {
    const repaired: string[] = [];
    const input = { note: "n", items: "[not json", meta: "[1, 2]" };
    expect(decodeNestedJson(json, input, repaired)).toBe(input);
    expect(repaired).toEqual([]);
  });
});

describe("validateStructured repairs before it validates", () => {
  it("accepts a requirement list sent as JSON text (the OED RFP failure) and reports the repair", () => {
    const v = validateStructured(solicitationExtractionSchema, {
      ...base,
      structured: { ...frontMatter, requirements: JSON.stringify([requirement]) },
    });
    expect(v.parseError).toBeNull();
    expect(v.data?.requirements).toEqual([requirement]);
    expect(v.repaired).toEqual(["requirements"]);
  });

  it("repairs JSON found in prose answers too", () => {
    const v = validateStructured(solicitationExtractionSchema, {
      ...base,
      text: `Here you go: ${JSON.stringify({ ...frontMatter, requirements: JSON.stringify([requirement]) })}`,
    });
    expect(v.viaTool).toBe(false);
    expect(v.data?.requirements).toEqual([requirement]);
  });

  it("says what was wrong when validation still fails", () => {
    const strict = z.object({ requirements: z.array(z.string()) });
    const v = validateStructured(strict, { ...base, structured: { requirements: "not a list" } });
    expect(v.data).toBeNull();
    expect(v.parseError).toMatch(/requirements: .*expected array/);
  });
});

describe("solicitation answers degrade field by field", () => {
  it("the requirement sweep reads each entry on its own: odd kinds and refs are kept, an entry without text is dropped", () => {
    const v = validateStructured(requirementsChunkSchema, {
      ...base,
      structured: {
        requirements: [
          { kind: "shall", text: "The contractor shall deliver 10 laptops.", ref: "1" },
          { kind: "Must", text: "Quotes must be received by 5pm.", ref: null },
          { kind: "Should", text: "Offerors should include a warranty." },
          { kind: "shall", ref: "2" },
        ],
      },
    });
    expect(v.parseError).toBeNull();
    expect(normalizeRequirementList(v.data?.requirements)).toEqual([
      { kind: "shall", text: "The contractor shall deliver 10 laptops.", ref: "1" },
      { kind: "shall", text: "Quotes must be received by 5pm.", ref: "" },
      { kind: "should", text: "Offerors should include a warranty.", ref: "" },
    ]);
  });

  it("a whole answer without a requirement list is still a failed window (split or read again)", () => {
    expect(validateStructured(requirementsChunkSchema, { ...base, structured: {} }).data).toBeNull();
  });

  it("kinds and types written in the model's own words map to the allowed values", () => {
    expect(["Shall", " MAY ", "should", "Must", "will", 7].map(requirementKindOf)).toEqual(["shall", "may", "should", "shall", "shall", "shall"]);
    expect(choiceOf(SOLICITATION_TYPES, "RFP", "other")).toBe("rfp");
    expect(choiceOf(SOLICITATION_TYPES, "Sources Sought", "other")).toBe("sources_sought");
    expect(choiceOf(SOLICITATION_TYPES, "contract", "other")).toBe("other");
    expect(choiceOf(KEY_DATE_TYPES, "Proposal-Due", "other")).toBe("proposal_due");
  });

  it("front matter: a bad or missing field falls back on its own; requirements are not part of it", () => {
    const v = validateStructured(solicitationFrontMatterSchema, {
      ...base,
      structured: {
        title: "OED Help Desk",
        type: ["rfp"],
        naicsCode: 541513,
        responseDueDate: 20261108,
        keyDates: [{ label: "Questions due", isoDate: "2026-10-20", type: "q_and_a" }, { isoDate: "2026-11-01" }],
        requirements: "anything",
      },
    });
    expect(v.parseError).toBeNull();
    expect(v.data).toEqual({
      title: "OED Help Desk",
      agency: "",
      office: "",
      solicitationNumber: "",
      type: "other",
      naicsCode: "",
      setAside: "",
      responseDueDate: null,
      sectionLSummary: "",
      sectionMSummary: "",
      // The caller maps the type with choiceOf; here it is kept as written.
      keyDates: [{ label: "Questions due", isoDate: "2026-10-20", type: "q_and_a" }, null],
    });
  });

  it("vision answers: an unreadable requirement becomes null, a missing ref falls back, the kind is kept for mapping", () => {
    const v = validateStructured(solicitationExtractionSchema, {
      ...base,
      structured: { ...frontMatter, requirements: [{ kind: "Must", text: "Submit monthly reports." }, { kind: "shall" }, requirement] },
    });
    expect(v.data?.requirements).toEqual([{ kind: "Must", text: "Submit monthly reports.", ref: "" }, null, requirement]);
  });

  it("the model is still shown each field's type and allowed values", () => {
    const front = zodToToolSchema(solicitationFrontMatterSchema) as { properties: Record<string, Record<string, unknown>> };
    expect(Object.keys(front.properties)).not.toContain("requirements");
    expect(front.properties.type).toMatchObject({ type: "string", enum: ["rfp", "rfi", "rfq", "sources_sought", "other"] });
    expect(front.properties.keyDates).toMatchObject({ type: "array" });
    const vision = zodToToolSchema(solicitationExtractionSchema) as { properties: Record<string, Record<string, unknown>> };
    expect(vision.properties.requirements).toMatchObject({ type: "array" });
    const chunk = JSON.stringify(zodToToolSchema(requirementsChunkSchema));
    expect(chunk).toContain('"kind":{"default":"shall","type":"string","enum":["shall","should","may"]}');
  });
});

describe("describeZodIssue", () => {
  it("describes a bare 'Invalid input' issue from its own fields (production bundles)", () => {
    const issue = { code: "invalid_type", expected: "array", path: ["requirements"], message: "Invalid input", input: undefined } as unknown as z.core.$ZodIssue;
    expect(describeZodIssue(issue, { requirements: "[...]" })).toBe("requirements: expected array, received string");
    expect(describeZodIssue(issue)).toBe("requirements: expected array");
    const root = { code: "invalid_type", expected: "object", path: [], message: "Invalid input" } as unknown as z.core.$ZodIssue;
    expect(describeZodIssue(root, undefined)).toBe("(root): expected object, received undefined");
    expect(describeZodIssue(root)).toBe("(root): expected object");
    const enumIssue = { code: "invalid_value", values: ["rfp", "rfi"], path: ["type"], message: "Invalid input" } as unknown as z.core.$ZodIssue;
    expect(describeZodIssue(enumIssue)).toBe('type: expected one of "rfp", "rfi"');
  });

  it("keeps a message the schema set itself, and joins the first few issues", () => {
    const schema = z.object({ name: z.string().min(1, "Name is required"), count: z.number() });
    const parsed = schema.safeParse({ name: "", count: "3" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const text = describeZodIssues(parsed.error, { name: "", count: "3" });
    expect(text).toContain("name: Name is required");
    expect(text).toContain("count: ");
  });
});
