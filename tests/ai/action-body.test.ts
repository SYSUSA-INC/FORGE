/**
 * BL-STAB-2f — what one server action can be sent: text is measured in
 * UTF-8 bytes of its JSON (never below Next's own count), pasted text
 * over the server's limit or the request's is refused with what to do,
 * and long lists are sent in parts that each fit one request.
 */
import { describe, expect, it } from "vitest";
import { ACTION_BODY_LIMIT_BYTES, TEXT_ACTION_MAX_BYTES, chunkByBytes, encodedBytes, pasteRefusal } from "@/lib/action-body";
import { CONTACT_LIMITS } from "@/lib/crm-logic";
import { sanitizeImportRow, type ImportRow } from "@/lib/crm-import-logic";

describe("BL-STAB-2f — server action request bodies", () => {
  it("measures what is sent, conservatively", () => {
    expect(TEXT_ACTION_MAX_BYTES).toBeLessThan(ACTION_BODY_LIMIT_BYTES - 100_000);
    expect(encodedBytes("abc")).toBe(5);
    // Escaped control characters and multibyte text count as sent.
    expect(encodedBytes("\u0001")).toBe(8);
    expect(encodedBytes("é")).toBe(4);
    // Next counts UTF-16 units of the JSON: never more than its UTF-8 bytes.
    for (const s of ["plain", "ünïcödé", "😀😀", "\u0000\n\t\"\\"]) expect(JSON.stringify(s).length).toBeLessThanOrEqual(encodedBytes(s));
  });

  it("refuses pasted text the server won't read or the request can't carry, saying what to do", () => {
    expect(pasteRefusal("short", 200_000, "Trim it.")).toBeNull();
    expect(pasteRefusal("x".repeat(200_001), 200_000, "Trim it.")).toBe("This is 200,001 characters; FORGE reads up to 200,000 at a time. Trim it.");
    // Within the character limit, but control characters escape six-fold.
    expect(pasteRefusal("\u0001".repeat(160_000), 2_000_000, "Split it.")).toBe("This text is too large to send at once. Split it.");
  });

  it("splits a list into parts that each fit, in order, an oversized item alone", () => {
    expect(chunkByBytes([], 100)).toEqual([]);
    expect(chunkByBytes(["aaaa", "bbbb", "cccc"], 15)).toEqual([["aaaa", "bbbb"], ["cccc"]]);
    expect(chunkByBytes(["x".repeat(50), "a"], 15)).toEqual([["x".repeat(50)], ["a"]]);
    // Every run fits exactly, at every limit: its brackets and commas count too.
    const items = Array.from({ length: 40 }, (_, i) => "x".repeat((i * 7) % 13));
    for (let max = 20; max <= 120; max++) {
      const parts = chunkByBytes(items, max);
      expect(parts.flat()).toEqual(items);
      for (const part of parts) expect(encodedBytes(part)).toBeLessThanOrEqual(max);
      // And no run could have taken the next item.
      parts.slice(0, -1).forEach((part, i) => expect(encodedBytes([...part, parts[i + 1]![0]])).toBeGreaterThan(max));
    }
  });

  it("a worst-case 500-contact import goes in parts under the request limit", () => {
    // Every field full, multibyte notes with control characters (as a file can hold before they are stripped).
    const row = (i: number): ImportRow => ({
      ...sanitizeImportRow({ name: `P${i}`.padEnd(CONTACT_LIMITS.name, "é"), agency: "A".padEnd(CONTACT_LIMITS.agency, "ü"), email: `p${i}@army.mil` })!,
      office: "o".repeat(CONTACT_LIMITS.office),
      title: "t".repeat(CONTACT_LIMITS.title),
      notes: "€\u0001".repeat(CONTACT_LIMITS.notes / 2),
    });
    const rows = Array.from({ length: 500 }, (_, i) => row(i));
    expect(encodedBytes(rows)).toBeGreaterThan(ACTION_BODY_LIMIT_BYTES * 4);
    const parts = chunkByBytes(rows, 600_000);
    expect(parts.flat()).toEqual(rows);
    for (const part of parts) expect(JSON.stringify(part).length).toBeLessThan(ACTION_BODY_LIMIT_BYTES - 100_000);
  });
});
