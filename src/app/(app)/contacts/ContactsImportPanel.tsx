"use client";

import { useState, useTransition } from "react";
import { CONTACT_ROLE_LABELS } from "@/lib/crm-logic";
import { IMPORT_LIMITS } from "@/lib/crm-import-logic";
import type { ImportPreview } from "@/lib/crm-import";
import { commitContactImportAction, previewContactImportAction } from "./actions";

type Preview = Extract<ImportPreview, { ok: true }>;

/**
 * BL-FB-X-CRM Slice 3 — bring the spreadsheet in: paste a CSV or choose a
 * .csv / .vcf export, see every row with the people we already have
 * marked, then import — skipping or updating the duplicates.
 */
export function ContactsImportPanel({ onDone }: { onDone: (notice: string) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicates, setDuplicates] = useState<"skip" | "update">("skip");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function readFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      setText(value.slice(0, IMPORT_LIMITS.maxChars));
      setFileName(file.name);
      setPreview(null);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function runPreview() {
    setError(null);
    startTransition(async () => {
      const res = await previewContactImportAction({ text, fileName });
      if (!res.ok) {
        setPreview(null);
        return setError(res.error);
      }
      setPreview(res);
    });
  }

  function runImport() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await commitContactImportAction({ rows: preview.rows.map(({ duplicate: _d, ...r }) => r), duplicates });
      if (!res.ok) return setError(res.error);
      onDone(`Imported ${res.created} new contact${res.created === 1 ? "" : "s"}${res.updated ? `, updated ${res.updated}` : ""}${res.skipped ? `, skipped ${res.skipped} duplicate${res.skipped === 1 ? "" : "s"}` : ""}.`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-[12px] leading-relaxed text-muted">
        A CSV with a header row (name and agency are required; office, title, role, email, phone, notes and next touch are read when present) or a vCard export from Outlook, Google or Apple Contacts. People we already have, by email or by agency and name, are marked before anything is written.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="aur-btn aur-btn-ghost cursor-pointer text-[11px]">
          Choose a .csv or .vcf file
          <input
            type="file"
            className="hidden"
            accept=".csv,.vcf,.txt,text/csv,text/vcard,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
        </label>
        {fileName ? <span className="font-mono text-[10px] text-muted">{fileName}</span> : null}
        <span className="font-mono text-[10px] text-subtle">or paste below · up to {IMPORT_LIMITS.maxRows} rows</span>
      </div>
      <textarea
        className="aur-input font-mono text-[11px]"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        placeholder={"Name,Agency,Office,Title,Email,Phone\nAna Rivera,Department of the Navy,NAVSEA,Contracting Officer,ana.rivera@navy.mil,202-555-0100"}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runPreview} disabled={pending || !text.trim()} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60">
          {pending && !preview ? "Reading…" : "Preview"}
        </button>
        {preview ? (
          <>
            <span className="font-mono text-[10px] text-muted">
              {preview.summary.total} row{preview.summary.total === 1 ? "" : "s"} · {preview.summary.fresh} new · {preview.summary.duplicates} already known · {preview.summary.agencies} agenc{preview.summary.agencies === 1 ? "y" : "ies"}
              {preview.summary.skipped ? ` · ${preview.summary.skipped} skipped` : ""}
            </span>
            {preview.summary.duplicates > 0 ? (
              <label className="flex items-center gap-1 font-mono text-[10px] text-muted">
                Duplicates:
                <select className="aur-input w-auto py-0.5 text-[11px]" value={duplicates} onChange={(e) => setDuplicates(e.target.value === "update" ? "update" : "skip")}>
                  <option value="skip">skip</option>
                  <option value="update">update with the file&apos;s fields</option>
                </select>
              </label>
            ) : null}
            <button type="button" onClick={runImport} disabled={pending} className="aur-btn aur-btn-primary ml-auto text-[11px] disabled:opacity-60">
              {pending ? "Importing…" : `Import ${duplicates === "update" ? preview.summary.total : preview.summary.fresh} contact${(duplicates === "update" ? preview.summary.total : preview.summary.fresh) === 1 ? "" : "s"}`}
            </button>
          </>
        ) : null}
      </div>
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      {preview ? (
        <>
          {preview.unmappedHeaders.length > 0 ? (
            <p className="font-mono text-[10px] text-subtle">Columns not read: {preview.unmappedHeaders.join(", ")}</p>
          ) : null}
          <div className="max-h-[320px] overflow-y-auto rounded-md border border-layer/10">
            <table className="w-full text-left font-body text-[12px]">
              <thead className="sticky top-0 bg-canvas font-mono text-[9px] uppercase tracking-widest text-muted">
                <tr>
                  <th className="px-3 py-1.5">Name</th>
                  <th className="px-3 py-1.5">Agency</th>
                  <th className="px-3 py-1.5">Role</th>
                  <th className="px-3 py-1.5">Email</th>
                  <th className="px-3 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-layer/5">
                {preview.rows.map((r) => (
                  <tr key={`${r.line}-${r.email}-${r.name}`}>
                    <td className="px-3 py-1.5 text-text">
                      {r.name}
                      {r.title ? <span className="ml-1 font-mono text-[10px] text-muted">{r.title}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-text">
                      {r.agency}
                      {r.office ? <span className="ml-1 font-mono text-[10px] text-muted">{r.office}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">{CONTACT_ROLE_LABELS[r.role]}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">{r.email || "—"}</td>
                    <td className="px-3 py-1.5">
                      {r.duplicate ? (
                        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-200" title={`Matches ${r.duplicate.existingName} by ${r.duplicate.by}`}>
                          already known · {r.duplicate.by}
                        </span>
                      ) : (
                        <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald-300">new</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 ? (
            <details className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-1.5">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted">Skipped ({preview.skipped.length})</summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted">
                {preview.skipped.map((s, i) => (
                  <li key={`${s.line}-${i}`}>
                    line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
