/**
 * BL-STAB-6 — the companion-document type a file name suggests, so
 * several documents can be added at once without picking each type by
 * hand (each stays editable before the upload starts). Pure.
 *
 *   "Attachment J-3 Pricing.xlsx" → "j_attachment"
 *   "PWS_Final.docx"              → "pws"
 *   "Statement of Work.pdf"       → "sow"
 *   "CDRL A001.pdf"               → "cdrl"
 *   "Amendment 0002.pdf"          → "amendment"
 *   "Volume II RFP.pdf"           → "rfp"
 *   anything else                 → "other"
 */
/** The companion-document types (mirrors `solicitation_document_type`; kept here so client code needs no schema import). */
export const COMPANION_DOCUMENT_TYPES = ["rfp", "pws", "sow", "cdrl", "j_attachment", "amendment", "other"] as const;
export type CompanionDocumentType = (typeof COMPANION_DOCUMENT_TYPES)[number];

export function isCompanionDocumentType(value: unknown): value is CompanionDocumentType {
  return typeof value === "string" && (COMPANION_DOCUMENT_TYPES as readonly string[]).includes(value);
}

const RULES: { type: CompanionDocumentType; pattern: RegExp }[] = [
  { type: "amendment", pattern: /\b(amendment|amend|amdt|amd|sf\s?30|modification)\b/ },
  { type: "j_attachment", pattern: /\b(attachment|att|attach)\s*j\b|\bj\s?\d{1,3}\b|\bsection\s*j\b/ },
  { type: "cdrl", pattern: /\b(cdrl|dd\s?1423|data\s+item)\b/ },
  { type: "pws", pattern: /\b(pws|performance\s+work\s+statement)\b/ },
  { type: "sow", pattern: /\b(sow|statement\s+of\s+work|soo|statement\s+of\s+objectives)\b/ },
  { type: "rfp", pattern: /\b(rfp|rfq|solicitation|volume|vol)\b/ },
];

export function documentTypeFromName(fileName: string): CompanionDocumentType {
  const name = (fileName || "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
  for (const rule of RULES) if (rule.pattern.test(name)) return rule.type;
  return "other";
}
