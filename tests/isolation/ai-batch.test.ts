/**
 * BL-AIX Phase 1g-2 — the scout's triage through a Message Batch, against
 * Postgres, with the provider's batch endpoints mocked.
 *
 * Asserts: the submitted requests carry the routed model, the gateway's
 * quoted-material rule and the forced tool; an unfinished batch stays
 * open; an ended one is applied to the batch's own organization only
 * (a custom id naming another tenant's candidate changes nothing), every
 * outcome is logged as a batched ai_call_log row, a failed request
 * clears its candidate's marker, the run's triaged count is recomputed,
 * and a batch that never finishes is given up.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiBatches, aiCallLogs, scoutCandidates, scoutRuns } from "@/db/schema";
import { __setBatchTransportForTest, type BatchTransport } from "@/lib/ai-batch";
import { collectAiBatches, queueAiBatch } from "@/lib/ai-batch-queue";
import { buildScoutTriagePrompt, SCOUT_TRIAGE_PROMPT_VERSION, scoutTriageSchema } from "@/lib/ai-prompts";
import { zodToToolSchema } from "@/lib/ai";
import { DEFAULT_ANTHROPIC_FAST_MODEL } from "@/lib/ai-routing";
import { withUntrustedContentRule } from "@/lib/prompt-safety";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const ENV_KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_MODEL_FAST", "AI_MODEL_ROUTING", "AI_BATCH_NIGHTLY"] as const;
let savedEnv: Record<string, string | undefined> = {};

const TRIAGE = { recommendation: "pursue", confidence: 0.8, rationale: "Strong NAICS fit and a known customer.", nextActions: ["Read Section M"] };

function succeeded(customId: string, input: unknown) {
  return JSON.stringify({
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        model: "claude-haiku-test",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_scout_triage", input }],
        usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900 },
      },
    },
  });
}

describe("BL-AIX Phase 1g-2 — batched scout triage (runtime)", () => {
  let fx: TwoTenantFixture;
  let a1: string;
  let a2: string;
  let b1: string;
  let runId: string;
  let created: { custom_id: string; params: Record<string, unknown> }[] = [];
  let ended = false;
  let results = "";

  beforeEach(async () => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";

    fx = await createTwoTenants("ai-batch");
    const [run] = await db.insert(scoutRuns).values({ organizationId: fx.orgA.organizationId, trigger: "cron" }).returning({ id: scoutRuns.id });
    runId = run!.id;
    const rows = await db
      .insert(scoutCandidates)
      .values([
        { organizationId: fx.orgA.organizationId, runId, source: "org_naics", noticeId: "n-a1", title: "A one", fitScore: 80 },
        { organizationId: fx.orgA.organizationId, runId, source: "keyword", noticeId: "n-a2", title: "A two", fitScore: 60 },
        { organizationId: fx.orgB.organizationId, source: "org_naics", noticeId: "n-b1", title: "B one", fitScore: 70 },
      ])
      .returning({ id: scoutCandidates.id, title: scoutCandidates.title });
    a1 = rows.find((r) => r.title === "A one")!.id;
    a2 = rows.find((r) => r.title === "A two")!.id;
    b1 = rows.find((r) => r.title === "B one")!.id;

    created = [];
    ended = false;
    results = "";
    const transport: BatchTransport = {
      async create(requests) {
        created = requests;
        return "msgbatch_test";
      },
      async retrieve() {
        return { ended, resultsUrl: ended ? "https://example.invalid/results" : null };
      },
      async results() {
        return results;
      },
    };
    __setBatchTransportForTest(transport);
  });

  afterEach(async () => {
    __setBatchTransportForTest(null);
    await fx.cleanup();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function queue(customIds: string[]) {
    const prompt = buildScoutTriagePrompt({
      organizationName: "Org A",
      asOf: "2026-10-07",
      organization: { primaryNaics: "541512", naicsList: [], setAsides: [], keywords: [] },
      candidate: {
        source: "org_naics",
        title: "A one",
        agency: "DOE",
        office: "",
        noticeType: "Solicitation",
        solicitationNumber: "",
        naicsCode: "541512",
        pscCode: "",
        setAside: "",
        incumbent: "",
        postedAt: null,
        responseDueAt: null,
        daysToDue: null,
        placeOfPerformance: "",
        description: "",
      },
      fitScore: 80,
      signals: [],
      recompete: null,
      customer: null,
      history: { imported: [], dismissed: [], track: { n: 0, accuracy: null } },
    });
    const { batchId } = await queueAiBatch({
      organizationId: fx.orgA.organizationId,
      feature: "opportunity_triage",
      promptVersion: SCOUT_TRIAGE_PROMPT_VERSION,
      context: { runId },
      requests: customIds.map((customId) => ({
        customId,
        opts: {
          system: prompt.system,
          messages: prompt.messages,
          tool: { name: "record_scout_triage", description: "Record the triage.", inputSchema: zodToToolSchema(scoutTriageSchema) },
          maxTokens: 600,
          temperature: 0.2,
          cacheSystem: true,
        },
      })),
    });
    // As the scout does: only its own candidates wait on the batch.
    await db.update(scoutCandidates).set({ triageBatchId: batchId }).where(inArray(scoutCandidates.id, [a1, a2]));
    return { batchId, system: prompt.system };
  }

  it("submits the routed model, the quoted-material rule and the forced tool", async () => {
    const { system } = await queue([a1, a2]);
    expect(created.map((r) => r.custom_id)).toEqual([a1, a2]);
    const params = created[0]!.params as { model: string; max_tokens: number; system: { text: string }[]; tool_choice: { name: string } };
    expect(params.model).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
    expect(params.max_tokens).toBe(600);
    expect(params.system[0]!.text).toBe(withUntrustedContentRule(system));
    expect(params.tool_choice.name).toBe("record_scout_triage");
  });

  it("leaves an unfinished batch open, then applies the ended one to its own organization only", async () => {
    const { batchId } = await queue([a1, a2, b1]);

    expect(await collectAiBatches()).toMatchObject({ checked: 1, pending: 1, processed: 0 });
    const [open] = await db.select().from(aiBatches).where(eq(aiBatches.id, batchId));
    expect(open!.status).toBe("submitted");
    expect(open!.checkedAt).not.toBeNull();

    ended = true;
    results = [
      succeeded(a1, TRIAGE),
      JSON.stringify({ custom_id: a2, result: { type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "busy" } } } }),
      succeeded(b1, TRIAGE),
    ].join("\n");
    expect(await collectAiBatches()).toMatchObject({ processed: 1, succeeded: 1, failed: 2 });

    const cands = await db.select().from(scoutCandidates).where(inArray(scoutCandidates.id, [a1, a2, b1]));
    const by = new Map(cands.map((c) => [c.id, c]));
    expect(by.get(a1)).toMatchObject({ recommendation: "pursue", confidence: 0.8, triageBatchId: null, model: "claude-haiku-test", promptVersion: SCOUT_TRIAGE_PROMPT_VERSION });
    expect(by.get(a2)).toMatchObject({ recommendation: null, triageBatchId: null });
    // Another tenant's candidate named in the batch is never touched.
    expect(by.get(b1)).toMatchObject({ recommendation: null, triageBatchId: null });

    const [batch] = await db.select().from(aiBatches).where(eq(aiBatches.id, batchId));
    expect(batch).toMatchObject({ status: "processed", succeeded: 1, failed: 2 });
    const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId));
    expect(run!.triaged).toBe(1);

    const logsA = await db.select().from(aiCallLogs).where(eq(aiCallLogs.organizationId, fx.orgA.organizationId));
    expect(logsA).toHaveLength(3);
    expect(logsA.every((r) => r.batched && r.variant === "batch" && r.feature === "opportunity_triage" && r.latencyMs === 0)).toBe(true);
    const ok = logsA.filter((r) => r.status === "ok");
    expect(ok).toHaveLength(2);
    expect(ok[0]).toMatchObject({ inputTokens: 1_000, cacheReadTokens: 900, outputTokens: 40, viaTool: true, parseOk: true });
    expect(logsA.find((r) => r.status === "error")!.error).toBe("overloaded_error: busy");
    expect(await db.select().from(aiCallLogs).where(eq(aiCallLogs.organizationId, fx.orgB.organizationId))).toHaveLength(0);

    // Read once: a second tick finds nothing open.
    expect(await collectAiBatches()).toMatchObject({ checked: 0, processed: 0 });
  });

  it("gives up on a batch that never finishes and clears its candidates", async () => {
    const { batchId } = await queue([a1, a2]);
    await db.update(aiBatches).set({ submittedAt: new Date(Date.now() - 27 * 60 * 60_000) }).where(eq(aiBatches.id, batchId));
    expect(await collectAiBatches()).toMatchObject({ givenUp: 1, failed: 2 });
    const [batch] = await db.select().from(aiBatches).where(eq(aiBatches.id, batchId));
    expect(batch).toMatchObject({ status: "failed", error: "The batch did not finish within 26 hours." });
    const cands = await db.select().from(scoutCandidates).where(inArray(scoutCandidates.id, [a1, a2]));
    expect(cands.every((c) => c.triageBatchId === null && c.recommendation === null)).toBe(true);
  });
});
