/**
 * BL-STAB-10b — reading SAM.gov's public Contract Opportunities file (pure):
 * Windows-1252 text, quoted fields with line breaks and "" escapes, fed in
 * chunks; header by name; description states; notice ids.
 */
import { describe, expect, it } from "vitest";
import { classifyDescription, compareDescriptions, csvParser, decodeCp1252, readHeader, toNotice } from "@/lib/sam-notice-csv";

const FIXTURE = [
  '"NoticeId","Title","PostedDate","Active","Description"',
  '"AB12cd34ef56ab12cd34ef56ab12cd34","Help ""desk""","2026-10-09 23:19:44","Yes","Line one\r\nLine two, with a comma"',
  '"0000000000000000000000000000000a","Empty","2026-10-01 08:00:00","Yes",""',
  '"bad-id","Link","2026-10-01 08:00:00","No","https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=x"',
].join("\r\n");

function parse(chunks: string[]) {
  const rows: string[][] = [];
  const p = csvParser((r) => rows.push(r));
  for (const c of chunks) p.push(c);
  return { rows, ...p.end() };
}

describe("BL-STAB-10b — SAM.gov's notice file", () => {
  it("parses quoted fields, \"\" escapes and line breaks inside fields, however the chunks fall", () => {
    const whole = parse([FIXTURE]);
    expect(whole.inQuote).toBe(false);
    expect(whole.rows).toHaveLength(4);
    expect(whole.rows[1]).toEqual(["AB12cd34ef56ab12cd34ef56ab12cd34", 'Help "desk"', "2026-10-09 23:19:44", "Yes", "Line one\r\nLine two, with a comma"]);
    for (let i = 1; i < FIXTURE.length; i++) expect(parse([FIXTURE.slice(0, i), FIXTURE.slice(i)]).rows, `split at ${i}`).toEqual(whole.rows);
    // A file cut inside a quoted field says so; a missing final newline doesn't lose the row.
    expect(parse([FIXTURE.slice(0, FIXTURE.indexOf("Line two"))]).inQuote).toBe(true);
    expect(parse(['"a","b"\n"c","d"']).rows).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("decodes Windows-1252, including the bytes Latin-1 leaves as control characters", () => {
    expect(decodeCp1252(new Uint8Array([0x4c, 0x61, 0x6e, 0x67, 0x6c, 0x65, 0x79, 0x92, 0x73, 0x20, 0x80, 0x35, 0x20, 0xe9]))).toBe("Langley’s €5 é");
  });

  it("finds columns by name, classifies descriptions and checks notice ids", () => {
    const rows = parse([FIXTURE]).rows;
    const h = readHeader(rows[0]!);
    if (!h.ok) throw new Error("header");
    expect(readHeader(["NoticeId", "Title", "Active"])).toEqual({ ok: false, missing: ["PostedDate", "Description"] });
    expect(readHeader(["\u00EF\u00BB\u00BFNoticeId", "PostedDate", "Active", "Description"]).ok).toBe(true);
    expect(toNotice(rows[1]!, h.header)).toEqual({
      noticeId: "ab12cd34ef56ab12cd34ef56ab12cd34",
      state: "text",
      description: "Line one\r\nLine two, with a comma",
      postedAt: new Date("2026-10-09T23:19:44Z"),
      active: true,
    });
    expect(toNotice(rows[2]!, h.header)).toMatchObject({ state: "none", description: null });
    expect(toNotice(rows[3]!, h.header)).toBeNull();
    expect(classifyDescription("https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=x")).toEqual({ state: "link", description: null });
    expect(classifyDescription(`${"x".repeat(32_000)}...`).state).toBe("truncated");
    expect(classifyDescription("null")).toEqual({ state: "none", description: null });
  });

  it("compares a stored description with SAM.gov's live one as letters and digits only", () => {
    const text = { state: "text", description: "Help desk, Tier 1.Support" };
    expect(compareDescriptions(text, { text: "<p>Help desk, Tier&nbsp;1.</p>\n<p>Support</p>" })).toBe("same");
    expect(compareDescriptions(text, { text: "Help desk, Tier 2." })).toBe("different");
    // Angle brackets in the stored plain text are text, not tags.
    expect(compareDescriptions({ state: "text", description: "Contact <a@b.mil> today" }, { text: "<p>Contact &lt;a@b.mil&gt; today</p>" })).toBe("same");
    expect(compareDescriptions({ state: "truncated", description: "Long text..." }, { text: "Long text that goes on" })).toBe("same");
    expect(compareDescriptions({ state: "none", description: null }, { text: "Something" })).toBe("missing_in_file");
    expect(compareDescriptions(text, { none: true })).toBe("not_at_sam");
    expect(compareDescriptions(text, { unread: true })).toBe("unread");
  });
});
