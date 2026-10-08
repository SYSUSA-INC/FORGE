"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelUploadAction } from "@/app/(app)/uploads/actions";
import { uploadFile, type UploadPhase } from "@/lib/upload-client";
import { progressSnapshot, type ProgressSnap } from "@/lib/upload-client-logic";
import type { UploadPurpose } from "@/lib/upload-policy";

export type UploadItem<R, M = undefined> = {
  id: string;
  file: File;
  /** What the caller attached to this file (for example its amendment number). */
  meta: M;
  phase: UploadPhase;
  loaded: number;
  total: number;
  bytesPerSec: number | null;
  etaSec: number | null;
  uploadId?: string;
  /** The file is in storage and checked; only filing it is left (a retry re-files it). */
  stored?: boolean;
  result?: R;
  error?: string;
};

type Claim<R, M> = (i: { uploadId: string; file: File; meta: M }) => Promise<{ ok: true; result: R } | { ok: false; error: string }>;

let seq = 0;

/** What a server action that threw (rather than answered) means to the person uploading. */
function thrownMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  return /fetch|network|load failed/i.test(raw)
    ? "The connection to FORGE dropped. Check your network, then Retry."
    : "FORGE didn't answer (it may have timed out). Retry; your file is kept if it already arrived.";
}

/**
 * BL-STAB-2c — upload a list of files straight to storage, a few at a
 * time, each with its own progress, retry and cancel. When `claim` is
 * given, each checked upload is filed by it (for example as a new
 * solicitation); without it items stop once checked and their ids are
 * in `readyUploadIds` for a batch action. Leaving the page while files
 * are uploading asks first.
 *
 * A server action that throws marks its row failed (it never leaves a
 * row, or the queue, stuck). A retry after a filing failure files the
 * stored upload again instead of uploading the file twice. Cancel works
 * until filing starts. Nothing is reported to the caller once the form
 * is gone, so a finished upload never navigates away from where the
 * person went.
 */
export function useUploadQueue<R = never, M = undefined>(opts: {
  purpose: UploadPurpose;
  concurrency?: number;
  /** The server's per-file limit for this purpose. */
  maxBytes?: number;
  claim?: Claim<R, M>;
  onItemDone?: (item: UploadItem<R, M>) => void;
}) {
  const [items, setItems] = useState<UploadItem<R, M>[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(new Set<string>());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((id: string, change: Partial<UploadItem<R, M>>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  /** One pass at an item: upload it (unless it is already stored), then file it. */
  const attempt = useCallback(
    async (item: UploadItem<R, M>, controller: AbortController): Promise<Partial<UploadItem<R, M>>> => {
      let uploadId = item.stored ? item.uploadId : undefined;
      if (!uploadId) {
        let snap: ProgressSnap | null = null;
        let lastPaint = 0;
        patch(item.id, { phase: "uploading", error: undefined, loaded: 0, uploadId: undefined, stored: false });
        const res = await uploadFile(item.file, {
          purpose: optsRef.current.purpose,
          maxBytes: optsRef.current.maxBytes,
          signal: controller.signal,
          onPhase: (phase) => patch(item.id, { phase }),
          onProgress: (loaded, total) => {
            snap = progressSnapshot(snap, loaded, total, Date.now());
            if (Date.now() - lastPaint < 100 && loaded < total) return;
            lastPaint = Date.now();
            patch(item.id, { loaded, total, bytesPerSec: snap.bytesPerSec, etaSec: snap.etaSec });
          },
        });
        if (!res.ok) return { phase: res.cancelled ? "cancelled" : "failed", error: res.error };
        uploadId = res.uploadId;
        patch(item.id, { uploadId, stored: true, loaded: item.file.size });
      }
      const claim = optsRef.current.claim;
      if (!claim) return { phase: "done", uploadId, loaded: item.file.size };
      // Last moment a cancel applies: once filing starts it runs to the end.
      if (controller.signal.aborted) {
        await cancelUploadAction(uploadId).catch(() => undefined);
        return { phase: "cancelled", error: "Upload cancelled.", stored: false, uploadId: undefined };
      }
      controllers.current.delete(item.id);
      patch(item.id, { phase: "saving", error: undefined });
      const filed = await claim({ uploadId, file: item.file, meta: item.meta });
      return filed.ok ? { phase: "done", result: filed.result, uploadId, stored: false } : { phase: "failed", error: filed.error, uploadId, stored: true };
    },
    [patch],
  );

  const run = useCallback(
    async (item: UploadItem<R, M>) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      running.current.add(item.id);
      let done: Partial<UploadItem<R, M>>;
      try {
        done = await attempt(item, controller);
      } catch (err) {
        // A server action that threw: the row fails with Retry instead of hanging.
        done = { phase: "failed", error: thrownMessage(err) };
      } finally {
        controllers.current.delete(item.id);
        running.current.delete(item.id);
      }
      patch(item.id, done);
      if (mounted.current) optsRef.current.onItemDone?.({ ...item, ...done } as UploadItem<R, M>);
    },
    [attempt, patch],
  );

  // Start queued items while there is room.
  useEffect(() => {
    const room = (opts.concurrency ?? 3) - running.current.size;
    if (room <= 0) return;
    items
      .filter((it) => it.phase === "queued" && !running.current.has(it.id))
      .slice(0, room)
      .forEach((it) => void run(it));
  }, [items, opts.concurrency, run]);

  const busy = items.some((it) => it.phase === "queued" || it.phase === "uploading" || it.phase === "verifying" || it.phase === "saving");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return {
    items,
    busy,
    readyUploadIds: items.filter((it) => it.phase === "done" && it.uploadId).map((it) => it.uploadId!),
    add(entries: { file: File; meta: M }[]) {
      const added = entries.map<UploadItem<R, M>>(({ file, meta }) => ({
        id: `u${++seq}`,
        file,
        meta,
        phase: "queued",
        loaded: 0,
        total: file.size,
        bytesPerSec: null,
        etaSec: null,
      }));
      setItems((list) => [...list, ...added]);
    },
    retry(id: string) {
      patch(id, { phase: "queued", error: undefined });
    },
    cancel(id: string) {
      const controller = controllers.current.get(id);
      if (controller) controller.abort();
      else setItems((list) => list.map((it) => (it.id === id && it.phase === "queued" ? { ...it, phase: "cancelled" } : it)));
    },
    remove(id: string) {
      controllers.current.get(id)?.abort();
      setItems((list) => list.filter((it) => it.id !== id));
    },
    clear() {
      setItems((list) => list.filter((it) => running.current.has(it.id)));
    },
  };
}
