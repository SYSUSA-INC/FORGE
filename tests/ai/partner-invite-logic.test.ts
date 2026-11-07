/**
 * BL-NAV-LIFECYCLE 3c — the partner's side of the matrix, pure: what a
 * partner is shown (never our references), how its answers and
 * certifications are checked, and how an invite's state reads.
 */
import { describe, expect, it } from "vitest";
import {
  PARTNER_INVITE_DAYS,
  certificationLabels,
  inviteState,
  normalizeCertifications,
  normalizeInviteEmail,
  normalizePartnerAnswers,
  partnerAnswerSummary,
  partnerInviteExpiry,
  partnerQuestionsOf,
} from "@/lib/partner-invite-logic";

const now = new Date("2026-11-07T12:00:00Z");
const questions = [
  { id: "q1", text: "Operate a 24x7 SOC", refs: ["L.4.2", "PWS 3.1"], kind: "shall" as const, area: "Security" },
  { id: "s5", text: "Certifications", refs: [], kind: "standing" as const, area: "Standing" },
];

describe("BL-NAV-LIFECYCLE 3c — partner invite logic", () => {
  it("shows the partner the question text, kind and area, never our requirement references", () => {
    const shown = partnerQuestionsOf(questions);
    expect(shown).toEqual([
      { id: "q1", text: "Operate a 24x7 SOC", kind: "shall", area: "Security" },
      { id: "s5", text: "Certifications", kind: "standing", area: "Standing" },
    ]);
    expect(JSON.stringify(shown)).not.toContain("L.4.2");
  });

  it("keeps valid answers to known questions only, clamps the partial share and trims evidence", () => {
    const out = normalizePartnerAnswers(
      {
        q1: { answer: "partial", percent: 103, evidence: "  SOC in Reston  " },
        s5: { answer: "yes", percent: 40, evidence: "x".repeat(2_000) },
        zz: { answer: "no", evidence: "unknown question" },
        bad: { answer: "maybe" },
      },
      ["q1", "s5", "bad"],
      now,
    );
    expect(Object.keys(out)).toEqual(["q1", "s5"]);
    expect(out.q1).toEqual({ answer: "partial", percent: 95, evidence: "SOC in Reston", updatedAt: now.toISOString() });
    expect(out.s5!.percent).toBeNull();
    expect(out.s5!.evidence).toHaveLength(1_000);
    expect(normalizePartnerAnswers("nope", ["q1"], now)).toEqual({});
  });

  it("normalises certifications and labels them", () => {
    const c = normalizeCertifications({ iso: ["ISO 9001", "ISO 9001", " ISO 27001 ", 7], cmmiLevel: "3", cmmiModel: "DEV", cmmcLevel: 9, other: " FedRAMP Moderate " });
    expect(c).toEqual({ iso: ["ISO 9001", "ISO 27001"], cmmiLevel: 3, cmmiModel: "DEV", other: "FedRAMP Moderate" });
    expect(certificationLabels(c)).toEqual(["ISO 9001", "ISO 27001", "CMMI-DEV ML3", "FedRAMP Moderate"]);
    expect(normalizeCertifications({ cmmcLevel: 2, cmmiModel: "SVC" })).toEqual({ cmmcLevel: 2 });
    expect(certificationLabels({ cmmcLevel: 2 })).toEqual(["CMMC L2"]);
    expect(certificationLabels(null)).toEqual([]);
    expect(normalizeCertifications(null)).toEqual({});
  });

  it("summarises answers per value", () => {
    const answers = normalizePartnerAnswers({ q1: { answer: "no" } }, ["q1", "s5"], now);
    expect(partnerAnswerSummary(questions, answers)).toEqual({ total: 2, answered: 1, yes: 0, partial: 0, no: 1 });
  });

  it("an invite lives 14 days, stays editable after submission, and expires", () => {
    const expiresAt = partnerInviteExpiry(now);
    expect((expiresAt.getTime() - now.getTime()) / 86_400_000).toBe(PARTNER_INVITE_DAYS);
    expect(inviteState({ expiresAt, submittedAt: null }, now)).toBe("open");
    expect(inviteState({ expiresAt, submittedAt: now }, now)).toBe("submitted");
    expect(inviteState({ expiresAt: expiresAt.toISOString(), submittedAt: now }, expiresAt)).toBe("expired");
  });

  it("accepts a plain address, lower-cased, and nothing else", () => {
    expect(normalizeInviteEmail("  Pat@Partner.COM ")).toBe("pat@partner.com");
    expect(normalizeInviteEmail("not an email")).toBeNull();
    expect(normalizeInviteEmail(42)).toBeNull();
  });
});
