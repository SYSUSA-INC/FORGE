/**
 * BL-STAB-2 — how the browser reacts to a failed upload straight to
 * storage, and how progress reads. Pure.
 */
import { describe, expect, it } from "vitest";
import { classifyPutFailure, describeUploadFailure, formatBytes, nextBackoffMs, progressSnapshot } from "@/lib/upload-client-logic";

const later = new Date(Date.now() + 10 * 60_000).toISOString();

describe("classifyPutFailure", () => {
  it("tells a blocked request, an expired link, a bad signature, too large and a busy store apart", () => {
    const now = Date.now();
    expect(classifyPutFailure({ status: 0, bodyText: "", expiresAt: later, now })).toBe("network_or_cors");
    expect(classifyPutFailure({ status: 403, bodyText: "<Code>AccessDenied</Code><Message>Request has expired</Message>", expiresAt: later, now })).toBe("renew");
    expect(classifyPutFailure({ status: 403, bodyText: "SignatureDoesNotMatch", expiresAt: new Date(now + 10_000).toISOString(), now })).toBe("renew");
    expect(classifyPutFailure({ status: 403, bodyText: "SignatureDoesNotMatch", expiresAt: later, now })).toBe("fatal_signature");
    expect(classifyPutFailure({ status: 413, bodyText: "", expiresAt: later, now })).toBe("fatal_too_large");
    for (const status of [500, 503, 429, 408]) expect(classifyPutFailure({ status, bodyText: "", expiresAt: later, now })).toBe("retry");
  });

  it("every outcome has a message a person can act on", () => {
    expect(describeUploadFailure("network_or_cors")).toMatch(/Admin → Jobs → File storage/);
    for (const code of ["renew", "retry", "fatal_signature", "fatal_too_large", "cancelled", "other"]) expect(describeUploadFailure(code).length).toBeGreaterThan(10);
  });
});

describe("backoff and progress", () => {
  it("backs off 1 s, 4 s, 10 s, then stops", () => {
    expect([1, 2, 3, 4, 0].map(nextBackoffMs)).toEqual([1_000, 4_000, 10_000, null, null]);
  });

  it("smooths the speed and estimates the time left", () => {
    const a = progressSnapshot(null, 0, 10_000_000, 0);
    expect(a.bytesPerSec).toBeNull();
    const b = progressSnapshot(a, 1_000_000, 10_000_000, 1_000);
    expect(b.bytesPerSec).toBe(1_000_000);
    expect(b.etaSec).toBe(9);
    const c = progressSnapshot(b, 1_500_000, 10_000_000, 2_000);
    expect(c.bytesPerSec).toBe(850_000);
    expect(c.etaSec).toBe(Math.ceil(8_500_000 / 850_000));
  });

  it("formats sizes as people read them", () => {
    expect([512, 12_400, 12_400_000, 1_250_000_000].map(formatBytes)).toEqual(["512 B", "12.4 KB", "12.4 MB", "1.25 GB"]);
  });
});
