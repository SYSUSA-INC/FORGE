/**
 * Tiny client-side CSV exporter.
 *
 * Avoids a server roundtrip — given any row shape and a column spec,
 * stream-builds a UTF-8 CSV and triggers a browser download. Handles
 * quoting per RFC 4180 (commas, quotes, newlines). No dependency.
 *
 * Used by the BD intel surfaces (awards, firms, watchlist) where the
 * data is already client-side after a server-action result.
 */

export type CsvColumn<T> = {
  /** Header text in the first row. */
  header: string;
  /** Extracts the cell value from a row. Return type is coerced via String(). */
  get: (row: T) => unknown;
};

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => quote(c.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => quote(c.get(row))).join(","));
  }
  // Prepend BOM so Excel auto-detects UTF-8.
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
): void {
  const csv = buildCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so Safari has time to honor the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function quote(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
