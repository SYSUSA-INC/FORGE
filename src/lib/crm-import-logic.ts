/**
 * BL-FB-X-CRM Slice 3 — importing contacts, pure parts: a CSV with the
 * usual headers or a vCard export (Outlook, Google, Apple) becomes rows
 * the import can preview; duplicates against what the tenant already has
 * are found by email, then by agency and name. No I/O here; crm-import.ts
 * owns the database.
 */
import { CONTACT_LIMITS, agencyKey, normalizeRole, type ContactRole } from "@/lib/crm-logic";

export const IMPORT_LIMITS = { maxRows: 500, maxChars: 2_000_000 } as const;

export type ImportFormat = "csv" | "vcard";

export type ImportRow = {
  /** CSV line (header is 1) or vCard ordinal, for the preview. */
  line: number;
  agency: string;
  office: string;
  name: string;
  title: string;
  role: ContactRole;
  email: string;
  phone: string;
  notes: string;
  /** YYYY-MM-DD or null. */
  nextTouchAt: string | null;
};

export type ImportSkip = { line: number; reason: string };
export type ParsedImport = { format: ImportFormat; rows: ImportRow[]; skipped: ImportSkip[]; unmappedHeaders: string[] };

export function detectImportFormat(text: string, fileName = ""): ImportFormat {
  if (/\.vcf$/i.test(fileName) || /^\s*BEGIN:VCARD/im.test(text)) return "vcard";
  return "csv";
}

type Field = "name" | "agency" | "office" | "title" | "role" | "email" | "phone" | "notes" | "nextTouchAt";
type RawRow = Record<Field, string>;

const FIELD_ALIASES: Record<Field, string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "person"],
  agency: ["agency", "organization", "organisation", "org", "company", "department", "customer"],
  office: ["office", "command", "division", "bureau", "sub agency", "subagency", "directorate", "program office"],
  title: ["title", "job title", "position", "job"],
  role: ["role", "contact role", "type", "relationship"],
  email: ["email", "e mail", "email address", "mail"],
  phone: ["phone", "telephone", "tel", "mobile", "cell", "work phone", "phone number"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  nextTouchAt: ["next touch", "next touch at", "follow up", "followup", "next contact"],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which column holds which field; a header nobody recognises is reported, never guessed. */
export function mapCsvHeaders(headers: readonly string[]): { map: Partial<Record<Field, number>>; unmapped: string[] } {
  const map: Partial<Record<Field, number>> = {};
  const unmapped: string[] = [];
  headers.forEach((h, i) => {
    const key = headerKey(h);
    if (!key) return;
    const field = (Object.keys(FIELD_ALIASES) as Field[]).find((f) => FIELD_ALIASES[f].includes(key));
    if (field && map[field] === undefined) map[field] = i;
    else unmapped.push(h.trim());
  });
  return { map, unmapped };
}

/** RFC 4180-ish: quoted cells, doubled quotes, CR LF; blank lines dropped. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  const endRow = () => {
    cur.push(cell);
    cell = "";
    if (cur.some((c) => c.trim().length > 0)) rows.push(cur);
    cur = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cur.push(cell);
      cell = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") endRow();
    else cell += ch;
  }
  if (cell.length > 0 || cur.length > 0) endRow();
  return rows;
}

const clip = (v: string | undefined, n: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** A role from an explicit role column, else from the title: "Contracting Officer" → contracting_officer. */
export function guessRole(roleText: string, title: string): ContactRole {
  const explicit = normalizeRole(roleText.trim().toLowerCase().replace(/[\s/-]+/g, "_"));
  if (roleText.trim() && explicit !== "other") return explicit;
  const t = ` ${roleText} ${title} `.toLowerCase();
  if (/\bcor\b|\bcotr\b|contracting officer'?s? (?:technical )?representative/.test(t)) return "cor";
  if (/\bcontracting officer\b|\bko\b|\bcontract specialist\b|\bprocurement\b|\bcontracting\b/.test(t)) return "contracting_officer";
  if (/\bprogram manager\b|\bproject manager\b|\bpm\b|\bprogram lead\b|\bproduct manager\b/.test(t)) return "program_manager";
  if (/\bsmall business\b|\bosdbu\b|\bsbs\b/.test(t)) return "small_business";
  if (/\bdirector\b|\bchief\b|\bdeputy\b|\bexecutive\b|\bses\b|\bcio\b|\bcto\b|\bciso\b|\bcommander\b|\badministrator\b|\bsecretary\b|\bhead of\b/.test(t)) return "executive";
  if (/\bengineer\b|\barchitect\b|\btechnical\b|\bscientist\b|\banalyst\b|\bsme\b|\bspecialist\b|\bdeveloper\b/.test(t)) return "technical";
  return "other";
}

/** YYYY-MM-DD, M/D/YYYY or M/D/YY to an ISO date; anything else is null. */
export function normalizeImportDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v))) {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = Number(m[3]);
    if (y < 100) y += 2000;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function buildRow(line: number, raw: RawRow): ImportRow | ImportSkip {
  const name = clip(raw.name, CONTACT_LIMITS.name);
  const agency = clip(raw.agency, CONTACT_LIMITS.agency);
  if (!name) return { line, reason: "No name." };
  if (!agency) return { line, reason: `No agency for ${name}.` };
  return {
    line,
    name,
    agency,
    office: clip(raw.office, CONTACT_LIMITS.office),
    title: clip(raw.title, CONTACT_LIMITS.title),
    role: guessRole(raw.role, raw.title),
    email: clip(raw.email, CONTACT_LIMITS.email).toLowerCase(),
    phone: clip(raw.phone.replace(/^tel:/i, ""), CONTACT_LIMITS.phone),
    notes: raw.notes.replace(/\r\n?/g, "\n").trim().slice(0, CONTACT_LIMITS.notes),
    nextTouchAt: normalizeImportDate(raw.nextTouchAt),
  };
}

/** A row that came back from the client, re-normalised before anything is written; null when it cannot be a contact. */
export function sanitizeImportRow(row: Partial<ImportRow> & { line?: number }): ImportRow | null {
  const built = buildRow(typeof row.line === "number" ? row.line : 0, {
    name: String(row.name ?? ""),
    agency: String(row.agency ?? ""),
    office: String(row.office ?? ""),
    title: String(row.title ?? ""),
    role: String(row.role ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    notes: String(row.notes ?? ""),
    nextTouchAt: String(row.nextTouchAt ?? ""),
  });
  return "reason" in built ? null : built;
}

export function parseContactsCsv(text: string): ParsedImport {
  const table = parseCsvTable(text);
  if (table.length === 0) return { format: "csv", rows: [], skipped: [], unmappedHeaders: [] };
  const { map, unmapped } = mapCsvHeaders(table[0]!);
  if (map.name === undefined || map.agency === undefined) {
    return {
      format: "csv",
      rows: [],
      skipped: [{ line: 1, reason: `The header row needs a name column and an agency column (found: ${table[0]!.filter((h) => h.trim()).join(", ") || "none"}).` }],
      unmappedHeaders: unmapped,
    };
  }
  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];
  for (let i = 1; i < table.length && rows.length < IMPORT_LIMITS.maxRows; i++) {
    const cells = table[i]!;
    const get = (f: Field) => (map[f] === undefined ? "" : (cells[map[f]!] ?? ""));
    const built = buildRow(i + 1, { name: get("name"), agency: get("agency"), office: get("office"), title: get("title"), role: get("role"), email: get("email"), phone: get("phone"), notes: get("notes"), nextTouchAt: get("nextTouchAt") });
    if ("reason" in built) skipped.push(built);
    else rows.push(built);
  }
  return { format: "csv", rows, skipped, unmappedHeaders: unmapped };
}

const unescapeVcard = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

/** vCard 3.0 / 4.0: FN or N for the name, ORG for agency and office, TITLE, EMAIL, TEL, NOTE, ROLE. Folded lines are unfolded. */
export function parseVcards(text: string): ParsedImport {
  const unfolded = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  const cards = unfolded.split(/^BEGIN:VCARD[^\n]*\n/im).slice(1);
  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];
  cards.forEach((card, idx) => {
    if (rows.length >= IMPORT_LIMITS.maxRows) return;
    const props = new Map<string, string[]>();
    for (const line of card.split("\n")) {
      if (!line.trim() || /^END:VCARD/i.test(line)) continue;
      const m = /^([^:;]+)(?:;[^:]*)?:(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1]!.toUpperCase().replace(/^ITEM\d+\./, "");
      props.set(key, [...(props.get(key) ?? []), unescapeVcard(m[2]!)]);
    }
    const n = (props.get("N")?.[0] ?? "").split(";");
    const nameFromN = [n[3], n[1], n[2], n[0], n[4]].filter((p) => p && p.trim()).join(" ");
    const org = (props.get("ORG")?.[0] ?? "").split(";");
    const built = buildRow(idx + 1, {
      name: props.get("FN")?.[0] || nameFromN,
      agency: org[0] ?? "",
      office: org.slice(1).filter((p) => p.trim()).join(" · "),
      title: props.get("TITLE")?.[0] ?? "",
      role: props.get("ROLE")?.[0] ?? props.get("X-ROLE")?.[0] ?? "",
      email: props.get("EMAIL")?.[0] ?? "",
      phone: props.get("TEL")?.[0] ?? "",
      notes: (props.get("NOTE") ?? []).join("\n"),
      nextTouchAt: "",
    });
    if ("reason" in built) skipped.push({ line: idx + 1, reason: `Card ${idx + 1}: ${built.reason}` });
    else rows.push(built);
  });
  return { format: "vcard", rows, skipped, unmappedHeaders: [] };
}

export function parseImport(text: string, fileName = ""): ParsedImport {
  return detectImportFormat(text, fileName) === "vcard" ? parseVcards(text) : parseContactsCsv(text);
}

export type ExistingContactLike = { id: string; name: string; email: string; agency: string; agencyKey: string };
export type DuplicateMatch = { existingId: string; existingName: string; by: "email" | "name" };

const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const rowKeys = (r: { name: string; agency: string; email: string }) => ({ email: r.email.trim().toLowerCase(), name: `${agencyKey(r.agency)}|${nameKey(r.name)}` });

/** Rows that are already in the tenant's contacts: by email first, else by agency and name. Keyed by row index. */
export function detectDuplicates(rows: readonly ImportRow[], existing: readonly ExistingContactLike[]): Map<number, DuplicateMatch> {
  const byEmail = new Map<string, ExistingContactLike>();
  const byName = new Map<string, ExistingContactLike>();
  for (const e of existing) {
    if (e.email) byEmail.set(e.email.toLowerCase(), e);
    byName.set(`${e.agencyKey || agencyKey(e.agency)}|${nameKey(e.name)}`, e);
  }
  const out = new Map<number, DuplicateMatch>();
  rows.forEach((r, i) => {
    const k = rowKeys(r);
    const viaEmail = k.email ? byEmail.get(k.email) : undefined;
    const match = viaEmail ?? byName.get(k.name);
    if (match) out.set(i, { existingId: match.id, existingName: match.name, by: viaEmail ? "email" : "name" });
  });
  return out;
}

/** The same person twice in one file (same email, or same agency and name): the first row wins. */
export function dedupeWithinImport(rows: readonly ImportRow[]): { rows: ImportRow[]; dropped: ImportSkip[] } {
  const seenEmail = new Set<string>();
  const seenName = new Set<string>();
  const kept: ImportRow[] = [];
  const dropped: ImportSkip[] = [];
  for (const r of rows) {
    const k = rowKeys(r);
    if ((k.email && seenEmail.has(k.email)) || seenName.has(k.name)) {
      dropped.push({ line: r.line, reason: `${r.name} appears earlier in the file.` });
      continue;
    }
    if (k.email) seenEmail.add(k.email);
    seenName.add(k.name);
    kept.push(r);
  }
  return { rows: kept, dropped };
}

export type ImportSummary = { total: number; fresh: number; duplicates: number; agencies: number; skipped: number };

export function summarizeImport(rows: readonly ImportRow[], duplicates: ReadonlyMap<number, DuplicateMatch>, skipped: readonly ImportSkip[]): ImportSummary {
  return {
    total: rows.length,
    fresh: rows.length - duplicates.size,
    duplicates: duplicates.size,
    agencies: new Set(rows.map((r) => agencyKey(r.agency))).size,
    skipped: skipped.length,
  };
}
