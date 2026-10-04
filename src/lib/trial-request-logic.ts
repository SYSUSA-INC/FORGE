/**
 * BL-AUTH-ABUSE Slice 2b — what a Request-a-trial submission must look
 * like. Decisions (2026-10-04): company email only — personal mailboxes
 * (Gmail, Outlook, Yahoo …) and throwaway inboxes are refused; the name
 * follows the sign-up name rules. No I/O; tested in
 * tests/ai/trial-request-logic.test.ts.
 */

import { isDisposableEmailDomain, validatePersonName } from "@/lib/account-hygiene-logic";
import { domainOf, isPublicEmailDomain } from "@/lib/email-domain";

export const TRIAL_REQUEST_LIMITS = { companyMin: 2, companyMax: 120, titleMax: 80, messageMax: 1000, declineReasonMax: 300 } as const;

export type TrialRequestInput = {
  name: string;
  email: string;
  emailDomain: string;
  company: string;
  jobTitle: string;
  message: string;
};

export type TrialRequestField = "name" | "email" | "company" | "jobTitle" | "message";

function clean(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // Collapse whitespace, drop control characters (keep newlines in the message).
  return raw.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

/** Validate a submission; the first problem wins, with the field it belongs to. */
export function validateTrialRequest(raw: unknown):
  | { ok: true; value: TrialRequestInput }
  | { ok: false; field: TrialRequestField; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const name = validatePersonName(r.name);
  if (!name.ok) return { ok: false, field: "name", error: name.error };

  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, field: "email", error: "Enter a valid email address." };
  }
  const emailDomain = domainOf(email);
  if (!emailDomain) return { ok: false, field: "email", error: "Enter a valid email address." };
  if (isDisposableEmailDomain(emailDomain)) {
    return { ok: false, field: "email", error: "Use your company email — disposable inboxes can't start a trial." };
  }
  if (isPublicEmailDomain(emailDomain)) {
    return { ok: false, field: "email", error: "Use your company email — personal mailboxes such as Gmail, Outlook or Yahoo can't start a trial." };
  }

  const company = clean(r.company, TRIAL_REQUEST_LIMITS.companyMax + 1);
  if (company.length < TRIAL_REQUEST_LIMITS.companyMin || company.length > TRIAL_REQUEST_LIMITS.companyMax) {
    return { ok: false, field: "company", error: `Company name: ${TRIAL_REQUEST_LIMITS.companyMin}–${TRIAL_REQUEST_LIMITS.companyMax} characters.` };
  }
  if (/:\/\/|www\.|@/i.test(company)) {
    return { ok: false, field: "company", error: "Enter your company's name, not a link or address." };
  }

  const jobTitle = clean(r.jobTitle, TRIAL_REQUEST_LIMITS.titleMax + 1);
  if (jobTitle.length > TRIAL_REQUEST_LIMITS.titleMax) {
    return { ok: false, field: "jobTitle", error: `Job title: ${TRIAL_REQUEST_LIMITS.titleMax} characters at most.` };
  }

  const message = typeof r.message === "string" ? r.message.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim() : "";
  if (message.length > TRIAL_REQUEST_LIMITS.messageMax) {
    return { ok: false, field: "message", error: `Message: ${TRIAL_REQUEST_LIMITS.messageMax} characters at most.` };
  }

  return { ok: true, value: { name: name.name, email, emailDomain, company, jobTitle, message } };
}

/** The workspace name an approved request starts with. */
export function trialWorkspaceName(company: string): string {
  return company.trim().slice(0, 128);
}
