"use client";

import { useState, useTransition } from "react";
import { chunkByBytes } from "@/lib/action-body";
import { CONTACT_ROLE_LABELS } from "@/lib/crm-logic";
import {
  IMPORT_LIMITS,
  decodeImportFile,
  dedupeWithinImport,
  parseImport,
  summarizeImport,
  type DuplicateMatch,
  type ImportFormat,
  type ImportRow,
  type ImportSkip,
  type ImportSummary,
} from "@/lib/crm-import-logic";
import { formatLimit } from "@/lib/upload-policy";
import { commitContactImportAction, findImportDuplicatesAction } from "./actions";

type Preview = {
  format: ImportFormat;
  rows: (ImportRow & { duplicate: DuplicateMatch | null })[];
  skipped: ImportSkip[];
  unmappedHeaders: string[];
  summary: ImportSummary;
  stoppedAt: number | null;
};

/** An import sent in parts; a part that failed is sent again from where it stopped. */
type Sending = { importId: string; parts: ImportRow[][]; next: number; created: number; updated: number; skipped: number };

/** Each request stays well inside a server action's 1 MB body. */
const PART_BYTES = 600_000;
const SKIPS_SHOWN = 100;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const counts = (s: Pick<Sending, "created" | "updated" | "skipped">) =>
  `${plural(s.created, "new contact")}${s.updated ? `, updated ${s.updated}` : ""}${s.skipped ? `, skipped ${plural(s.skipped, "duplicate")}` : ""}`;

/**
 * BL-FB-X-CRM Slice 3 — bring the spreadsheet in: paste a CSV or choose a
 * .csv / .vcf export, see every row with the people we already have
 * marked, then import — skipping or updating the duplicates.
 * BL-STAB-2f — the file is read and parsed here, in the browser; the
 * server gets who is in it (to mark duplicates) and then the rows, in
 * parts that each fit one request, never the file.
 */
export function ContactsImportPanel({ onDone }: { onDone: (notice: string) => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);
  const [duplicates, setDuplicates] = useState<"skip" | "update">("skip");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setPreview(null);
    setSending(null);
  }

  function readFile(picked: File) {
    setError(null);
    if (picked.size > IMPORT_LIMITS.maxFileBytes) {
      setError(`That file is ${formatLimit(picked.size)}; contacts files up to ${formatLimit(IMPORT_LIMITS.maxFileBytes)} are read. Split it and import the parts.`);
      return;
    }
    // Decoded here, not with Blob.text(): some address-book exports are UTF-16.
    picked.arrayBuffer().then(
      (buf) => {
        setFile({ name: picked.name, size: picked.size, text: decodeImportFile(new Uint8Array(buf)) });
        reset();
      },
      () => setError("Could not read that file."),
    );
  }

  function runPreview() {
    setError(null);
    reset();
    startTransition(async () => {
      const parsed = parseImport(file ? file.text : text, file?.name ?? "");
      const { rows, dropped } = dedupeWithinImport(parsed.rows);
      const skipped = [...parsed.skipped, ...dropped];
      if (rows.length === 0) return setError(skipped[0]?.reason ?? "No contacts found: each row needs a name and an agency.");
      const found = new Map<number, DuplicateMatch>();
      try {
        let offset = 0;
        for (const part of chunkByBytes(rows.map(({ name, agency, email }) => ({ name, agency, email })), PART_BYTES)) {
          const res = await findImportDuplicatesAction({ people: part });
          if (!res.ok) return setError(res.error);
          res.matches.forEach((m, i) => m && found.set(offset + i, m));
          offset += part.length;
        }
      } catch {
        return setError("FORGE didn't answer while checking for people you already have. Try Preview again.");
      }
      setPreview({
        format: parsed.format,
        rows: rows.map((r, i) => ({ ...r, duplicate: found.get(i) ?? null })),
        skipped,
        unmappedHeaders: parsed.unmappedHeaders,
        summary: summarizeImport(rows, found, skipped),
        stoppedAt: parsed.stoppedAt,
      });
    });
  }

  function runImport() {
    if (!preview) return;
    setError(null);
    // Continue an import that stopped part-way, or start one.
    const run: Sending = sending ? { ...sending } : {
      importId: crypto.randomUUID(),
      parts: chunkByBytes(preview.rows.map(({ duplicate: _d, ...r }) => r), PART_BYTES),
      next: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    };
    startTransition(async () => {
      for (let i = run.next; i < run.parts.length; i++) {
        let failure: string | null = null;
        try {
          const res = await commitContactImportAction({ rows: run.parts[i]!, duplicates, batch: { id: run.importId, part: i + 1, parts: run.parts.length } });
          if (res.ok) {
            run.created += res.created;
            run.updated += res.updated;
            run.skipped += res.skipped;
          } else failure = res.error;
        } catch {
          failure = "FORGE didn't answer, so the last part may already be saved.";
        }
        if (failure) {
          setSending({ ...run, next: i });
          // A part sent again adds nobody twice, and one that was saved answers with what it did.
          return setError(`${i > 0 ? `Imported so far: ${counts(run)}. ` : ""}${failure} Press Import to send the rest.`);
        }
      }
      setSending(null);
      onDone(`Imported ${counts(run)}.`);
    });
  }

  const importCount = duplicates === "update" ? preview?.summary.total ?? 0 : preview?.summary.fresh ?? 0;

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
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
        </label>
        {file ? (
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
            {file.name} · {formatLimit(file.size)}
            <button
              type="button"
              className="hover:text-text"
              disabled={pending}
              onClick={() => {
                setFile(null);
                reset();
              }}
              aria-label="Use pasted text instead of this file"
            >
              ×
            </button>
          </span>
        ) : null}
        <span className="font-mono text-[10px] text-subtle">
          {file ? "" : "or paste below · "}read in your browser · files up to {formatLimit(IMPORT_LIMITS.maxFileBytes)} · {IMPORT_LIMITS.maxRows} contacts per import
        </span>
      </div>
      {file ? null : (
        <textarea
          className="aur-input font-mono text-[11px]"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            reset();
          }}
          placeholder={"Name,Agency,Office,Title,Email,Phone\nAna Rivera,Department of the Navy,NAVSEA,Contracting Officer,ana.rivera@navy.mil,202-555-0100"}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runPreview} disabled={pending || !(file ? file.text : text).trim()} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60">
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
              {pending ? "Importing…" : sending ? "Import the rest" : `Import ${plural(importCount, "contact")}`}
            </button>
          </>
        ) : null}
      </div>
      {error ? <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      {preview ? (
        <>
          {preview.stoppedAt !== null ? (
            <p className="font-mono text-[10px] text-amber-200">
              This file holds more than {IMPORT_LIMITS.maxRows} contacts; one import takes {IMPORT_LIMITS.maxRows}. Reading stopped at {preview.format === "vcard" ? "card" : "line"} {preview.stoppedAt}: import from there on as a separate file{preview.format === "vcard" ? "" : " (with the header row)"}.
            </p>
          ) : null}
          {preview.unmappedHeaders.length > 0 ? (
            <p className="font-mono text-[10px] text-subtle">Columns not read: {preview.unmappedHeaders.join(", ")}</p>
          ) : null}
          <div className="max-h-[320px] overflow-y-auto rounded-md border border-layer/10">
            <table className="w-full text-left font-body text-[12px]">
              <thead className="sticky top-0 bg-canvas font-mono text-[10px] uppercase tracking-widest text-muted">
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
                        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-200" title={`Matches ${r.duplicate.existingName} by ${r.duplicate.by}`}>
                          already known · {r.duplicate.by}
                        </span>
                      ) : (
                        <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">new</span>
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
                {preview.skipped.slice(0, SKIPS_SHOWN).map((s, i) => (
                  <li key={`${s.line}-${i}`}>
                    line {s.line}: {s.reason}
                  </li>
                ))}
                {preview.skipped.length > SKIPS_SHOWN ? <li>…and {preview.skipped.length - SKIPS_SHOWN} more</li> : null}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
