/**
 * BL-16 API Slice 2a — the OpenAPI document can't drift from the API:
 * every documented path has a route handler and every handler is
 * documented; every $ref resolves; the documented fields are exactly the
 * keys the response shapers return; paging limits and stages come from
 * the same constants. Plus the platform-admin revoke reason rules.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { opportunityStageEnum, proposalSectionKindEnum, proposalSectionStatusEnum, proposalStageEnum } from "@/db/schema";
import { buildOpenApiDocument } from "@/lib/api-openapi";
import { apiSectionBody } from "@/lib/api-section-body";
import {
  API_PAGE_DEFAULT,
  API_PAGE_MAX,
  apiOpportunity,
  apiProposal,
  apiSection,
  REVOKE_REASON_MAX,
  validateRevokeReason,
} from "@/lib/api-tokens-logic";

const doc = buildOpenApiDocument({
  baseUrl: "https://forge.example/",
  opportunityStages: opportunityStageEnum.enumValues,
  proposalStages: proposalStageEnum.enumValues,
  sectionKinds: proposalSectionKindEnum.enumValues,
  sectionStatuses: proposalSectionStatusEnum.enumValues,
});

const V1_DIR = join(process.cwd(), "src/app/api/v1");

/** "/opportunities/{id}" for src/app/api/v1/opportunities/[id]/route.ts. */
function routePaths(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routePaths(full));
    else if (name === "route.ts") {
      const rel = relative(V1_DIR, dir).split(sep).join("/");
      out.push(`/${rel}`.replace(/\[(\w+)\]/g, "{$1}"));
    }
  }
  return out;
}

function refs(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(refs);
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => (k === "$ref" && typeof v === "string" ? [v] : refs(v)));
  }
  return [];
}

const schemas = doc.components.schemas as unknown as Record<string, { properties: Record<string, unknown>; required: string[] }>;
const props = (name: string) => Object.keys(schemas[name]!.properties).sort();

const at = new Date("2026-10-01T00:00:00Z");
const oppKeys = Object.keys(
  apiOpportunity({
    id: "i", title: "", agency: "", office: "", stage: "identified", solicitationNumber: "", noticeId: "", naicsCode: "", pscCode: "",
    setAside: "", contractType: "", placeOfPerformance: "", incumbent: "", valueLow: "", valueHigh: "", pWin: 0,
    releaseDate: null, responseDueDate: null, awardDate: null, createdAt: at, updatedAt: at,
  }),
).sort();

describe("OpenAPI document for /api/v1", () => {
  it("documents exactly the routes that exist (the document itself aside)", () => {
    const routes = routePaths(V1_DIR).filter((p) => p !== "/openapi.json").sort();
    expect(Object.keys(doc.paths).sort()).toEqual(routes);
  });

  it("resolves every $ref and is OpenAPI 3.1 with a clean server URL", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://forge.example/api/v1" }]);
    for (const r of refs(doc)) {
      const name = r.replace("#/components/schemas/", "");
      expect(schemas[name], r).toBeDefined();
    }
  });

  it("documents exactly the fields the handlers return", () => {
    expect(props("Opportunity")).toEqual(oppKeys);
    expect(props("OpportunityDetail")).toEqual([...oppKeys, "description"].sort());
    expect(props("Proposal")).toEqual(
      Object.keys(apiProposal({ id: "p", opportunityId: "o", title: "", stage: "draft", submittedAt: null, createdAt: at, updatedAt: at })).sort(),
    );
    expect(props("ProposalDetail")).toEqual([...props("Proposal"), "sections"].sort());
    expect(props("Section")).toEqual(
      Object.keys(apiSection({ id: "s", kind: "technical", title: "", ordering: 0, status: "not_started", wordCount: 0, pageLimit: null, updatedAt: at })).sort(),
    );
    expect(props("SectionDetail")).toEqual([...props("Section"), "proposalId", "instructions", ...Object.keys(apiSectionBody(null, ""))].sort());
    // Every documented field is required: the API always sends it, null or not.
    for (const s of Object.values(schemas)) expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
  });

  it("takes paging limits and stages from the API's own constants", () => {
    const list = doc.paths["/opportunities"].get.parameters;
    const limit = list.find((p) => p.name === "limit")!;
    expect(limit.schema).toMatchObject({ maximum: API_PAGE_MAX, default: API_PAGE_DEFAULT });
    expect(list.find((p) => p.name === "stage")!.schema).toMatchObject({ enum: [...opportunityStageEnum.enumValues] });
    expect(doc.paths["/proposals"].get.parameters.find((p) => p.name === "stage")!.schema).toMatchObject({ enum: [...proposalStageEnum.enumValues] });
  });
});

describe("validateRevokeReason", () => {
  it("needs a short, real reason", () => {
    expect(validateRevokeReason("  Leaked   in ticket 42 ")).toEqual({ ok: true, value: "Leaked in ticket 42" });
    expect(validateRevokeReason("no")).toMatchObject({ ok: false });
    expect(validateRevokeReason(undefined)).toMatchObject({ ok: false });
    expect(validateRevokeReason("x".repeat(REVOKE_REASON_MAX + 1))).toMatchObject({ ok: false });
  });
});

describe("apiSectionBody", () => {
  const doc = {
    type: "doc" as const,
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Approach" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "We deliver " },
          { type: "text", text: "late ", marks: [{ type: "tcDelete", attrs: {} }] },
          { type: "text", text: "on time", marks: [{ type: "tcInsert", attrs: {} }] },
          { type: "text", text: "." },
        ],
      },
    ],
  };

  it("returns the final view as text and HTML and flags pending suggestions", () => {
    const body = apiSectionBody(doc, "ignored legacy text");
    expect(body.text).toBe("Approach\n\nWe deliver on time.");
    expect(body.html).toContain("<h2>Approach</h2>");
    expect(body.html).not.toContain("late");
    expect(body.hasPendingChanges).toBe(true);
  });

  it("falls back to the legacy plain content when there is no rich body", () => {
    const body = apiSectionBody({ type: "doc", content: [] }, "First para.\n\nSecond para.");
    expect(body).toMatchObject({ text: "First para.\n\nSecond para.", hasPendingChanges: false });
    expect(body.html).toContain("<p>First para.</p>");
    expect(apiSectionBody(null, "")).toEqual({ text: "", html: "", hasPendingChanges: false });
  });
});
