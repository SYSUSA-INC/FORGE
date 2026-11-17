/**
 * BL-NAV-LIFECYCLE 6a — Deliver's rules (src/lib/deliver-logic.ts): the
 * sign-off of one colour, the whole gate, who submits and who overrides,
 * and the inputs of Record submission.
 */

import { describe, expect, it } from "vitest";
import {
  canOverride,
  canSubmit,
  colourSignoff,
  parseRecipients,
  parseSentAt,
  SIGNOFF_COLORS,
  signoffGate,
  signoffLine,
  snapshotOf,
  submissionFileName,
  type SignoffRound,
} from "@/lib/deliver-logic";

const round = (over: Partial<SignoffRound>): SignoffRound => ({
  id: "r1",
  color: "pink",
  status: "complete",
  verdict: "pass",
  createdAt: "2026-11-01T00:00:00Z",
  reviewers: [{ verdict: "pass", submitted: true }],
  ...over,
});

const allPassed = (): SignoffRound[] => SIGNOFF_COLORS.map((color, i) => round({ id: `r${i}`, color }));

describe("colourSignoff", () => {
  it("is not run with no round of that colour", () => {
    const s = colourSignoff("green", [round({ color: "pink" })]);
    expect(s.state).toBe("not_run");
    expect(s.reason).toBe("Green has not been run.");
  });

  it("signs off a passed round whose reviewers all signed, a conditional verdict from a reviewer included", () => {
    const s = colourSignoff("pink", [round({ reviewers: [{ verdict: "pass", submitted: true }, { verdict: "conditional", submitted: true }] })]);
    expect(s).toMatchObject({ state: "signed_off", reason: "", reviewersSigned: 2, reviewersTotal: 2 });
  });

  it("stays open while the round is open, conditional, failed or without a verdict", () => {
    expect(colourSignoff("pink", [round({ status: "in_progress", verdict: null })]).reason).toBe("Pink is not closed.");
    expect(colourSignoff("pink", [round({ verdict: "conditional" })]).reason).toContain("with conditions");
    expect(colourSignoff("pink", [round({ verdict: "fail" })]).reason).toBe("Pink closed with a fail.");
    expect(colourSignoff("pink", [round({ verdict: null })]).reason).toBe("Pink closed with no verdict.");
  });

  it("stays open when a reviewer has not signed or gave a fail", () => {
    const waiting = colourSignoff("pink", [round({ reviewers: [{ verdict: "pass", submitted: true }, { verdict: null, submitted: false }] })]);
    expect(waiting.state).toBe("open");
    expect(waiting.reason).toBe("Pink: 1 of 2 reviewers have not signed off.");
    const failed = colourSignoff("pink", [round({ reviewers: [{ verdict: "fail", submitted: true }] })]);
    expect(failed.reason).toBe("Pink: 1 reviewer gave a fail.");
  });

  it("reads the newest round of the colour only", () => {
    const rounds = [round({ id: "old", verdict: "fail", createdAt: "2026-10-01T00:00:00Z" }), round({ id: "new", createdAt: "2026-11-02T00:00:00Z" })];
    expect(colourSignoff("pink", rounds)).toMatchObject({ state: "signed_off", roundId: "new" });
    const reopened = [round({ id: "old", createdAt: "2026-10-01T00:00:00Z" }), round({ id: "new", status: "in_progress", verdict: null, createdAt: "2026-11-02T00:00:00Z" })];
    expect(colourSignoff("pink", reopened).state).toBe("open");
  });

  it("ignores a cancelled round", () => {
    const rounds = [round({ id: "old", createdAt: "2026-10-01T00:00:00Z" }), round({ id: "new", status: "cancelled", verdict: null, createdAt: "2026-11-02T00:00:00Z" })];
    expect(colourSignoff("pink", rounds)).toMatchObject({ state: "signed_off", roundId: "old" });
    expect(colourSignoff("pink", [round({ status: "cancelled" })]).state).toBe("not_run");
  });

  it("signs off a passed round with no reviewers assigned", () => {
    expect(colourSignoff("pink", [round({ reviewers: [] })]).state).toBe("signed_off");
  });
});

describe("signoffGate", () => {
  it("is clear with five colours signed off, the pack ticked and the export gate clean", () => {
    const g = signoffGate({ rounds: allPassed(), submissionPackTicked: true, exportBlocked: false });
    expect(g.clear).toBe(true);
    expect(g.blockers).toEqual([]);
    expect(signoffLine(g)).toBe("5 of 5 colour teams signed off");
    expect(snapshotOf(g)).toEqual({ colors: g.colors, submissionPack: true, exportClean: true, clear: true });
  });

  it("lists every blocker: a colour not run, the pack and the export gate", () => {
    const rounds = allPassed().filter((r) => r.color !== "green");
    const g = signoffGate({ rounds, submissionPackTicked: false, exportBlocked: true });
    expect(g.clear).toBe(false);
    expect(g.signedOff).toBe(4);
    expect(g.blockers).toHaveLength(3);
    expect(g.blockers[0]).toBe("Green has not been run.");
    expect(g.blockers[1]).toContain("ready for submission");
    expect(g.blockers[2]).toContain("export gate");
  });
});

describe("who may submit and override", () => {
  const leads = { proposalManagerUserId: "pm", captureManagerUserId: "cm" };
  const user = (id: string, role: string | null = "member", isSuperadmin = false) => ({ id, role, isSuperadmin });

  it("lets org admins, the proposal manager and the capture manager submit", () => {
    expect(canSubmit(user("x", "admin"), leads)).toBe(true);
    expect(canSubmit(user("pm"), leads)).toBe(true);
    expect(canSubmit(user("cm"), leads)).toBe(true);
    expect(canSubmit(user("x"), leads)).toBe(false);
    expect(canSubmit(user("x"), { proposalManagerUserId: null, captureManagerUserId: null })).toBe(false);
  });

  it("lets only an org admin or the proposal manager override", () => {
    expect(canOverride(user("x", "admin"), leads)).toBe(true);
    expect(canOverride(user("pm"), leads)).toBe(true);
    expect(canOverride(user("cm"), leads)).toBe(false);
    expect(canOverride(user("x", "member", true), leads)).toBe(true);
  });
});

describe("the inputs of Record submission", () => {
  it("parses recipients, lower-cased and de-duplicated, and refuses a bad one", () => {
    expect(parseRecipients("Jane.Doe@agency.gov, co@army.mil;jane.doe@agency.gov")).toEqual({ ok: true, list: ["jane.doe@agency.gov", "co@army.mil"] });
    expect(parseRecipients("")).toEqual({ ok: true, list: [] });
    expect(parseRecipients("not-an-address").ok).toBe(false);
    expect(parseRecipients(Array.from({ length: 21 }, (_, i) => `a${i}@x.gov`).join(",")).ok).toBe(false);
  });

  it("accepts a past time and refuses nonsense or a time more than a day ahead", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    expect(parseSentAt("2026-11-17T09:30:00Z", now)?.toISOString()).toBe("2026-11-17T09:30:00.000Z");
    expect(parseSentAt("nope", now)).toBeNull();
    expect(parseSentAt("2026-11-19T12:00:00Z", now)).toBeNull();
  });

  it("names the kept file from the title", () => {
    expect(submissionFileName("Acme — Cloud Ops (Vol. 1)", "pdf")).toBe("Acme-Cloud-Ops-Vol-1.pdf");
    expect(submissionFileName("", "docx")).toBe("proposal.docx");
    expect(submissionFileName("../../etc/passwd", "pdf")).toBe("etc-passwd.pdf");
  });
});
