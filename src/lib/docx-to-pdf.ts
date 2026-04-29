/**
 * DOCX → PDF conversion gateway.
 *
 * Provider-agnostic: callers pass .docx bytes and get .pdf bytes back.
 * Active provider is selected by DOCX_PDF_PROVIDER env var:
 *   cloudconvert (default)  — uses CloudConvert's sync convert API
 *   stub                    — returns the input bytes unchanged with
 *                             a "stub" marker so the UI flow works
 *                             without paid credentials.
 *
 * Why CloudConvert over LibreOffice / Browserless:
 *   - LibreOffice headless is heavy (200MB+ Docker layer) and won't
 *     fit in a Vercel function's 50MB unzipped cap.
 *   - Browserless can render HTML→PDF but doesn't natively render
 *     .docx files; it would lose Word's header/footer/cover/TOC
 *     fidelity that the user specifically asked for.
 *   - CloudConvert renders Word natively (it backs onto LibreOffice
 *     server-side) at ~$0.01-0.02 per conversion. Pay-as-you-go.
 */

export type DocxToPdfProviderName = "cloudconvert" | "stub";

export type DocxToPdfResult = {
  bytes: Uint8Array;
  contentType: string; // "application/pdf" or "...docx" in stub mode
  pageCount?: number;
  provider: DocxToPdfProviderName;
  stubbed: boolean;
};

export type DocxToPdfProvider = {
  readonly name: DocxToPdfProviderName;
  convert(input: { docxBytes: Uint8Array; fileName: string }): Promise<DocxToPdfResult>;
};

export type DocxToPdfProviderStatus = {
  name: DocxToPdfProviderName;
  configured: boolean;
  reason: string;
};

class CloudConvertProvider implements DocxToPdfProvider {
  readonly name = "cloudconvert" as const;
  constructor(private apiKey: string) {}

  /**
   * CloudConvert flow:
   *   1. POST /jobs with three tasks: import-upload → convert → export-url
   *   2. Upload bytes to the import task's signed-form URL
   *   3. Poll /jobs/<id> until export-url task is `finished`
   *   4. GET the export task's file URL → PDF bytes
   */
  async convert(input: { docxBytes: Uint8Array; fileName: string }) {
    const created = await this.fetchJson("/jobs", {
      method: "POST",
      body: JSON.stringify({
        tasks: {
          "forge-import": { operation: "import/upload" },
          "forge-convert": {
            operation: "convert",
            input: ["forge-import"],
            input_format: "docx",
            output_format: "pdf",
            engine: "office", // LibreOffice on CC's side; preserves header/footer/TOC
          },
          "forge-export": {
            operation: "export/url",
            input: ["forge-convert"],
            inline: false,
            archive_multiple_files: false,
          },
        },
        tag: "forge-proposal-pdf",
      }),
    });

    const jobId = (created as { data?: { id?: string } }).data?.id;
    const tasks = (
      created as {
        data?: {
          tasks?: {
            id: string;
            name: string;
            operation: string;
            result?: { form?: { url: string; parameters?: Record<string, string> } };
          }[];
        };
      }
    ).data?.tasks;
    if (!jobId || !tasks) {
      throw new Error("CloudConvert: malformed job response");
    }
    const importTask = tasks.find((t) => t.name === "forge-import");
    const importForm = importTask?.result?.form;
    if (!importForm) {
      throw new Error("CloudConvert: no upload form returned");
    }

    // Step 2 — multipart upload to the signed form.
    const formData = new FormData();
    for (const [k, v] of Object.entries(importForm.parameters ?? {})) {
      formData.append(k, v);
    }
    const blob = new Blob([new Uint8Array(input.docxBytes)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    formData.append("file", blob, input.fileName || "input.docx");
    const uploadRes = await fetch(importForm.url, {
      method: "POST",
      body: formData,
    });
    if (!uploadRes.ok && uploadRes.status !== 201) {
      const body = await uploadRes.text();
      throw new Error(
        `CloudConvert upload failed (${uploadRes.status}): ${body.slice(0, 200)}`,
      );
    }

    // Step 3 — poll the job until export task finishes.
    const exportTaskId = await this.pollUntilFinished(jobId);
    if (!exportTaskId) {
      throw new Error("CloudConvert: export task did not finish in time");
    }
    const exportTask = await this.fetchJson(`/tasks/${exportTaskId}?include=files`);
    const file = (
      exportTask as {
        data?: { result?: { files?: { url: string; size?: number }[] } };
      }
    ).data?.result?.files?.[0];
    if (!file?.url) {
      throw new Error("CloudConvert: export task produced no file");
    }

    // Step 4 — fetch the PDF bytes.
    const pdfRes = await fetch(file.url);
    if (!pdfRes.ok) {
      throw new Error(
        `CloudConvert: could not download PDF (${pdfRes.status})`,
      );
    }
    const buf = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buf);

    return {
      bytes,
      contentType: "application/pdf",
      provider: this.name,
      stubbed: false,
    };
  }

  private async fetchJson(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://api.cloudconvert.com/v2${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `CloudConvert ${res.status} ${path}: ${body.slice(0, 240)}`,
      );
    }
    return res.json();
  }

  /**
   * Poll the job every 1.5s for up to ~45s. Most LibreOffice docx→pdf
   * conversions finish in under 5 seconds. Returns the export task id
   * when finished; throws on error; returns null on timeout.
   */
  private async pollUntilFinished(jobId: string): Promise<string | null> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const job = (await this.fetchJson(`/jobs/${jobId}`)) as {
        data?: {
          status: string;
          tasks?: { id: string; name: string; status: string; message?: string }[];
        };
      };
      const status = job.data?.status;
      if (status === "error") {
        const failed = job.data?.tasks?.find((t) => t.status === "error");
        throw new Error(
          `CloudConvert job error${failed ? `: ${failed.message ?? failed.name}` : ""}`,
        );
      }
      if (status === "finished") {
        const exportTask = job.data?.tasks?.find(
          (t) => t.name === "forge-export",
        );
        return exportTask?.id ?? null;
      }
      await sleep(1500);
    }
    return null;
  }
}

class StubProvider implements DocxToPdfProvider {
  readonly name = "stub" as const;
  async convert(input: { docxBytes: Uint8Array; fileName: string }) {
    // Stub mode — return the docx bytes unchanged. The caller knows
    // (via stubbed: true) to label the download as docx, not pdf.
    return {
      bytes: input.docxBytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      provider: this.name,
      stubbed: true,
    };
  }
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v : null;
}

export function getDocxToPdfProviderStatus(): {
  active: DocxToPdfProviderStatus;
  all: DocxToPdfProviderStatus[];
} {
  const requested = (readEnv("DOCX_PDF_PROVIDER") ?? "cloudconvert").toLowerCase();
  const ccKey = readEnv("CLOUDCONVERT_API_KEY");
  const all: DocxToPdfProviderStatus[] = [
    {
      name: "cloudconvert",
      configured: !!ccKey,
      reason: ccKey
        ? "CLOUDCONVERT_API_KEY present"
        : "CLOUDCONVERT_API_KEY not set",
    },
    { name: "stub", configured: true, reason: "Stub is always available" },
  ];
  let active: DocxToPdfProviderStatus;
  if (requested === "stub") {
    active = { name: "stub", configured: true, reason: "Stub explicitly selected" };
  } else if (requested === "cloudconvert" && ccKey) {
    active = all[0]!;
  } else {
    active = {
      name: "stub",
      configured: true,
      reason: ccKey
        ? `Unknown DOCX_PDF_PROVIDER="${requested}", falling back to stub`
        : "Falling back: CLOUDCONVERT_API_KEY not set",
    };
  }
  return { active, all };
}

export function getDocxToPdfProvider(): DocxToPdfProvider {
  const { active } = getDocxToPdfProviderStatus();
  if (active.name === "cloudconvert") {
    return new CloudConvertProvider(readEnv("CLOUDCONVERT_API_KEY")!);
  }
  return new StubProvider();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
