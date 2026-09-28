/**
 * BL-AIP-4b — SigV4 against the worked example in the S3 documentation
 * ("GET Object", single-chunk payload, 24 May 2013).
 */
import { describe, expect, it } from "vitest";
import {
  amzDate,
  EMPTY_PAYLOAD_SHA256,
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

  it("encodes object keys segment by segment and formats dates", () => {
    expect(uriEncodePath("/bucket/org 1/file (v2)*.pdf")).toBe("/bucket/org%201/file%20%28v2%29%2A.pdf");
    expect(amzDate(new Date("2026-09-28T14:05:09.123Z"))).toEqual({
      amzDate: "20260928T140509Z",
      dateStamp: "20260928",
    });
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_SHA256);
  });
});
