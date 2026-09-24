/**
 * BL-AIP-1 — the shape a SAM.gov search result must have to be imported,
 * and the sanitiser the import action runs on what the client sends.
 *
 * The import used to take notice ids and re-run an UNFILTERED 30-day,
 * 200-row SAM.gov search to find them again, so anything picked from a
 * NAICS / keyword search or a wider date window was silently reported as
 * "skipped". The client already holds the exact rows the user ticked;
 * it now sends them, and the server trusts nothing about their shape.
 * Pure, unit-tested.
 */

export type SamImportRow = {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  department: string;
  subTier: string;
  office: string;
  postedDate: string;
  type: string;
  typeOfSetAsideDescription: string;
  responseDeadLine: string | null;
  naicsCode: string;
  classificationCode: string;
  placeOfPerformance: {
    city?: { name?: string };
    state?: { name?: string };
    country?: { name?: string };
  } | null;
  description: string;
  uiLink: string;
};

export const MAX_IMPORT_ROWS = 100;
const SHORT = 200;
const TITLE = 500;
const DESCRIPTION = 20_000;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function nullableStr(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function place(v: unknown): SamImportRow["placeOfPerformance"] {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const name = (part: unknown): { name?: string } | undefined => {
    if (!part || typeof part !== "object") return undefined;
    const n = (part as { name?: unknown }).name;
    return typeof n === "string" ? { name: n.slice(0, SHORT) } : undefined;
  };
  const out = { city: name(p.city), state: name(p.state), country: name(p.country) };
  return out.city || out.state || out.country ? out : null;
}

/**
 * Keep only well-formed rows with a notice id, cap every string, drop
 * duplicate notice ids (first wins) and cap the batch at MAX_IMPORT_ROWS.
 */
export function sanitizeSamImportRows(input: unknown): SamImportRow[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SamImportRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const noticeId = str(r.noticeId, SHORT);
    if (!noticeId || seen.has(noticeId)) continue;
    seen.add(noticeId);
    out.push({
      noticeId,
      title: str(r.title, TITLE),
      solicitationNumber: str(r.solicitationNumber, SHORT),
      department: str(r.department, SHORT),
      subTier: str(r.subTier, SHORT),
      office: str(r.office, SHORT),
      postedDate: str(r.postedDate, SHORT),
      type: str(r.type, SHORT),
      typeOfSetAsideDescription: str(r.typeOfSetAsideDescription, SHORT),
      responseDeadLine: nullableStr(r.responseDeadLine, SHORT),
      naicsCode: str(r.naicsCode, SHORT),
      classificationCode: str(r.classificationCode, SHORT),
      placeOfPerformance: place(r.placeOfPerformance),
      description: str(r.description, DESCRIPTION),
      uiLink: str(r.uiLink, 2_000),
    });
    if (out.length >= MAX_IMPORT_ROWS) break;
  }
  return out;
}
