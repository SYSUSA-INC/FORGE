/**
 * A JavaScript array interpolated into a `sql` template is not bound as
 * a Postgres array: Drizzle expands it into a parenthesised list, one
 * parameter per element. `${col} = ANY(${emails})` therefore reaches
 * Postgres as `= ANY(($1))`, and every request fails with "malformed
 * array literal" as soon as the list has an element. That shipped twice
 * (the tenant activity page and the platform approval queue). Use
 * `inArray(column, values)`, which renders `in ($1, $2)` and `false` for
 * an empty list.
 *
 * `ANY(${…})` stays fine on an array column (`ANY(${table.tags})`), so
 * the guard below allows exactly that: a property of a table imported
 * from `@/db/schema`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { inArray, sql } from "drizzle-orm";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

const BEFORE_ARRAY_OPERAND = /\b(ANY|ALL)\s*\(\s*$/i;

/** `line: code` for each `ANY(${…})` / `ALL(${…})` whose operand is not a schema column. */
function arrayBindings(src: string, fileName = "file.tsx"): string[] {
  const file = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const schemaTables = new Set<string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "@/db/schema") continue;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) schemaTables.add(el.name.text);
  }
  const isSchemaColumn = (e: ts.Expression) =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && schemaTables.has(e.expression.text);

  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "sql" &&
      ts.isTemplateExpression(node.template)
    ) {
      const { head, templateSpans } = node.template;
      templateSpans.forEach((span, i) => {
        const before = i === 0 ? head.text : templateSpans[i - 1].literal.text;
        if (BEFORE_ARRAY_OPERAND.test(before) && !isSchemaColumn(span.expression)) {
          const line = file.getLineAndCharacterOfPosition(span.expression.getStart(file)).line + 1;
          found.push(`${line}: ${span.expression.getText(file)}`);
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("Drizzle binds a JavaScript array as a list, not a Postgres array", () => {
  const users = pgTable("user", { email: text("email") });
  const dialect = new PgDialect();

  it("so ANY(${array}) reaches Postgres as a row, which it rejects", () => {
    expect(dialect.sqlToQuery(sql`${users.email} = ANY(${["a@x.gov"]})`).sql).toBe('"user"."email" = ANY(($1))');
  });

  it("and inArray renders the list Postgres expects, empty included", () => {
    expect(dialect.sqlToQuery(inArray(users.email, ["a@x.gov", "b@x.gov"])).sql).toBe('"user"."email" in ($1, $2)');
    expect(dialect.sqlToQuery(inArray(users.email, [])).sql).toBe("false");
  });
});

describe("the guard", () => {
  it("flags an array value inside ANY( or ALL(", () => {
    const src = [
      'import { sql } from "drizzle-orm";',
      'import { users, organizations } from "@/db/schema";',
      "const a = sql`${users.email} = ANY(${emails})`;",
      "const b = sql`${organizations.id} = ANY(${ids}::uuid[])`;",
      "const c = sql`x <> all( ${filter.ids})`;",
    ].join("\n");
    expect(arrayBindings(src)).toEqual(["3: emails", "4: ids", "5: filter.ids"]);
  });

  it("allows an array column of a schema table, and ANY over a subquery", () => {
    const src = [
      'import { sql } from "drizzle-orm";',
      'import { knowledgeArtifacts } from "@/db/schema";',
      "const a = sql`${tag} = ANY(${knowledgeArtifacts.tags})`;",
      "const b = sql`x = ANY(select id from t)`;",
    ].join("\n");
    expect(arrayBindings(src)).toEqual([]);
  });
});

describe("no sql template binds a JavaScript array inside ANY() or ALL()", () => {
  it("every ANY / ALL operand in src is a schema column", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).flatMap((file) =>
      arrayBindings(readFileSync(file, "utf8"), file).map((hit) => `${rel(file)}:${hit}  (use inArray)`),
    );
    expect(offenders).toEqual([]);
  });
});
