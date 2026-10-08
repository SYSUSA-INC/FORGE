/**
 * BL-STAB-1 / BL-STAB-9 — schema fields that degrade one by one.
 *
 * A model's answer that gets one field wrong should not fail the whole
 * answer. These helpers give a field a fallback for a missing or
 * malformed value; the caller maps free-text choices itself. Shared by
 * every prompt module (kept apart from `ai-prompts.ts` so modules it
 * re-exports can use them without an import cycle).
 */
import { z } from "zod";

/** The schema, or `fallback` when the value is missing or does not validate. */
export function tolerant<T extends z.ZodType>(schema: T, fallback: z.output<T>) {
  return schema.default(fallback as never).catch(fallback as never);
}

/**
 * A field the model is shown as a fixed set of values. Any text is
 * accepted ("RFP", "Shall") and the caller maps it with `choiceOf`; a
 * missing value becomes the fallback.
 */
export function choice(values: readonly string[], fallback: string) {
  return tolerant(z.string().meta({ enum: [...values] }), fallback);
}

/**
 * One of `values` for what a model wrote, ignoring case, spaces and
 * hyphens ("Sources Sought" → "sources_sought"); the fallback otherwise.
 */
export function choiceOf<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  const word = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (values as readonly string[]).includes(word) ? (word as T) : fallback;
}

/**
 * A list whose entries are read one by one: an entry that does not
 * validate is dropped instead of failing the list, a missing list is
 * empty, and at most `max` entries are kept. The model is still shown
 * the entry's shape.
 */
export function tolerantList<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item.nullable().catch(null))
    .default([])
    .catch([])
    .transform((list) => list.filter((entry): entry is NonNullable<typeof entry> => entry !== null).slice(0, max) as z.output<T>[]);
}
