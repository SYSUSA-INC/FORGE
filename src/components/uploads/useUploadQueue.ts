"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile, type UploadPhase } from "@/lib/upload-client";
import { progressSnapshot, type ProgressSnap } from "@/lib/upload-client-logic";
import type { UploadPurpose } from "@/lib/upload-policy";

export type UploadItem<R> = {
  id: string;
  file: File;
  phase: UploadPhase;
  loaded: number;
  total: number;
  bytesPerSec: number | null;
  etaSec: number | null;
  uploadId?: string;
  result?: R;
  error?: string;
};

type Claim<R> = (i: { uploadId: string; file: File }) => Promise<{ ok: true; result: R } | { ok: false; error: string }>;

let seq = 0;

/**
 * BL-STAB-2c — upload a list of files straight to storage, a few at a
 * time, each with its own progress, retry and cancel. When `claim` is
 * given, each checked upload is filed by it (for example as a new
 * solicitation); without it items stop once checked and their ids are
 * in `readyUploadIds` for a batch action. Leaving the page while files
 * are uploading asks first.
 */
export function useUploadQueue<R = never>(opts: {
  purpose: UploadPurpose;
  concurrency?: number;
  claim?: Claim<R>;
  onItemDone?: (item: UploadItem<R>) => void;
}) {
  const [items, setItems] = useState<UploadItem<R>[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(new Set<string>());
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patch = useCallback((id: string, change: Partial<UploadItem<R>>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  const run = useCallback(
    async (item: UploadItem<R>) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      running.current.add(item.id);
      let snap: ProgressSnap | null = null;
      let lastPaint = 0;
      patch(item.id, { phase: "uploading", error: undefined, loaded: 0 });
      const res = await uploadFile(item.file, {
        purpose: optsRef.current.purpose,
        signal: controller.signal,
        onPhase: (phase) => patch(item.id, { phase }),
        onProgress: (loaded, total) => {
          snap = progressSnapshot(snap, loaded, total, Date.now());
          if (Date.now() - lastPaint < 100 && loaded < total) return;
          lastPaint = Date.now();
          patch(item.id, { loaded, total, bytesPerSec: snap.bytesPerSec, etaSec: snap.etaSec });
        },
      });
      let done: Partial<UploadItem<R>>;
      if (!res.ok) {
        done = { phase: res.cancelled ? "cancelled" : "failed", error: res.error };
      } else if (optsRef.current.claim) {
        patch(item.id, { phase: "saving", uploadId: res.uploadId, loaded: item.file.size });
        const filed = await optsRef.current.claim({ uploadId: res.uploadId, file: item.file });
        done = filed.ok ? { phase: "done", result: filed.result, uploadId: res.uploadId } : { phase: "failed", error: filed.error, uploadId: res.uploadId };
      } else {
        done = { phase: "done", uploadId: res.uploadId, loaded: item.file.size };
      }
      controllers.current.delete(item.id);
      running.current.delete(item.id);
      patch(item.id, done);
      optsRef.current.onItemDone?.({ ...item, ...done } as UploadItem<R>);
    },
    [patch],
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

  const busy = items.some((it) => it.phase === "uploading" || it.phase === "verifying" || it.phase === "saving");
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
    add(files: File[] | FileList) {
      const added = Array.from(files).map<UploadItem<R>>((file) => ({
        id: `u${++seq}`,
        file,
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
      else patch(id, { phase: "cancelled" });
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
