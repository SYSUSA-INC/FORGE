/**
 * BL-AIP-4b — AWS Signature Version 4 for S3-compatible object stores.
 *
 * Cloudflare R2 speaks the S3 API. Signing a PUT / GET by hand is ~80
 * lines and keeps `@aws-sdk/client-s3` (and its transitive tree) out of
 * the bundle for two verbs. Pure: Node crypto only, no I/O; tested
 * against the worked example in the AWS S3 documentation.
 */
import { createHash, createHmac } from "node:crypto";

export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding of one path segment (S3 style: `/` kept between segments). */
export function uriEncodePath(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

/** `20130524T000000Z` and `20130524` for a Date. */
export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export type SignInput = {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  host: string;
  /** Already-encoded path starting with "/". */
  path: string;
  /** Lower-cased header names → values; `host` is added automatically. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
};

export type SignedRequest = {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

/**
 * Build the SigV4 `Authorization` header. Every header passed in is
 * signed, plus `host`, `x-amz-date` and `x-amz-content-sha256`.
 */
export function signRequest(input: SignInput): SignedRequest {
  const { amzDate: date, dateStamp } = amzDate(input.now);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v.trim();
  headers.host = input.host;
  headers["x-amz-date"] = date;
  headers["x-amz-content-sha256"] = input.payloadHash;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headers[k]!.replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    "", // canonical query string (none for our verbs)
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
