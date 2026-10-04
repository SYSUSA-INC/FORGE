/**
 * BL-16 API Slice 2a — the OpenAPI 3.1 description of /api/v1, served at
 * /api/v1/openapi.json. Built from the constants the handlers use (page
 * sizes, rate limit, token prefix) and the stage lists passed in, so those
 * can't drift. A unit test checks that every documented path has a route,
 * every route is documented, and the documented fields match the JSON the
 * handlers return.
 */

import { API_PAGE_DEFAULT, API_PAGE_MAX, API_RATE_LIMIT, API_TOKEN_PREFIX } from "@/lib/api-tokens-logic";

export const API_DOC_VERSION = "1.2.0";

type Schema = Record<string, unknown>;

const str = (description?: string): Schema => (description ? { type: "string", description } : { type: "string" });
const int = (description?: string): Schema => (description ? { type: "integer", description } : { type: "integer" });
const dateTime: Schema = { type: "string", format: "date-time" };
const nullableDateTime: Schema = { type: ["string", "null"], format: "date-time" };
const uuid: Schema = { type: "string", format: "uuid" };
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

function object(properties: Record<string, Schema>): Schema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

const okResponse = (schema: Schema, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});

/** The answers every endpoint can give besides its own 200. */
const COMMON_ERRORS = {
  "401": errorResponse("Missing, unrecognised, revoked or expired token."),
  "403": errorResponse("The workspace is disabled, or its plan doesn't include API access."),
  "429": {
    ...errorResponse(`Over ${API_RATE_LIMIT.limit} requests a minute for this token.`),
    headers: { "Retry-After": { description: "Seconds until the limit resets.", schema: int() } },
  },
  "500": errorResponse("Unexpected server error."),
};

const idParam = (what: string) => ({
  name: "id",
  in: "path",
  required: true,
  description: `The ${what}'s id.`,
  schema: uuid,
});

function listParams(stages: readonly string[]) {
  return [
    {
      name: "limit",
      in: "query",
      description: `Page size, 1–${API_PAGE_MAX}.`,
      schema: { type: "integer", minimum: 1, maximum: API_PAGE_MAX, default: API_PAGE_DEFAULT },
    },
    { name: "cursor", in: "query", description: "The nextCursor from the previous page.", schema: str() },
    { name: "updated_since", in: "query", description: "Only rows changed at or after this time (ISO 8601).", schema: dateTime },
    { name: "stage", in: "query", description: "Only rows in this stage.", schema: { type: "string", enum: [...stages] } },
  ];
}

const page = (item: string): Schema =>
  object({
    data: { type: "array", items: ref(item) },
    nextCursor: { type: ["string", "null"], description: "Pass as cursor for the next page; null on the last page." },
  });

export type OpenApiInput = {
  baseUrl: string;
  opportunityStages: readonly string[];
  proposalStages: readonly string[];
  sectionKinds: readonly string[];
  sectionStatuses: readonly string[];
};

export function buildOpenApiDocument(input: OpenApiInput) {
  const { baseUrl, opportunityStages, proposalStages, sectionKinds, sectionStatuses } = input;

  const opportunity = {
    id: uuid,
    title: str(),
    agency: str(),
    office: str(),
    stage: { type: "string", enum: [...opportunityStages] },
    solicitationNumber: str(),
    samNoticeId: str("The SAM.gov notice id, when the opportunity came from SAM.gov."),
    naicsCode: str(),
    pscCode: str(),
    setAside: str(),
    contractType: str(),
    placeOfPerformance: str(),
    incumbent: str(),
    valueLow: str("Free text as entered, e.g. \"$2.5M\"."),
    valueHigh: str("Free text as entered."),
    pWin: { type: "integer", minimum: 0, maximum: 100, description: "Probability of win, percent." },
    releaseDate: nullableDateTime,
    responseDueDate: nullableDateTime,
    awardDate: nullableDateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  };

  const proposal = {
    id: uuid,
    opportunityId: uuid,
    title: str(),
    stage: { type: "string", enum: [...proposalStages] },
    submittedAt: nullableDateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  };

  const section = {
    id: uuid,
    kind: { type: "string", enum: [...sectionKinds] },
    title: str(),
    ordering: int("Position in the proposal outline."),
    status: { type: "string", enum: [...sectionStatuses] },
    wordCount: int(),
    pageLimit: { type: ["integer", "null"] },
    updatedAt: dateTime,
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "FORGE API",
      version: API_DOC_VERSION,
      description:
        "Read-only access to one workspace's pipeline and proposals. Create a token under Settings → API access " +
        "and send it on every request. Lists run newest change first. Every answered request is recorded in the " +
        "workspace's audit log.",
    },
    servers: [{ url: `${baseUrl.replace(/\/+$/, "")}/api/v1` }],
    security: [{ bearerToken: [] }],
    paths: {
      "/me": {
        get: {
          operationId: "getMe",
          summary: "The workspace and token you are calling with",
          responses: { "200": okResponse(object({ organization: ref("Organization"), token: ref("Token") })), ...COMMON_ERRORS },
        },
      },
      "/opportunities": {
        get: {
          operationId: "listOpportunities",
          summary: "Pipeline opportunities, newest change first",
          parameters: listParams(opportunityStages),
          responses: { "200": okResponse(page("Opportunity")), "400": errorResponse("A list parameter is invalid."), ...COMMON_ERRORS },
        },
      },
      "/opportunities/{id}": {
        get: {
          operationId: "getOpportunity",
          summary: "One opportunity, with its description",
          parameters: [idParam("opportunity")],
          responses: {
            "200": okResponse(object({ data: ref("OpportunityDetail") })),
            "404": errorResponse("No opportunity with that id in this workspace."),
            ...COMMON_ERRORS,
          },
        },
      },
      "/proposals": {
        get: {
          operationId: "listProposals",
          summary: "Proposals, newest change first",
          parameters: listParams(proposalStages),
          responses: { "200": okResponse(page("Proposal")), "400": errorResponse("A list parameter is invalid."), ...COMMON_ERRORS },
        },
      },
      "/proposals/{id}": {
        get: {
          operationId: "getProposal",
          summary: "One proposal with its section outline (titles, status, word counts — not the text)",
          parameters: [idParam("proposal")],
          responses: {
            "200": okResponse(object({ data: ref("ProposalDetail") })),
            "404": errorResponse("No proposal with that id in this workspace."),
            ...COMMON_ERRORS,
          },
        },
      },
      "/proposals/{id}/sections/{sectionId}": {
        get: {
          operationId: "getSection",
          summary: "One section with its text, as plain text and HTML",
          description:
            "The text is the final view — pending tracked insertions kept, pending deletions dropped — the same one PDF and Word exports use. hasPendingChanges says whether suggestions are still open.",
          parameters: [
            idParam("proposal"),
            { name: "sectionId", in: "path", required: true, description: "The section's id, from the proposal's outline.", schema: uuid },
          ],
          responses: {
            "200": okResponse(object({ data: ref("SectionDetail") })),
            "404": errorResponse("No such section on that proposal in this workspace."),
            ...COMMON_ERRORS,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description: `A workspace API token, \`${API_TOKEN_PREFIX}…\`. Rate limit: ${API_RATE_LIMIT.limit} requests a minute per token.`,
        },
      },
      schemas: {
        Error: object({ error: str("What went wrong, in plain words.") }),
        Organization: object({ id: uuid, name: str() }),
        Token: object({ name: str(), prefix: str("The token's first characters, as shown in Settings."), expiresAt: nullableDateTime }),
        Opportunity: object(opportunity),
        OpportunityDetail: object({ ...opportunity, description: str() }),
        Proposal: object(proposal),
        ProposalDetail: object({ ...proposal, sections: { type: "array", items: ref("Section") } }),
        Section: object(section),
        SectionDetail: object({
          ...section,
          proposalId: uuid,
          instructions: str("What Section L says this section must contain, when known."),
          text: str("The section's text, final view, paragraphs separated by a blank line."),
          html: str("The same text as HTML (paragraphs, headings, lists, tables, links)."),
          hasPendingChanges: { type: "boolean", description: "True while tracked suggestions are still pending." },
        }),
      },
    },
  };
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
