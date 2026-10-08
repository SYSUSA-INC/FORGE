/**
 * BL-STAB-4 — the amendment number a file name states, so several
 * amendments can be picked at once without typing each number (each
 * stays editable before the upload starts). Pure.
 *
 *   "Amendment 0003.pdf"         → "0003"
 *   "SF30 Amendment No. 4.pdf"   → "4"
 *   "RFP_Amd_02.docx"            → "02"
 *   "Mod 2.pdf" / "Modification 0001" → "2" / "0001"
 *   "W912_A0002.pdf"             → "0002"
 *   "P00003 Bilateral Mod.pdf"   → "P00003"
 *
 * "" when the name states none.
 */
export function amendmentNumberFromName(fileName: string): string {
  const stem = (fileName || "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_\-.]+/g, " ");
  const keyword = /\b(?:amendment|amend|amdt|amd|modification|mod)\s*(?:no\s*|number\s*|#\s*)?([a-z]?\d{1,6})\b/i.exec(stem);
  if (keyword) return keyword[1]!.replace(/^a(?=\d)/i, "");
  const coded = /\b([AP])(\d{3,6})\b/.exec(stem);
  if (coded) return coded[1] === "P" ? `P${coded[2]}` : coded[2]!;
  return "";
}
