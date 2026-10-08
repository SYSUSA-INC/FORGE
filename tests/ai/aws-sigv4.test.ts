/**
 * BL-AIP-4b — SigV4 against the worked example in the S3 documentation
 * ("GET Object", single-chunk payload, 24 May 2013).
 */
import { describe, expect, it } from "vitest";
import {
  amzDate,
  EMPTY_PAYLOAD_SHA256,
  presignUrl,
  sha256Hex,
  signRequest,
  uriEncodePath,
} from "@/lib/aws-sigv4";

describe("BL-AIP-4b — SigV4", () => {
  it("reproduces the AWS documentation example signature", () => {
    const signed = signRequest({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { Range: "bytes=0-9" },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      region: "us-east-1",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(sha256Hex(signed.canonicalRequest)).toBe(
      "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    );
    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(signed.headers["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("BL-STAB-2 — reproduces the AWS presigned-URL example (query-string authentication)", () => {
    const presigned = presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2013-05-24T00:00:00Z"),
      expiresSeconds: 86400,
    });
    expect(presigned.signature).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(presigned.url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(presigned.headers).toEqual({});
  });

  it("BL-STAB-2 — an R2 upload link matches an independent SigV4 implementation, and every signed part matters", () => {
    const r2 = {
      method: "PUT" as const,
      host: "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      path: "/forge-uploads/org/11111111-1111-4111-8111-111111111111/uploads/22222222-2222-4222-8222-222222222222",
      headers: { "content-type": "application/pdf", "content-length": "1048576" },
      region: "auto",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2026-10-08T12:00:00Z"),
      expiresSeconds: 900,
    };
    const signed = presignUrl(r2);
    expect(sha256Hex(signed.canonicalRequest)).toBe("2edab4a409a483209d3ed366b4f6d5c32087b880d61f7565b4476f4ef177d6c6");
    expect(signed.signature).toBe("1b059663382ac6037ea15a587a33992d57a870c277f368806bc8a420ec8dfcc3");
    expect(signed.url).toBe(
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/forge-uploads/org/11111111-1111-4111-8111-111111111111/uploads/22222222-2222-4222-8222-222222222222?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261008%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261008T120000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=1b059663382ac6037ea15a587a33992d57a870c277f368806bc8a420ec8dfcc3",
    );
    // Type only (UPLOAD_SIGN_CONTENT_LENGTH=0).
    expect(presignUrl({ ...r2, headers: { "content-type": "application/pdf" } }).signature).toBe(
      "6f736194cd0438f39df4c688f49ed5f9e29cba7c912b7cba76a014aed65ce0ee",
    );
    const variants = [
      { ...r2, headers: { ...r2.headers, "content-length": "1048575" } },
      { ...r2, headers: { ...r2.headers, "content-length": "1048577" } },
      { ...r2, headers: { ...r2.headers, "content-type": "text/html" } },
      { ...r2, path: r2.path.replace("22222222-2222", "33333333-3333") },
      { ...r2, expiresSeconds: 901 },
      { ...r2, now: new Date("2026-10-08T12:00:01Z") },
      { ...r2, method: "GET" as const },
    ];
    for (const v of variants) expect(presignUrl(v).signature).not.toBe(signed.signature);
    expect(Object.keys(signed.headers)).not.toContain("host");
  });

  it("BL-STAB-2 — signs the headers a presigned PUT must send, and refuses an out-of-range expiry", () => {
    const presigned = presignUrl({
      method: "PUT",
      host: "acct.r2.cloudflarestorage.com",
      path: "/bucket/org/1/upload/abc",
      headers: { "Content-Type": "application/pdf", "content-length": "1048576" },
      region: "auto",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      now: new Date("2026-10-08T00:00:00Z"),
      expiresSeconds: 900,
    });
    expect(presigned.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(presigned.headers).toEqual({ "content-type": "application/pdf", "content-length": "1048576" });
    expect(presigned.canonicalRequest.endsWith("UNSIGNED-PAYLOAD")).toBe(true);
    expect(() => presignUrl({ ...presignedInputFor(0) })).toThrow(/expiresSeconds/);
    expect(() => presignUrl({ ...presignedInputFor(604_801) })).toThrow(/expiresSeconds/);
  });

  it("encodes object keys segment by segment and formats dates", () => {
    expect(uriEncodePath("/bucket/org 1/file (v2)*.pdf")).toBe("/bucket/org%201/file%20%28v2%29%2A.pdf");
    expect(amzDate(new Date("2026-09-28T14:05:09.123Z"))).toEqual({
      amzDate: "20260928T140509Z",
      dateStamp: "20260928",
    });
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_SHA256);
  });
});

function presignedInputFor(expiresSeconds: number) {
  return {
    method: "PUT" as const,
    host: "h",
    path: "/k",
    region: "auto",
    service: "s3",
    accessKeyId: "a",
    secretAccessKey: "s",
    now: new Date("2026-10-08T00:00:00Z"),
    expiresSeconds,
  };
}
