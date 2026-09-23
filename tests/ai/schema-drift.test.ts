/**
 * BL-TENANT-DRIFT — the static index-parity parsers behind
 * scripts/check-schema-drift.mjs.
 */

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM script without types
import { diffIndexes, indexesFromSchema, indexesFromSql } from "../../scripts/check-schema-drift.mjs";

describe("schema drift — SQL parser", () => {
  it("collects CREATE INDEX with UNIQUE, partial WHERE, IF NOT EXISTS, USING and expressions", () => {
    const idx = indexesFromSql([
      {
        name: "0001_a.sql",
        sql: `
          -- CREATE INDEX "commented_out_idx" ON "t" ("c");
          CREATE INDEX IF NOT EXISTS "plain_idx" ON "t" ("a");--> statement-breakpoint
          CREATE UNIQUE INDEX IF NOT EXISTS harvest_unique
            ON knowledge_artifact (organization_id, ((metadata ->> 'proposalId')))
            WHERE source = 'mined_from_proposal';
          CREATE INDEX "vec_idx" ON "chunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
          CREATE INDEX "partial_idx" ON "pe" ("organization_id", "received_at" DESC) WHERE "organization_id" IS NOT NULL;
        `,
      },
    ]);
    expect([...idx.keys()].sort()).toEqual(["harvest_unique", "partial_idx", "plain_idx", "vec_idx"]);
    expect(idx.get("plain_idx")).toMatchObject({ table: "t", unique: false, partial: false });
    expect(idx.get("harvest_unique")).toMatchObject({ table: "knowledge_artifact", unique: true, partial: true });
    expect(idx.get("vec_idx")).toMatchObject({ table: "chunk", unique: false, partial: false });
    expect(idx.get("partial_idx")).toMatchObject({ unique: false, partial: true });
  });

  it("applies DROP INDEX, ALTER INDEX RENAME and DROP TABLE in migration order", () => {
    const idx = indexesFromSql([
      { name: "0001.sql", sql: `CREATE INDEX "old_idx" ON "a" ("x"); CREATE INDEX "gone_idx" ON "a" ("y"); CREATE INDEX "b_idx" ON "b" ("z");` },
      { name: "0002.sql", sql: `ALTER INDEX "old_idx" RENAME TO "new_idx"; DROP INDEX IF EXISTS "gone_idx"; DROP TABLE "b";` },
    ]);
    expect([...idx.keys()]).toEqual(["new_idx"]);
    expect(idx.get("new_idx")?.table).toBe("a");
  });
});

describe("schema drift — schema.ts parser", () => {
  it("reads index/uniqueIndex names and detects .where() anywhere in the chain", () => {
    const src = `
      export const t = pgTable("t", { a: text("a") }, (t) => ({
        plain: index("plain_idx").on(t.a),
        part: index("partial_idx")
          .on(t.a, t.b)
          .where(sql\`\${t.a} IS NOT NULL\`),
        uniq: uniqueIndex("harvest_unique")
          .on(t.org, sql\`((\${t.metadata} ->> 'proposalId'))\`)
          .where(sql\`\${t.source} = 'mined_from_proposal'\`),
        vec: index("vec_idx").using("ivfflat", t.embedding.op("vector_cosine_ops")).with({ lists: 100 }),
        // prettier wraps long names onto their own line with a trailing comma
        wrapped: uniqueIndex(
          "wrapped_uq",
        ).on(t.organizationId, t.solicitationId),
        wrappedPlain: index(
          "wrapped_idx",
        ).on(t.status, t.createdAt),
      }));
    `;
    const idx = indexesFromSchema(src);
    expect([...idx.keys()].sort()).toEqual([
      "harvest_unique",
      "partial_idx",
      "plain_idx",
      "vec_idx",
      "wrapped_idx",
      "wrapped_uq",
    ]);
    expect(idx.get("wrapped_uq")).toMatchObject({ unique: true, partial: false });
    expect(idx.get("wrapped_idx")).toMatchObject({ unique: false, partial: false });
    expect(idx.get("plain_idx")).toMatchObject({ unique: false, partial: false });
    expect(idx.get("partial_idx")).toMatchObject({ unique: false, partial: true });
    expect(idx.get("harvest_unique")).toMatchObject({ unique: true, partial: true });
    expect(idx.get("vec_idx")).toMatchObject({ unique: false, partial: false });
  });
});

describe("schema drift — diff", () => {
  it("reports sql-only, schema-only, unique and partial mismatches, honouring the allow-list", () => {
    const sql = new Map([
      ["only_in_sql", { table: "a", unique: false, partial: false, file: "0001.sql" }],
      ["uniq_mismatch", { table: "a", unique: true, partial: false, file: "0001.sql" }],
      ["partial_mismatch", { table: "a", unique: false, partial: true, file: "0001.sql" }],
      ["fine", { table: "a", unique: false, partial: true, file: "0001.sql" }],
      ["allowed", { table: "a", unique: false, partial: false, file: "0001.sql" }],
    ]);
    const schema = new Map([
      ["only_in_schema", { unique: false, partial: false, line: 1 }],
      ["uniq_mismatch", { unique: false, partial: false, line: 2 }],
      ["partial_mismatch", { unique: false, partial: false, line: 3 }],
      ["fine", { unique: false, partial: true, line: 4 }],
    ]);
    const problems = diffIndexes(sql, schema, { allowed: "legacy" });
    expect(problems.map((p: { name: string; kind: string }) => `${p.name}:${p.kind}`)).toEqual([
      "only_in_schema:schema_only",
      "only_in_sql:sql_only",
      "partial_mismatch:partial_mismatch",
      "uniq_mismatch:unique_mismatch",
    ]);
  });
});
