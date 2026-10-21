/**
 * BL-FB-X-CRM Slice 3 — importing contacts, pure parts: a CSV with the
 * usual headers and a vCard export both become rows; roles are read from
 * the role column or guessed from the title; duplicates are found by
 * email, then by agency and name, inside the file and against what the
 * tenant already has.
 */
import { describe, expect, it } from "vitest";
import {
  IMPORT_LIMITS,
  decodeImportFile,
  dedupeWithinImport,
  detectDuplicates,
  detectImportFormat,
  guessRole,
  mapCsvHeaders,
  normalizeImportDate,
  parseContactsCsv,
  parseCsvTable,
  parseImport,
  parseVcards,
  sanitizeImportRow,
  summarizeImport,
} from "@/lib/crm-import-logic";

const CSV = [
  "Full Name,Organization,Office,Job Title,E-mail,Phone,Notes,Follow-up,Favorite color",
  '"Rivera, Ana",Department of the Navy,NAVSEA,Contracting Officer,Ana.Rivera@navy.mil,202-555-0100,"Met at industry day; said ""call in October""",10/15/2026,blue',
  "Bo Chen,Department of the Navy,,Deputy Director for Acquisition,bo.chen@navy.mil,,,2026-11-01,",
  "Cy Park,,PEO IWS,Systems Engineer,cy@navy.mil,,,,",
  ",Army,,,,,,,",
  "",
].join("\r\n");

const VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Dana Lee",
  "N:Lee;Dana;;;",
  "ORG:Department of the Army;PEO C3T",
  "TITLE:Program Manager",
  "item1.EMAIL;type=INTERNET;type=WORK:dana.lee@army.mil",
  "TEL;TYPE=WORK,VOICE:tel:+1-703-555-0199",
  "NOTE:Owns the tactical network portfolio\\, prefers short briefs. Second ",
  " line of the note.",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:4.0",
  "N:Okafor;Eli;;Dr.;",
  "ORG:General Services Administration",
  "ROLE:Small Business Specialist",
  "EMAIL:eli.okafor@gsa.gov",
  "END:VCARD",
  "BEGIN:VCARD",
  "FN:No Agency",
  "END:VCARD",
].join("\r\n");

describe("crm import logic", () => {
  it("reads a CSV with the usual headers, quoted cells and dates, and reports what it skipped", () => {
    expect(parseCsvTable('a,"b,c",d\r\n"x ""y""",,\n')).toEqual([
      ["a", "b,c", "d"],
      ['x "y"', "", ""],
    ]);
    const { map, unmapped } = mapCsvHeaders(["Full Name", "Organization", "E-mail", "Favorite color", ""]);
    expect(map).toEqual({ name: 0, agency: 1, email: 2 });
    expect(unmapped).toEqual(["Favorite color"]);

    const parsed = parseContactsCsv(CSV);
    expect(parsed.format).toBe("csv");
    expect(parsed.unmappedHeaders).toEqual(["Favorite color"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      line: 2,
      name: "Rivera, Ana",
      agency: "Department of the Navy",
      office: "NAVSEA",
      title: "Contracting Officer",
      role: "contracting_officer",
      email: "ana.rivera@navy.mil",
      phone: "202-555-0100",
      notes: 'Met at industry day; said "call in October"',
      nextTouchAt: "2026-10-15",
    });
    expect(parsed.rows[1]).toMatchObject({ line: 3, name: "Bo Chen", role: "executive", nextTouchAt: "2026-11-01" });
    expect(parsed.skipped).toEqual([
      { line: 4, reason: "No agency for Cy Park." },
      { line: 5, reason: "No name." },
    ]);
    expect(parseContactsCsv("Email,Phone\nx@y.gov,1").skipped[0]?.reason).toMatch(/needs a name column and an agency column/);
    expect(parseContactsCsv("")).toMatchObject({ rows: [], skipped: [] });
  });

  it("reads vCards: folded lines, ORG as agency and office, item-prefixed email, N when FN is missing", () => {
    expect(detectImportFormat(VCF)).toBe("vcard");
    expect(detectImportFormat(CSV, "people.vcf")).toBe("vcard");
    expect(detectImportFormat(CSV, "people.csv")).toBe("csv");
    const parsed = parseVcards(VCF);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      line: 1,
      name: "Dana Lee",
      agency: "Department of the Army",
      office: "PEO C3T",
      title: "Program Manager",
      role: "program_manager",
      email: "dana.lee@army.mil",
      phone: "+1-703-555-0199",
      notes: "Owns the tactical network portfolio, prefers short briefs. Second line of the note.",
    });
    expect(parsed.rows[1]).toMatchObject({ line: 2, name: "Dr. Eli Okafor", agency: "General Services Administration", role: "small_business", email: "eli.okafor@gsa.gov" });
    expect(parsed.skipped).toEqual([{ line: 3, reason: "Card 3: No agency for No Agency." }]);
    expect(parseImport(VCF).format).toBe("vcard");
    expect(parseImport(CSV).format).toBe("csv");
  });

  it("guesses roles from a role column or a title, and normalises dates", () => {
    expect(guessRole("contracting_officer", "")).toBe("contracting_officer");
    expect(guessRole("COR", "")).toBe("cor");
    expect(guessRole("", "Contracting Officer's Representative")).toBe("cor");
    expect(guessRole("", "Contract Specialist")).toBe("contracting_officer");
    expect(guessRole("", "Deputy Program Manager")).toBe("program_manager");
    expect(guessRole("", "Chief Information Officer")).toBe("executive");
    expect(guessRole("", "OSDBU Director")).toBe("small_business");
    expect(guessRole("", "Lead Systems Engineer")).toBe("technical");
    expect(guessRole("", "Receptionist")).toBe("other");
    expect(normalizeImportDate("2026-10-15")).toBe("2026-10-15");
    expect(normalizeImportDate("10/15/2026")).toBe("2026-10-15");
    expect(normalizeImportDate("1/5/26")).toBe("2026-01-05");
    expect(normalizeImportDate("13/40/2026")).toBeNull();
    expect(normalizeImportDate("soon")).toBeNull();
    expect(sanitizeImportRow({ name: "  Ana ", agency: "Navy", role: "cor", email: "ANA@NAVY.MIL", phone: "tel:555" })).toMatchObject({ name: "Ana", agency: "Navy", role: "cor", email: "ana@navy.mil", phone: "555", nextTouchAt: null });
    expect(sanitizeImportRow({ name: "Ana" })).toBeNull();
  });

  it("finds the people the tenant already has, and the same person twice in one file", () => {
    const rows = parseContactsCsv(CSV).rows;
    const existing = [
      { id: "c1", name: "Ana Rivera", email: "ana.rivera@navy.mil", agency: "Navy", agencyKey: "navy" },
      { id: "c2", name: "Bo Chen", email: "", agency: "U.S. Navy", agencyKey: "navy" },
      { id: "c3", name: "Bo Chen", email: "bo@army.mil", agency: "Army", agencyKey: "army" },
    ];
    const dups = detectDuplicates(rows, existing);
    expect(dups.get(0)).toEqual({ existingId: "c1", existingName: "Ana Rivera", by: "email" });
    expect(dups.get(1)).toEqual({ existingId: "c2", existingName: "Bo Chen", by: "name" });
    expect(detectDuplicates(rows, [])).toEqual(new Map());

    const twice = dedupeWithinImport([...rows, { ...rows[0]!, line: 9, email: "" }, { ...rows[1]!, line: 10, email: "other@navy.mil", agency: "Navy" }]);
    expect(twice.rows).toHaveLength(2);
    expect(twice.dropped.map((d) => d.line)).toEqual([9, 10]);
    expect(summarizeImport(rows, dups, twice.dropped)).toEqual({ total: 2, fresh: 0, duplicates: 2, agencies: 1, skipped: 2 });
    expect(IMPORT_LIMITS.maxRows).toBe(500);
  });

  it("BL-STAB-2f — says where reading stopped when a file holds more people than one import takes", () => {
    const line = (i: number) => `Person ${i},Army,,,p${i}@army.mil`;
    const exact = ["Name,Agency,Office,Title,Email", ...Array.from({ length: 500 }, (_, i) => line(i))].join("\n");
    expect(parseContactsCsv(exact)).toMatchObject({ stoppedAt: null });
    expect(parseContactsCsv(exact).rows).toHaveLength(500);
    // A trailing line that isn't a contact (an export footer) leaves nothing unread.
    expect(parseContactsCsv(`${exact}\nExported by Outlook\n,,HQ`)).toMatchObject({ stoppedAt: null, skipped: [{ line: 502 }, { line: 503 }] });
    // The 501st person is where the next import starts; a broken quote after it is never reached.
    const over = `${exact}\n${line(500)}\n"unterminated,Army\n${"x,y\n".repeat(1_000)}`;
    const parsed = parseContactsCsv(over);
    expect(parsed.stoppedAt).toBe(502);
    expect(parsed.rows).toHaveLength(500);
    expect(parsed.rows.at(-1)!.line).toBe(501);
    // People listed twice count once: 480 people over 520 lines are all read.
    const repeats = ["Name,Agency,Office,Title,Email", ...Array.from({ length: 480 }, (_, i) => line(i)), ...Array.from({ length: 40 }, (_, i) => line(i))].join("\n");
    expect(parseContactsCsv(repeats)).toMatchObject({ stoppedAt: null });
    expect(parseContactsCsv(repeats).rows).toHaveLength(480);
    expect(parseContactsCsv(repeats).skipped).toHaveLength(40);
    const card = (i: number, org = "Army") => `BEGIN:VCARD\nFN:Person ${i}\nORG:${org}\nEND:VCARD`;
    const cards = Array.from({ length: 501 }, (_, i) => card(i)).join("\n");
    expect(parseVcards(cards)).toMatchObject({ stoppedAt: 501 });
    expect(parseVcards(cards).rows).toHaveLength(500);
    expect(parseVcards(`${Array.from({ length: 500 }, (_, i) => card(i)).join("\n")}\n${card(500, "")}`)).toMatchObject({ stoppedAt: null });
  });

  it("BL-STAB-2f — reads a UTF-16 export (with its byte-order mark) as well as UTF-8", () => {
    const text = "Name,Agency\nAna Rivera,Navy\n";
    const utf16 = (bigEndian: boolean) => {
      const out = new Uint8Array(2 + text.length * 2);
      out.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out[2 + i * 2] = bigEndian ? c >> 8 : c & 0xff;
        out[3 + i * 2] = bigEndian ? c & 0xff : c >> 8;
      }
      return out;
    };
    expect(decodeImportFile(utf16(false))).toBe(text);
    expect(decodeImportFile(utf16(true))).toBe(text);
    expect(decodeImportFile(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]))).toBe(text);
    expect(parseContactsCsv(decodeImportFile(utf16(false))).rows.map((r) => r.name)).toEqual(["Ana Rivera"]);
  });

  it("BL-STAB-2f — strips control characters Postgres would refuse, keeping line breaks in notes", () => {
    expect(sanitizeImportRow({ name: "Eve\u0000 Stone\u0007", agency: "Army\u001b", notes: "line one\u0000\nline\ttwo" })).toMatchObject({
      name: "Eve Stone",
      agency: "Army",
      notes: "line one\nline\ttwo",
    });
  });
});
