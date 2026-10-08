/**
 * Describe zod validation issues in words that survive a production build.
 *
 * Zod sets up its English messages in a module the package marks as free
 * of side effects, so a production bundle can drop it and every built-in
 * message then reads just "Invalid input" — which is all production logs
 * and error screens showed. When a message is that bare fallback, the
 * issue is described from its own fields instead (what was expected, and
 * what the value at that path actually was). Messages a schema sets
 * itself are kept as they are.
 */
import type { z } from "zod";

type Issue = z.core.$ZodIssue;

const GENERIC = "Invalid input";
/** Marks "no input given", so an input of `undefined` is still described. */
const NO_INPUT = Symbol("no input");

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** The value at an issue's path in the input, if it can be reached. */
function valueAt(input: unknown, path: readonly PropertyKey[]): { found: boolean; value: unknown } {
  let current: unknown = input;
  for (const key of path) {
    if (current === null || typeof current !== "object") return { found: false, value: undefined };
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return { found: true, value: current };
}

function detail(issue: Issue, input: unknown): string {
  switch (issue.code) {
    case "invalid_type": {
      const at = input === NO_INPUT ? { found: false, value: undefined } : valueAt(input, issue.path);
      return `expected ${issue.expected}${at.found ? `, received ${kindOf(at.value)}` : ""}`;
    }
    case "invalid_value":
      return `expected one of ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "too_small":
      return `too small (${issue.origin} minimum ${String(issue.minimum)})`;
    case "too_big":
      return `too big (${issue.origin} maximum ${String(issue.maximum)})`;
    case "invalid_format":
      return `invalid ${issue.format}`;
    case "unrecognized_keys":
      return `unexpected keys ${issue.keys.join(", ")}`;
    default:
      return issue.code.replace(/_/g, " ");
  }
}

function describe(issue: Issue, input: unknown): string {
  const where = issue.path.map(String).join(".") || "(root)";
  const message = issue.message && issue.message !== GENERIC ? issue.message : detail(issue, input);
  return `${where}: ${message}`;
}

/**
 * One issue as `path: what was wrong`. Pass the validated input (even
 * `undefined`) to name the type received; leave it out when unknown.
 */
export function describeZodIssue(issue: Issue, ...input: [unknown?]): string {
  return describe(issue, input.length > 0 ? input[0] : NO_INPUT);
}

/**
 * The first few issues, joined with "; ", then how many more there were
 * and where (BL-STAB-9: three issues alone read as if every other field
 * passed). Pass the validated input as in `describeZodIssue`.
 */
export function describeZodIssues(error: z.ZodError, ...input: [unknown?]): string {
  const value = input.length > 0 ? input[0] : NO_INPUT;
  const shown = error.issues.slice(0, 3).map((i) => describe(i, value));
  const rest = error.issues.slice(3);
  if (rest.length === 0) return shown.join("; ");
  const where = [...new Set(rest.map((i) => i.path.map(String).join(".") || "(root)"))];
  const names = where.length > 5 ? `${where.slice(0, 5).join(", ")}, …` : where.join(", ");
  return `${shown.join("; ")}; and ${rest.length} more (${names})`;
}
