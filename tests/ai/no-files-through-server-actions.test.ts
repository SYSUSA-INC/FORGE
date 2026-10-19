/**
 * BL-STAB-2f — no file passes through a server action. An action's body
 * is capped by Next (1 MB) and by Vercel (~4.5 MB) and the whole file
 * sits in one function's memory, so files upload straight to storage
 * (src/lib/upload-client.ts) and actions file them by upload id
 * (src/lib/uploads.ts). Two route handlers read a request body as a
 * file on purpose, each held under Vercel's cap; they are listed here
 * with the reason, and a new one fails this test until it is.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTATION_LIMITS } from "@/lib/dictation";
import { PROXY_MAX_BYTES_ON_VERCEL } from "@/lib/upload-policy";

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const USE_SERVER = /^\s*["']use server["'];?\s*$/m;

const FILE_SHAPES: [RegExp, string][] = [
  [/\binstanceof\s+(File|Blob)\b/, "checks for a File or Blob"],
  [/:\s*(File|Blob)\b|\b(File|Blob)\[\]|<(File|Blob)>/, "takes a File or Blob"],
  [/\.(arrayBuffer|stream|blob)\(\)/, "reads bytes from a body"],
];

/** What in a server-action file looks like a file coming through it. */
function fileShapes(src: string): string[] {
  const code = withoutComments(src);
  if (!USE_SERVER.test(code)) return [];
  return FILE_SHAPES.filter(([re]) => re.test(code)).map(([, what]) => what);
}

/** Route handlers that read a request body as bytes, and why that is allowed. */
const BODY_ROUTES: Record<string, string> = {
  "src/app/api/ai/transcribe/route.ts": "dictation audio: DICTATION_LIMITS.maxBytes (4 MB) on both sides, never stored",
  "src/app/api/uploads/[uploadId]/route.ts": "the upload proxy (memory storage or the proxy lever): PROXY_MAX_BYTES_ON_VERCEL (4 MB) on Vercel",
};
const READS_BODY = /\b(req|request)\.(formData|arrayBuffer|blob)\(\)|\b(req|request)\.body\b/;

describe("BL-STAB-2f — files go to storage, not through server actions", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  it("no server action takes a file", () => {
    const found = files
      .map((f) => ({ file: rel(f), shapes: fileShapes(readFileSync(f, "utf8")) }))
      .filter((r) => r.shapes.length > 0);
    // Upload with uploadFile() and pass the upload id; see docs/ADMIN_MANUAL.md (Uploads).
    expect(found).toEqual([]);
  });

  it("would have caught the attach actions this replaced", () => {
    const before = `"use server";
export async function attachChatDocumentAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false };
  return attach(new Uint8Array(await file.arrayBuffer()));
}`;
    expect(fileShapes(before)).toEqual(["checks for a File or Blob", "reads bytes from a body"]);
    expect(fileShapes(`"use server";\nexport async function upload(files: File[]) {}`)).toEqual(["takes a File or Blob"]);
    // A form of text fields is fine, and so is a client file.
    expect(fileShapes(`"use server";\nexport async function save(form: FormData) { return String(form.get("note") ?? ""); }`)).toEqual([]);
    expect(fileShapes(`"use client";\nexport function pick(f: File) { return f.arrayBuffer(); }`)).toEqual([]);
  });

  it("only the listed route handlers read a body as a file, each under Vercel's request cap", () => {
    const routes = files.filter((f) => /\/route\.ts$/.test(f) && READS_BODY.test(withoutComments(readFileSync(f, "utf8"))));
    expect(routes.map(rel).sort()).toEqual(Object.keys(BODY_ROUTES).sort());
    const vercelCap = 4_500_000;
    expect(DICTATION_LIMITS.maxBytes).toBeLessThan(vercelCap - 64 * 1024);
    expect(PROXY_MAX_BYTES_ON_VERCEL).toBeLessThan(vercelCap - 64 * 1024);
  });
});
