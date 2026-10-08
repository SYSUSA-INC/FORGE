"use client";

import { useState, useTransition } from "react";
import { putWithProgress } from "@/lib/upload-client";
import { classifyPutFailure, describeUploadFailure } from "@/lib/upload-client-logic";
import type { StorageProbe } from "@/lib/storage-diagnostics";
import { finishStorageSelfTestAction, probeStorageAction, startStorageSelfTestAction } from "./actions";

type SelfTest = { ok: boolean; text: string } | null;

function mark(ok: boolean | null): { label: string; className: string } {
  if (ok === true) return { label: "ok", className: "text-emerald" };
  if (ok === false) return { label: "failed", className: "text-rose" };
  return { label: "info", className: "text-muted" };
}

/**
 * BL-STAB-2 — is file storage ready for uploads straight from the browser?
 * "Check storage" runs the server probe; "Test from this browser" uploads a
 * 1 KB file from this browser exactly as a user's file would travel.
 */
export function StorageCheck() {
  const [pending, start] = useTransition();
  const [probe, setProbe] = useState<StorageProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTest>(null);
  const [testing, setTesting] = useState(false);

  const runProbe = () =>
    start(async () => {
      setError(null);
      const res = await probeStorageAction();
      if (res.ok) setProbe(res.probe);
      else setError(res.error);
    });

  const runSelfTest = async () => {
    setTesting(true);
    setSelfTest(null);
    try {
      const link = await startStorageSelfTestAction();
      if (!link.ok) {
        setSelfTest({ ok: false, text: link.error });
        return;
      }
      const put = await putWithProgress({
        url: link.url,
        headers: link.headers,
        body: new Blob([new Uint8Array(link.bytes).fill(0x61)], { type: "text/plain" }),
      });
      const done = await finishStorageSelfTestAction({ key: link.key, putStatus: put.status });
      if (done.ok) {
        setSelfTest({ ok: true, text: done.detail });
      } else {
        const outcome = put.status >= 200 && put.status < 300 ? null : classifyPutFailure({ status: put.status, bodyText: put.bodyText, expiresAt: link.expiresAt, now: Date.now() });
        setSelfTest({ ok: false, text: outcome && outcome !== "network_or_cors" ? `${describeUploadFailure(outcome)} ${done.error}` : done.error });
      }
    } catch (err) {
      setSelfTest({ ok: false, text: err instanceof Error ? err.message : "The self-test failed." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={pending} onClick={runProbe}>
          {pending ? "Checking…" : "Check storage"}
        </button>
        <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={testing} onClick={runSelfTest}>
          {testing ? "Uploading…" : "Test from this browser"}
        </button>
        {selfTest ? <span className={`font-mono text-[11px] ${selfTest.ok ? "text-emerald" : "text-rose"}`}>{selfTest.text}</span> : null}
      </div>
      {error ? <p className="font-mono text-[11px] text-rose">{error}</p> : null}
      {probe ? (
        <div className="flex flex-col gap-2 rounded-md border border-layer/10 bg-layer/[0.02] p-3">
          <p className="font-mono text-[11px] text-text">
            <span className={probe.ready ? "text-emerald" : "text-rose"}>{probe.ready ? "Ready for browser uploads" : "Not ready for browser uploads"}</span>
            {" · "}
            {probe.provider === "r2" ? "Cloudflare R2" : "in-memory fallback"} · {probe.environment} · transport {probe.transport}
          </p>
          <ul className="flex flex-col gap-1">
            {probe.steps.map((s) => {
              const m = mark(s.ok);
              return (
                <li key={s.name} className="font-mono text-[11px] text-muted">
                  <span className={m.className}>[{m.label}]</span> <span className="text-text">{s.name}</span> — {s.detail}
                </li>
              );
            })}
            {probe.cors.map((c) => (
              <li key={c.origin} className="font-mono text-[11px] text-muted">
                <span className={c.ok ? "text-emerald" : "text-rose"}>[{c.ok ? "ok" : "failed"}]</span> <span className="text-text">CORS for {c.origin}</span> — {c.detail}
              </li>
            ))}
          </ul>
          <p className="font-mono text-[10px] text-subtle">Checked {probe.checkedAt.replace("T", " ").slice(0, 19)} UTC</p>
        </div>
      ) : null}
    </div>
  );
}
