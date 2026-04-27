/**
 * FORGE PDF gateway.
 *
 * Provider-agnostic interface for rendering an HTML doc to PDF bytes.
 * Active provider is selected by the PDF_PROVIDER env var (browserless
 * / stub). Falls back to "stub" when no provider is configured, so
 * dev and preview always work without credentials.
 *
 * Stub mode returns the input HTML as-is (with content_type=html), so
 * the user can still download the rendered output, inspect template
 * styling, and validate the integration before flipping to live PDFs.
 */

export type PdfRenderResult = {
  bytes: Uint8Array;
  contentType: "application/pdf" | "text/html";
  pageCount: number;
  provider: PdfProviderName;
  stubbed: boolean;
};

export type PdfProviderName = "browserless" | "stub";

export type PdfProviderStatus = {
  name: PdfProviderName;
  configured: boolean;
  reason: string;
};

export interface PdfProvider {
  readonly name: PdfProviderName;
  render(html: string): Promise<PdfRenderResult>;
}

class BrowserlessProvider implements PdfProvider {
  readonly name = "browserless" as const;
  constructor(
    private apiKey: string,
    private baseUrl: string = "https://chrome.browserless.io",
  ) {}

  async render(html: string): Promise<PdfRenderResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/pdf?token=${encodeURIComponent(
      this.apiKey,
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html,
        options: {
          format: "Letter",
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
        },
        gotoOptions: { waitUntil: "networkidle0" },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browserless ${res.status}: ${body.slice(0, 300)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // Browserless doesn't expose page count in the response headers reliably.
    // Caller can compute it from the PDF later; for v1 we leave it 0.
    return {
      bytes: buf,
      contentType: "application/pdf",
      pageCount: 0,
      provider: this.name,
      stubbed: false,
    };
  }
}

class StubProvider implements PdfProvider {
  readonly name = "stub" as const;
  constructor(private reason: string) {}

  async render(html: string): Promise<PdfRenderResult> {
    const banner = `<!--
FORGE PDF stub mode
${this.reason}
The HTML below is the document the live PDF renderer would have
produced. Set BROWSERLESS_API_KEY (and PDF_PROVIDER=browserless) on
Vercel to flip to real PDFs.
-->\n`;
    const text = banner + html;
    const bytes = new TextEncoder().encode(text);
    return {
      bytes,
      contentType: "text/html",
      pageCount: 0,
      provider: this.name,
      stubbed: true,
    };
  }
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v : null;
}

function statusFor(name: PdfProviderName): PdfProviderStatus {
  switch (name) {
    case "browserless": {
      const key = readEnv("BROWSERLESS_API_KEY");
      return key
        ? { name, configured: true, reason: "BROWSERLESS_API_KEY present" }
        : { name, configured: false, reason: "BROWSERLESS_API_KEY not set" };
    }
    case "stub":
      return { name, configured: true, reason: "Stub is always available" };
  }
}

export function getPdfProviderStatus(): {
  active: PdfProviderStatus;
  all: PdfProviderStatus[];
} {
  const requested = (readEnv("PDF_PROVIDER") ?? "browserless").toLowerCase();
  const all: PdfProviderStatus[] = [statusFor("browserless")];
  const requestedStatus = all.find((s) => s.name === requested);

  let active: PdfProviderStatus;
  if (requested === "stub") {
    active = { name: "stub", configured: true, reason: "Stub explicitly selected" };
  } else if (requestedStatus?.configured) {
    active = requestedStatus;
  } else {
    active = {
      name: "stub",
      configured: true,
      reason: requestedStatus
        ? `Falling back: ${requestedStatus.reason}`
        : `Unknown PDF_PROVIDER="${requested}", falling back to stub`,
    };
  }
  return { active, all };
}

export function getPdfProvider(): PdfProvider {
  const { active } = getPdfProviderStatus();
  switch (active.name) {
    case "browserless":
      return new BrowserlessProvider(
        readEnv("BROWSERLESS_API_KEY")!,
        readEnv("BROWSERLESS_BASE_URL") ?? "https://chrome.browserless.io",
      );
    case "stub":
    default:
      return new StubProvider(active.reason);
  }
}
