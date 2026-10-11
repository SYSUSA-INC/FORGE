/**
 * BL-STAB-10b — reading SAM.gov's public Contract Opportunities file
 * (pure, for tests). The file is Windows-1252 text, every field quoted,
 * with line breaks inside fields and "" for a quote; it is fed in chunks
 * as the download streams.
 */

/** Windows-1252's 0x80–0x9F, where Latin-1 has control characters. */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ",
  0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›",
  0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/** Windows-1252 bytes as text (one byte, one character, so chunks never split a character). */
export function decodeCp1252(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("latin1")
    .replace(/[\x80-\x9f]/g, (c) => CP1252[c.charCodeAt(0)] ?? c);
}

export type CsvParser = { push(text: string): void; end(): { inQuote: boolean } };

const SPECIAL = /[",\r\n]/g;

/** A streaming CSV reader: `onRow` gets each row's fields as they complete. */
export function csvParser(onRow: (fields: string[]) => void): CsvParser {
  let row: string[] = [];
  let field = "";
  let inQuote = false;
  let quoteSeen = false; // a quote inside a quoted field: an escape ("") or the closing quote
  let skipLf = false; // the \n of a \r\n split across chunks
  let any = false;
  const endRow = () => {
    row.push(field);
    onRow(row);
    row = [];
    field = "";
    any = false;
  };
  return {
    push(text: string) {
      let i = 0;
      while (i < text.length) {
        if (inQuote) {
          if (quoteSeen) {
            quoteSeen = false;
            if (text[i] === '"') {
              field += '"';
              i++;
              continue;
            }
            inQuote = false;
            continue;
          }
          const q = text.indexOf('"', i);
          if (q === -1) {
            field += text.slice(i);
            return;
          }
          field += text.slice(i, q);
          quoteSeen = true;
          i = q + 1;
          continue;
        }
        const ch = text[i]!;
        if (skipLf) {
          skipLf = false;
          if (ch === "\n") {
            i++;
            continue;
          }
        }
        if (ch === '"') {
          inQuote = true;
          any = true;
          i++;
        } else if (ch === ",") {
          row.push(field);
          field = "";
          any = true;
          i++;
        } else if (ch === "\r" || ch === "\n") {
          if (any || field || row.length) endRow();
          skipLf = ch === "\r";
          i++;
        } else {
          SPECIAL.lastIndex = i;
          const stop = SPECIAL.exec(text)?.index ?? text.length;
          field += text.slice(i, stop);
          any = true;
          i = stop;
        }
      }
    },
    end() {
      const open = inQuote && !quoteSeen;
      if (any || field || row.length) endRow();
      return { inQuote: open };
    },
  };
}

const REQUIRED = { noticeId: "NoticeId", postedDate: "PostedDate", active: "Active", description: "Description" } as const;
export type SamFileHeader = { width: number; at: Record<keyof typeof REQUIRED, number> };

/** The file's header row: where the columns FORGE reads are (by name, not position). */
export function readHeader(fields: string[]): { ok: true; header: SamFileHeader } | { ok: false; missing: string[] } {
  // A UTF-8 byte-order mark, as itself or read as Windows-1252 ("ï»¿").
  const names = fields.map((f) => f.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "").trim());
  const at = Object.fromEntries(Object.entries(REQUIRED).map(([k, name]) => [k, names.indexOf(name)])) as SamFileHeader["at"];
  const missing = Object.entries(REQUIRED).filter(([k]) => at[k as keyof typeof REQUIRED] === -1).map(([, name]) => name);
  return missing.length ? { ok: false, missing } : { ok: true, header: { width: fields.length, at } };
}

export type SamNoticeState = "text" | "truncated" | "none" | "link";
export type SamFileNotice = { noticeId: string; state: SamNoticeState; description: string | null; postedAt: Date | null; active: boolean };

/** What a description cell holds: text, text cut at SAM.gov's 32,000 characters, nothing, or only a link. */
export function classifyDescription(cell: string): { state: SamNoticeState; description: string | null } {
  const t = cell.trim();
  if (!t || t.toLowerCase() === "null") return { state: "none", description: null };
  if (/^https?:\/\/\S+$/i.test(t)) return { state: "link", description: null };
  return { state: t.length >= 32_000 && t.endsWith("...") ? "truncated" : "text", description: t };
}

/** One data row, or null when its notice id isn't SAM.gov's 32 hex characters. */
export function toNotice(fields: string[], h: SamFileHeader): SamFileNotice | null {
  const noticeId = (fields[h.at.noticeId] ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(noticeId)) return null;
  const posted = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec((fields[h.at.postedDate] ?? "").trim());
  const postedAt = posted ? new Date(`${posted[1]}T${posted[2]}Z`) : null;
  return {
    noticeId,
    ...classifyDescription(fields[h.at.description] ?? ""),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    active: (fields[h.at.active] ?? "").trim().toLowerCase() === "yes",
  };
}
