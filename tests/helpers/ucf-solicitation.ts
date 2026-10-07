/**
 * BL-AIX Phase 2a — a small solicitation in the Uniform Contract Format,
 * with the traps real ones have: a table of contents, running page
 * headers, a sentence that starts with "Section L", a list of
 * attachments in Section J and attachments appended after Section M.
 * Pages are joined the way pdf-parse joins them ("\n\n" before each).
 */
export const UCF_PAGES = [
  [
    "SOLICITATION/CONTRACT/ORDER FOR COMMERCIAL PRODUCTS AND SERVICES",
    "Help Desk Support Services, RFP 70-RFP-0042",
    "TABLE OF CONTENTS",
    "SECTION B SUPPLIES OR SERVICES AND PRICES/COSTS ........ 2",
    "SECTION C DESCRIPTION/SPECIFICATIONS/STATEMENT OF WORK ........ 2",
    "SECTION J LIST OF ATTACHMENTS ........ 3",
    "SECTION L INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS ........ 4",
    "SECTION M EVALUATION FACTORS FOR AWARD ........ 4",
  ].join("\n"),
  [
    "SECTION B - SUPPLIES OR SERVICES AND PRICES/COSTS",
    "B.1 The contractor shall provide all labor, supervision and tools for the help desk.",
    "SECTION C - DESCRIPTION/SPECIFICATIONS/STATEMENT OF WORK",
    "C.1 SCOPE",
    "The contractor shall operate the help desk 24 hours a day, 7 days a week.",
    "3.2.1 Transition In",
    "The contractor shall com-",
    "plete transition within 30 days of award.",
  ].join("\n"),
  [
    "Section C - Page 3",
    "Section L of this solicitation explains how proposals are submitted.",
    "C.4 The contractor shall deliver a monthly status report to the COR.",
    "SECTION J - LIST OF ATTACHMENTS",
    "Attachment J-1 Performance Work Statement",
    "Attachment J-2 Labor Categories",
    "Attachment J-3 Pricing Template",
  ].join("\n"),
  [
    "SECTION L - INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
    "L.5 Volume I shall not exceed 25 pages in 12-point Times New Roman.",
    "SECTION M - EVALUATION FACTORS FOR AWARD",
    "M.1 Technical approach is more important than past performance.",
  ].join("\n"),
  [
    "ATTACHMENT J-1 - PERFORMANCE WORK STATEMENT",
    "PWS 2.1 The contractor shall maintain a ticket resolution rate of 95 percent.",
    "ATTACHMENT J-2 - LABOR CATEGORIES",
    "Help Desk Analyst II: two years of experience.",
  ].join("\n"),
];

/** The text and page starts exactly as pdf-parse + trim would produce them. */
export function ucfSolicitation(): { text: string; pageStarts: number[] } {
  const raw = UCF_PAGES.map((p) => `\n\n${p}`).join("");
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const pageStarts: number[] = [];
  let at = 0;
  for (const p of UCF_PAGES) {
    at += 2;
    pageStarts.push(at - lead);
    at += p.length;
  }
  return { text, pageStarts };
}
