/**
 * BL-STAB-2b — what may be uploaded, for what, and how large. Pure and
 * safe to import in the browser, so a file is checked before any request.
 *
 * A purpose names why a file is uploaded; it fixes the formats allowed,
 * the per-file limit, whether the file is kept after it is read, whether
 * it counts toward the organization's storage, and which records may
 * claim it. Limits here are policy, not a transport ceiling: the browser
 * sends the bytes straight to storage.
 */

const MiB = 1024 * 1024;

export const UPLOAD_PURPOSES = ["document", "template_docx", "chat_attachment", "diagnostic"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export type UploadFormat = "pdf" | "docx" | "xlsx" | "pptx" | "text" | "image";
export type UploadStatus = "pending" | "stored" | "claiming" | "claimed" | "failed" | "released";
export type UploadTransport = "direct" | "proxy";
export type UploadResourceType =
  | "solicitation"
  | "solicitation_document"
  | "knowledge_artifact"
  | "proposal_template"
  | "section_chat_attachment";

export type PurposePolicy = {
  maxBytes: number;
  formats: readonly UploadFormat[];
  /** Deleted once read (kept under `tmp/`), rather than kept with a record. */
  transient: boolean;
  countsTowardQuota: boolean;
  claimableAs: readonly UploadResourceType[];
};

/** Above this no upload is accepted: the `file_size` columns are 32-bit and R2 takes at most 5 GB in one PUT. */
export const HARD_MAX_BYTES = 1024 * MiB;
/** Uploads through the app (memory storage, or the proxy lever) on Vercel stop below its request cap. */
export const PROXY_MAX_BYTES_ON_VERCEL = 4 * MiB;

export const UPLOAD_POLICIES: Record<UploadPurpose, PurposePolicy> = {
  document: {
    maxBytes: 500 * MiB,
    formats: ["pdf", "docx", "xlsx", "pptx", "text", "image"],
    transient: false,
    countsTowardQuota: true,
    claimableAs: ["solicitation", "solicitation_document", "knowledge_artifact"],
  },
  template_docx: {
    maxBytes: 50 * MiB,
    formats: ["docx"],
    transient: false,
    countsTowardQuota: true,
    claimableAs: ["proposal_template"],
  },
  chat_attachment: {
    maxBytes: 50 * MiB,
    formats: ["pdf", "docx", "xlsx", "pptx", "text"],
    transient: true,
    countsTowardQuota: false,
    claimableAs: ["section_chat_attachment"],
  },
  diagnostic: {
    maxBytes: MiB,
    formats: ["text"],
    transient: true,
    countsTowardQuota: false,
    claimableAs: [],
  },
};

export function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

/** The policy for a purpose; `UPLOAD_MAX_FILE_MB` (1 to 1024) sets the per-file limit for documents. */
export function resolvePolicy(purpose: UploadPurpose, env: Record<string, string | undefined> = {}): PurposePolicy {
  const policy = UPLOAD_POLICIES[purpose];
  if (purpose !== "document") return policy;
  const mb = Number(env.UPLOAD_MAX_FILE_MB);
  if (!Number.isFinite(mb) || mb <= 0) return policy;
  return { ...policy, maxBytes: Math.min(HARD_MAX_BYTES, Math.max(1, Math.floor(mb)) * MiB) };
}

const EXTENSIONS: Record<string, UploadFormat> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  txt: "text",
  md: "text",
  csv: "text",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
};

/** The format a file name says it is. Older Office formats (.doc/.xls/.ppt) are told apart so the message can say what to do. */
export function formatFromName(fileName: string):
  | { ok: true; format: UploadFormat; ext: string }
  | { ok: false; code: "legacy_office" | "unsupported" } {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const ext = match ? match[1]!.toLowerCase() : "";
  if (ext === "doc" || ext === "xls" || ext === "ppt") return { ok: false, code: "legacy_office" };
  const format = EXTENSIONS[ext];
  return format ? { ok: true, format, ext } : { ok: false, code: "unsupported" };
}

/**
 * The content type an upload link is signed with, chosen by the server
 * from the format (never the browser's guess). Text is sent as plain
 * text, Markdown aside, so the text reader recognises CSV files too.
 */
export function canonicalContentType(format: UploadFormat, ext: string): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "text":
      return ext === "md" ? "text/markdown" : "text/plain";
    case "image":
      return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  }
}

const encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return encoder.encode(s).byteLength;
}

/**
 * A file name safe to show and store: Unicode-normalised, without control
 * or text-direction characters (which can disguise an extension), with
 * no path separators or leading dots, at most 255 bytes with its
 * extension kept. "file" when nothing is left.
 */
export function sanitizeDisplayName(raw: string): string {
  let name = (raw || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (!name) return "file";
  if (utf8ByteLength(name) <= 255) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  let stem = ext ? name.slice(0, dot) : name;
  while (stem && utf8ByteLength(stem + ext) > 255) stem = Array.from(stem).slice(0, -1).join("");
  name = (stem + ext).trim();
  return name || "file";
}

export type UploadRequestCheck =
  | { ok: true; displayName: string; format: UploadFormat; contentType: string; maxBytes: number }
  | { ok: false; code: string; error: string };

function mb(bytes: number): string {
  return `${Math.round(bytes / MiB)} MB`;
}

/** Check a file before asking to upload it: name, format for this purpose, and size. */
export function validateUploadRequest(input: {
  purpose: UploadPurpose;
  fileName: string;
  size: number;
  env?: Record<string, string | undefined>;
}): UploadRequestCheck {
  const policy = resolvePolicy(input.purpose, input.env);
  const displayName = sanitizeDisplayName(input.fileName);
  const kind = formatFromName(displayName);
  if (!kind.ok) {
    return kind.code === "legacy_office"
      ? { ok: false, code: "legacy_office", error: "This is an older Office format. Save it as .docx, .xlsx or .pptx and upload that." }
      : { ok: false, code: "unsupported", error: `"${displayName}" is not a file type FORGE reads.` };
  }
  if (!policy.formats.includes(kind.format)) {
    return { ok: false, code: "format_not_allowed", error: `${kind.ext.toUpperCase()} files can't be uploaded here.` };
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    return { ok: false, code: "empty", error: `"${displayName}" is empty.` };
  }
  const maxBytes = Math.min(policy.maxBytes, HARD_MAX_BYTES);
  if (input.size > maxBytes) {
    return { ok: false, code: "too_large", error: `"${displayName}" is larger than the ${mb(maxBytes)} limit.` };
  }
  return { ok: true, displayName, format: kind.format, contentType: canonicalContentType(kind.format, kind.ext), maxBytes };
}

/** How long an upload link works: 15 minutes plus a second per 256 KB, at most an hour. */
export function expirySecondsFor(bytes: number): number {
  return Math.min(3600, 900 + Math.ceil(Math.max(0, bytes) / 262_144));
}

/** The storage key for an upload, built only from server-side values. */
export function uploadKeyFor(organizationId: string, uploadId: string, transient: boolean): string {
  return `${transient ? "tmp" : "org"}/${organizationId}/uploads/${uploadId}`;
}

/**
 * Whether a storage key belongs to this organization: it sits under
 * `org/{organizationId}/` or `tmp/{organizationId}/`, with no empty, "."
 * or ".." segment, no leading slash and no backslash. Keys written before
 * BL-STAB-2 (`org/{org}/solicitation/{id}/{name}`) pass too.
 */
export function isKeyInOrg(organizationId: string, key: string): boolean {
  if (!organizationId || !key || key.includes("\\")) return false;
  const segments = key.split("/");
  if (segments.length < 3) return false;
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  return (segments[0] === "org" || segments[0] === "tmp") && segments[1] === organizationId;
}

export function assertKeyInOrg(organizationId: string, key: string): void {
  if (!isKeyInOrg(organizationId, key)) throw new Error("Storage key outside this organization.");
}

/** What the browser is told about an upload. */
export type UploadView = {
  uploadId: string;
  status: UploadStatus;
  fileName: string;
  size: number;
  format: UploadFormat;
  contentType: string;
  failureReason: string;
  message: string;
};
