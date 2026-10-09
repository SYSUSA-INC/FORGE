/**
 * BL-STAB-7a — SAM.gov failures in plain words (pure): every error shape is
 * read; no message carries HTML, a key or (for tenants) a variable name.
 */
import { describe, expect, it } from "vitest";
import {
  classifyFetchError,
  classifySamResponse,
  isKeyOrQuotaFailure,
  isSamHost,
  parseSamErrorBody,
  redactSamSecrets,
  samErrorMessage,
  type SamAudience,
  type SamErrorClass,
  type SamKeySource,
} from "@/lib/samgov-errors";

const OWNER_BODY = "<html><body><h1>API_KEY_INVALID</h1><p>An invalid api_key was supplied. Get one at https://api.data.gov:443</p></body></html>";

function message(status: number, body: string, source: SamKeySource = "platform", audience: SamAudience = "tenant", headers?: Headers) {
  const c = classifySamResponse(status, body, headers, Date.parse("2026-10-09T12:00:00Z"));
  return { ...c, text: samErrorMessage({ ...c, status, source, audience }) };
}

describe("BL-STAB-7a — SAM.gov error classes", () => {
  it("reads the owner's HTML 401 as a rejected shared key, in plain words", () => {
    const m = message(401, OWNER_BODY);
    expect(m.cls).toBe("key_invalid");
    expect(m.code).toBe("API_KEY_INVALID");
    expect(m.text).toBe(
      "SAM.gov rejected FORGE's shared SAM.gov key, which your company uses because it hasn't added its own. This has been logged for FORGE support. To keep working now, a company admin can add your company's own key under Settings → Integrations. (SAM.gov API_KEY_INVALID, HTTP 401)",
    );
  });

  it("reads the gateway's JSON and SAM.gov's own shape; the code wins over the status", () => {
    expect(message(403, JSON.stringify({ error: { code: "API_KEY_INVALID", message: "An invalid api_key was supplied." } })).cls).toBe("key_invalid");
    expect(message(403, JSON.stringify({ error: { code: "API_KEY_UNAUTHORIZED" } })).cls).toBe("key_forbidden");
    expect(message(401, "").cls).toBe("key_invalid");
    expect(message(403, "").cls).toBe("key_forbidden");
    const sce = message(400, JSON.stringify({ httpStatus: 400, detail: "Size Cannot Exceed 10 Records.", errorCode: "SCE", source: "entity-api" }));
    expect(sce.cls).toBe("bad_request");
    expect(sce.text).toBe("SAM.gov didn't accept the request: Size Cannot Exceed 10 Records (SAM.gov SCE, HTTP 400).");
    expect(message(400, "").text).toBe("SAM.gov didn't accept the request (HTTP 400). Check the search terms.");
  });

  it("words the request limit with the wait SAM.gov gives", () => {
    const m = message(429, "<h1>OVER_RATE_LIMIT</h1>", "platform", "tenant", new Headers({ "retry-after": "3600" }));
    expect(m.cls).toBe("rate_limited");
    expect(m.text).toContain("in about 60 minutes");
    expect(m.text).toContain("(SAM.gov OVER_RATE_LIMIT, HTTP 429)");
    expect(message(429, "", "platform", "tenant", new Headers({ "retry-after": "Fri, 09 Oct 2026 12:30:00 GMT" })).retryAfterSec).toBe(1800);
  });

  it("never echoes a 404, a 5xx page or an empty body", () => {
    expect(message(404, "<html>Not Found</html>").text).toBe("SAM.gov has no such record (HTTP 404).");
    expect(message(500, "").text).toBe("SAM.gov is having trouble right now (HTTP 500). Try again in a few minutes.");
    const nginx = message(502, "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1>nginx</body></html>");
    expect([nginx.cls, nginx.code, nginx.text.includes("nginx")]).toEqual(["upstream", null, false]);
  });

  it("reads only UPPER_SNAKE codes from a page heading", () => {
    expect(parseSamErrorBody("<h1>Hello world</h1>")).toEqual({ code: null, detail: null });
    expect(parseSamErrorBody("<h1>API_KEY_MISSING</h1>").code).toBe("API_KEY_MISSING");
    expect(parseSamErrorBody("not json, no heading")).toEqual({ code: null, detail: null });
  });

  it("tells a deadline from a network failure", () => {
    expect(classifyFetchError(new DOMException("aborted", "AbortError"))).toBe("timeout");
    expect(classifyFetchError(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
    expect(classifyFetchError(new TypeError("fetch failed"))).toBe("network");
    expect(samErrorMessage({ cls: "timeout", source: "platform", audience: "tenant", timeoutSec: 25 })).toBe(
      "SAM.gov didn't answer within 25 seconds. Try again in a few minutes.",
    );
    expect(isKeyOrQuotaFailure("rate_limited")).toBe(true);
    expect(isKeyOrQuotaFailure("upstream")).toBe(false);
    expect(isKeyOrQuotaFailure(undefined)).toBe(false);
  });

  it("names the company's key or, for platform admins, SAMGOV_API_KEY — and nothing else", () => {
    expect(message(401, OWNER_BODY, "company").text).toMatch(/^SAM\.gov rejected your company's SAM\.gov API key/);
    expect(message(401, OWNER_BODY, "platform", "operator").text).toContain("set SAMGOV_API_KEY in Vercel");
    expect(samErrorMessage({ cls: "missing_key", source: "platform", audience: "tenant" })).toBe("SAM.gov isn't connected for your company. A company admin can add your SAM.gov API key under Settings → Integrations.");
    const classes: SamErrorClass[] = ["missing_key", "key_invalid", "key_forbidden", "rate_limited", "bad_request", "not_found", "upstream", "timeout", "network", "bad_response", "foreign_host", "restricted", "key_unreadable"];
    for (const cls of classes) {
      for (const source of ["company", "platform"] as const) {
        const detail = "<script>x</script>".repeat(40);
        const tenant = samErrorMessage({ cls, source, audience: "tenant", status: 418, code: "API_KEY_INVALID", detail, retryAfterSec: 90, timeoutSec: 20 });
        expect(tenant.length).toBeLessThanOrEqual(300);
        expect(tenant).not.toMatch(/[<>]/);
        expect(tenant).not.toContain("SAMGOV_API_KEY");
        const operator = samErrorMessage({ cls, source, audience: "operator", status: 418, detail });
        expect(operator).not.toMatch(/[<>]/);
      }
    }
  });
});

describe("BL-STAB-7a — the key goes only to SAM.gov", () => {
  it("accepts only https on api.sam.gov or sam.gov", () => {
    expect(isSamHost(new URL("https://api.sam.gov/x"))).toBe(true);
    expect(isSamHost(new URL("https://sam.gov/api/prod/opps/v3/opportunities/resources/files/1/download"))).toBe(true);
    for (const bad of [
      "http://api.sam.gov/x",
      "https://api.sam.gov.evil.example/x",
      "https://api.sam.gov@evil.example/x",
      "https://user:pw@api.sam.gov/x",
      "https://evil.example/?h=api.sam.gov",
      "https://api.sam.gov:8443/x",
      "https://beta.sam.gov/x",
    ]) {
      expect(isSamHost(new URL(bad)), bad).toBe(false);
    }
  });

  it("redacts api_key values and the key itself, whatever characters it has", () => {
    expect(redactSamSecrets("https://sam.gov/x?api_key=SECRET123&a=1")).toBe("https://sam.gov/x?api_key=…&a=1");
    expect(redactSamSecrets("key a+b.c*d(e) was rejected", ["a+b.c*d(e)"])).toBe("key … was rejected");
  });
});
