/**
 * BL-AUTH-ABUSE Slice 2b — what a Request-a-trial submission must look
 * like: a person's name, a company email (no personal or throwaway
 * mailbox), a company name.
 */

import { describe, expect, it } from "vitest";
import { trialWorkspaceName, validateTrialRequest } from "@/lib/trial-request-logic";

const good = { name: "Ana Rivera", email: "Ana.Rivera@AcmeGov.com ", company: "  Acme   Gov Solutions ", jobTitle: "Capture lead", message: "We bid on NAVSEA work." };

describe("validateTrialRequest", () => {
  it("accepts and normalises a company request", () => {
    expect(validateTrialRequest(good)).toEqual({
      ok: true,
      value: { name: "Ana Rivera", email: "ana.rivera@acmegov.com", emailDomain: "acmegov.com", company: "Acme Gov Solutions", jobTitle: "Capture lead", message: "We bid on NAVSEA work." },
    });
    expect(validateTrialRequest({ ...good, jobTitle: undefined, message: undefined })).toMatchObject({ ok: true, value: { jobTitle: "", message: "" } });
  });

  it("refuses personal and throwaway mailboxes", () => {
    expect(validateTrialRequest({ ...good, email: "ana@gmail.com" })).toMatchObject({ ok: false, field: "email", error: expect.stringMatching(/personal mailboxes/) });
    expect(validateTrialRequest({ ...good, email: "ana@outlook.com" })).toMatchObject({ ok: false, field: "email" });
    expect(validateTrialRequest({ ...good, email: "ana@mailinator.com" })).toMatchObject({ ok: false, field: "email", error: expect.stringMatching(/disposable/) });
    expect(validateTrialRequest({ ...good, email: "not-an-email" })).toMatchObject({ ok: false, field: "email" });
  });

  it("applies the name rules and checks the company", () => {
    expect(validateTrialRequest({ ...good, name: "xKjQwPzLm" })).toMatchObject({ ok: false, field: "name" });
    expect(validateTrialRequest({ ...good, company: "A" })).toMatchObject({ ok: false, field: "company" });
    expect(validateTrialRequest({ ...good, company: "https://spam.example" })).toMatchObject({ ok: false, field: "company" });
    expect(validateTrialRequest({ ...good, company: "x".repeat(121) })).toMatchObject({ ok: false, field: "company" });
    expect(validateTrialRequest({ ...good, jobTitle: "x".repeat(81) })).toMatchObject({ ok: false, field: "jobTitle" });
    expect(validateTrialRequest({ ...good, message: "x".repeat(1001) })).toMatchObject({ ok: false, field: "message" });
    expect(validateTrialRequest(null)).toMatchObject({ ok: false, field: "name" });
  });

  it("names the workspace after the company", () => {
    expect(trialWorkspaceName("  Acme Gov Solutions ")).toBe("Acme Gov Solutions");
  });
});
