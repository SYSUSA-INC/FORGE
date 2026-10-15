/**
 * BL-STAB-2d — the browser stops an upload before the server's sweep could
 * delete it: each PUT carries a time limit counted from when its link was
 * issued; a first attempt that runs out is "too slow"; a retry that started
 * late in the link's life gets a fresh link first. The server actions and
 * XMLHttpRequest are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  requestUploadAction: vi.fn(),
  completeUploadAction: vi.fn(),
  cancelUploadAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/(app)/uploads/actions", () => actions);

import { uploadFile } from "@/lib/upload-client";
import { PUT_GRACE_MS } from "@/lib/upload-client-logic";

type Outcome = "timeout" | "error" | "ok";

/** Each PUT answers with the next scripted outcome and records the time limit it was given. */
class FakeXHR {
  static script: Outcome[] = [];
  static timeouts: number[] = [];
  timeout = 0;
  status = 0;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send() {
    FakeXHR.timeouts.push(this.timeout);
    const next = FakeXHR.script.shift() ?? "ok";
    queueMicrotask(() => {
      if (next === "timeout") this.ontimeout?.();
      else if (next === "error") this.onerror?.();
      else {
        this.status = 200;
        this.onload?.();
      }
    });
  }
}

let links = 0;
const intent = () => ({
  ok: true,
  uploadId: `upload-${++links}`,
  transport: "direct",
  put: { url: "https://r2.example/key", method: "PUT", headers: {} },
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  expiresInSeconds: 900,
  maxBytes: 500 * 1024 * 1024,
});
const file = () => new File([new Uint8Array(64)], "RFP.pdf", { type: "application/pdf" });

describe("BL-STAB-2d — the browser's time limit on an upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    links = 0;
    FakeXHR.script = [];
    FakeXHR.timeouts = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    actions.requestUploadAction.mockImplementation(async () => intent());
    actions.completeUploadAction.mockImplementation(async (uploadId: string) => ({ ok: true, upload: { uploadId, status: "stored" } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives a PUT the link's life plus the grace, and calls a first attempt that runs out too slow", async () => {
    FakeXHR.script = ["timeout"];
    const res = await uploadFile(file(), { purpose: "document" });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/too slow to finish while its link was valid/) });
    expect(FakeXHR.timeouts).toHaveLength(1);
    expect(FakeXHR.timeouts[0]).toBeGreaterThan(900_000 + PUT_GRACE_MS - 1_000);
    expect(FakeXHR.timeouts[0]).toBeLessThanOrEqual(900_000 + PUT_GRACE_MS);
    expect(actions.cancelUploadAction).toHaveBeenCalledWith("upload-1");
    expect(actions.requestUploadAction).toHaveBeenCalledTimes(1);
  });

  it("gives a retry that ran out of what was left of its link a fresh link", async () => {
    // The network drops, the retry runs out of the link's remaining time, the fresh link works.
    FakeXHR.script = ["error", "timeout", "ok"];
    const res = await uploadFile(file(), { purpose: "document" });
    expect(res).toMatchObject({ ok: true, uploadId: "upload-2" });
    expect(actions.cancelUploadAction).toHaveBeenCalledWith("upload-1");
    expect(actions.requestUploadAction).toHaveBeenCalledTimes(2);
    expect(FakeXHR.timeouts).toHaveLength(3);
  }, 10_000);
});
