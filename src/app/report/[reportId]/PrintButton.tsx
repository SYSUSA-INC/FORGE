"use client";

/** BL-NAV-LIFECYCLE 2b-2 — prints the report (or saves it as a PDF from the print dialog). */
export function PrintButton() {
  return (
    <button type="button" className="aur-btn aur-btn-primary print:hidden" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
