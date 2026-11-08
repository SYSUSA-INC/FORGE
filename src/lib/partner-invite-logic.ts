/**
 * BL-NAV-LIFECYCLE phase 3c — a partner's side of the capability matrix,
 * pure (no DB, no network): what the partner is shown, how its answers
 * and certifications are checked and stored, and how an invite's state
 * reads. The store and the actions drive the rows.
 */

import { CAPABILITY_EVIDENCE_MAX, clampPartialPercent, type CapabilityQuestion, type CapabilityQuestionKind } from "@/lib/capability-matrix-types";

/** An invite link lives this long (design §2.4). */
export const PARTNER_INVITE_DAYS = 14;
export const PARTNER_INVITE_MS = PARTNER_INVITE_DAYS * 24 * 60 * 60 * 1000;

/** What a partner answers: yes, partial (with the share it covers), or no. */
export const PARTNER_ANSWER_VALUES = ["yes", "partial", "no"] as const;
export type PartnerAnswerValue = (typeof PARTNER_ANSWER_VALUES)[number];
export const PARTNER_ANSWER_LABELS: Record<PartnerAnswerValue, string> = { yes: "Yes", partial: "Partial", no: "No" };

export type PartnerAnswer = {
  answer: PartnerAnswerValue;
  /** 5..95, only for partial. */
  percent: number | null;
  evidence: string;
  updatedAt: string;
};
export type PartnerAnswers = Record<string, PartnerAnswer>;

/**
 * The partner's certifications. ISO standards by name, one CMMI level
 * (with its model) and one CMMC level; anything else in words.
 */
export type PartnerCertifications = {
  iso?: string[];
  cmmiLevel?: number | null;
  cmmiModel?: "DEV" | "SVC" | null;
  cmmcLevel?: number | null;
  other?: string;
};
export const ISO_STANDARDS = ["ISO 9001", "ISO 27001", "ISO 20000-1", "ISO 14001", "ISO 45001"] as const;
export const CMMI_LEVELS = [1, 2, 3, 4, 5] as const;
export const CMMC_LEVELS = [1, 2, 3] as const;
export const CERT_OTHER_MAX = 300;

/** The question as a partner sees it: the text, its weight and area, never our references or notes (owner decision 3). */
export type PartnerQuestion = { id: string; text: string; kind: CapabilityQuestionKind; area: string };

export function partnerQuestionsOf(questions: CapabilityQuestion[]): PartnerQuestion[] {
  return questions.map((q) => ({ id: q.id, text: q.text, kind: q.kind, area: q.area }));
}

/** A valid answer from a partner's form, or null when it is not one. */
export function normalizePartnerAnswer(raw: unknown, now: Date): PartnerAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const answer = PARTNER_ANSWER_VALUES.find((v) => v === r.answer);
  if (!answer) return null;
  const evidence = typeof r.evidence === "string" ? r.evidence.trim().slice(0, CAPABILITY_EVIDENCE_MAX) : "";
  const percent = answer === "partial" ? clampPartialPercent(typeof r.percent === "number" ? r.percent : Number(r.percent)) : null;
  return { answer, percent, evidence, updatedAt: now.toISOString() };
}

/** Only answers to questions the matrix has, each checked. */
export function normalizePartnerAnswers(raw: unknown, questionIds: string[], now: Date): PartnerAnswers {
  const out: PartnerAnswers = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const id of questionIds) {
    const a = normalizePartnerAnswer(r[id], now);
    if (a) out[id] = a;
  }
  return out;
}

export function normalizeCertifications(raw: unknown): PartnerCertifications {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const iso = Array.isArray(r.iso) ? r.iso.filter((s): s is string => typeof s === "string").map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 10) : [];
  const cmmiLevel = CMMI_LEVELS.find((l) => l === Number(r.cmmiLevel)) ?? null;
  const cmmiModel = r.cmmiModel === "DEV" || r.cmmiModel === "SVC" ? r.cmmiModel : null;
  const cmmcLevel = CMMC_LEVELS.find((l) => l === Number(r.cmmcLevel)) ?? null;
  const other = typeof r.other === "string" ? r.other.trim().slice(0, CERT_OTHER_MAX) : "";
  const out: PartnerCertifications = {};
  if (iso.length) out.iso = Array.from(new Set(iso));
  if (cmmiLevel) {
    out.cmmiLevel = cmmiLevel;
    out.cmmiModel = cmmiModel;
  }
  if (cmmcLevel) out.cmmcLevel = cmmcLevel;
  if (other) out.other = other;
  return out;
}

/** "ISO 9001 · CMMI-DEV ML3 · CMMC L2 · FedRAMP Moderate" */
export function certificationLabels(c: PartnerCertifications | null | undefined): string[] {
  if (!c) return [];
  const out: string[] = [...(c.iso ?? [])];
  if (c.cmmiLevel) out.push(`CMMI${c.cmmiModel ? `-${c.cmmiModel}` : ""} ML${c.cmmiLevel}`);
  if (c.cmmcLevel) out.push(`CMMC L${c.cmmcLevel}`);
  if (c.other) out.push(c.other);
  return out;
}

export type PartnerAnswerSummary = { total: number; answered: number; yes: number; partial: number; no: number };

export function partnerAnswerSummary(questions: { id: string }[], answers: PartnerAnswers): PartnerAnswerSummary {
  const s: PartnerAnswerSummary = { total: questions.length, answered: 0, yes: 0, partial: 0, no: 0 };
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    s.answered += 1;
    s[a.answer] += 1;
  }
  return s;
}

export type InviteState = "open" | "submitted" | "expired";

/** An invite stays editable after submission until it expires. */
export function inviteState(i: { expiresAt: Date | string; submittedAt: Date | string | null }, now: Date): InviteState {
  if (new Date(i.expiresAt).getTime() <= now.getTime()) return "expired";
  return i.submittedAt ? "submitted" : "open";
}

export function partnerInviteExpiry(now: Date): Date {
  return new Date(now.getTime() + PARTNER_INVITE_MS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A usable invite address, lower-cased, or null. */
export function normalizeInviteEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

// ── the sweep of expired invites (3c-3) ──────────────────────────────

/** An invite as the sweep sees it: whose it is, when it expires, whether it was answered, and whether its link still works. */
export type SweepInvite = { id: string; partnerId: string; expiresAt: Date | string; submittedAt: Date | string | null; tokenHash: string | null };

export type InviteSweepPlan = {
  /** Expired invites whose link still works: the token hash is cleared so the link can never be used again. */
  clear: string[];
  /** Partners shown as *invited* whose only links expired unanswered: they go back to *candidate*. */
  revert: string[];
};

/**
 * What the daily sweep does with a partner's invites: retire every expired
 * link (submitted or not: a submitted link stayed editable only until it
 * expired), and send an *invited* partner back to *candidate* when it has
 * no live link left and the one that expired was never submitted. A
 * partner that answered stays *answered*; a chosen or declined one is not
 * touched.
 */
export function planInviteSweep(invites: readonly SweepInvite[], partners: readonly { id: string; status: string }[], now: Date): InviteSweepPlan {
  const clear: string[] = [];
  const live = new Set<string>();
  const expiredUnanswered = new Set<string>();
  for (const i of invites) {
    const expired = inviteState(i, now) === "expired";
    if (!expired) {
      live.add(i.partnerId);
      continue;
    }
    if (i.tokenHash !== null) clear.push(i.id);
    if (!i.submittedAt) expiredUnanswered.add(i.partnerId);
  }
  const revert = partners.filter((p) => p.status === "invited" && expiredUnanswered.has(p.id) && !live.has(p.id)).map((p) => p.id);
  return { clear, revert };
}
