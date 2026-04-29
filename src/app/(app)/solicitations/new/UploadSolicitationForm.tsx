"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { uploadSolicitationAction } from "../actions";

export function UploadSolicitationForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function handleFile(f: File | undefined | null) {
    if (!f) return;
    if (f.size === 0) {
      setError("That file is empty.");
      return;
    }
    setError(null);
    setFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    handleFile(f);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Pick a PDF first.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await uploadSolicitationAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/solicitations/${res.id}`);
    });
  }

  return (
    <Panel title="Upload" eyebrow="PDF · 25 MB cap (v1)">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div
          onClick={pickFile}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative grid place-items-center cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
            dragOver
              ? "border-teal/70 bg-teal/[0.06]"
              : "border-white/15 bg-white/[0.02] hover:border-white/30"
          }`}
        >
          <div className="font-display text-2xl font-semibold text-text">
            {file ? file.name : "Drop a PDF here"}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {file
              ? `${Math.max(1, Math.round(file.size / 1024))} KB`
              : "or click to browse"}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              pickFile();
            }}
            className="aur-btn aur-btn-primary mt-4"
          >
            {file ? "Choose another file" : "Select file"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            {pending
              ? "Uploading + parsing…"
              : "Upload runs text extraction and AI parse synchronously."}
          </div>
          <button
            type="submit"
            disabled={!file || pending}
            className="aur-btn aur-btn-primary disabled:opacity-50"
          >
            {pending ? "Uploading…" : "Upload + parse"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
