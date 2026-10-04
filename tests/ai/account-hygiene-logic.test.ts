/**
 * BL-AUTH-ABUSE Slice 1 — the pure rules: what a sign-up name may look
 * like, disposable inboxes, the form's bot signals, the purge rule and
 * the delete guard.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_FORM_FILL_MS,
  deletionBlocker,
  isDisposableEmailDomain,
  normalizePersonName,
  purgeDecision,
  sanitizePurgeDays,
  signupBotSignal,
  soleWorkspaces,
  validatePersonName,
  type DeletionMembership,
} from "@/lib/account-hygiene-logic";

describe("validatePersonName", () => {
  it("accepts real names in any script, with particles, hyphens and apostrophes", () => {
    for (const n of [
      "Ana Rivera",
      "Dee Park",
      "Mary-Jane O'Neil",
      "Mary-Jane O’Neil",
      "José Álvarez",
      "Nguyễn Văn An",
      "J. R. R. Tolkien",
      "J.R.R. Tolkien",
      "Ronald McDonald",
      "Pieter VanDerBerg",
      "Karl Schwarzschild",
      "Grzegorz Brzęczyszczykiewicz",
      "李小龙",
      "Олена Коваль",
      "Al",
      "JOHN SMITH",
      "Martin Luther King, Jr.",
    ]) {
      expect(validatePersonName(n), n).toEqual({ ok: true, name: normalizePersonName(n) });
    }
  });

  it("normalises whitespace", () => {
    expect(validatePersonName("  Ana   Rivera ")).toEqual({ ok: true, name: "Ana Rivera" });
  });

  it("refuses what bots send: mash, digits, links, addresses, emoji, extremes", () => {
    for (const n of [
      "",
      "   ",
      "A",
      "xKjQwPzLm",
      "aBcDeFgH",
      "qwrtzpsdfgh",
      "John123",
      "http://spam.example",
      "www.cheap-pills.biz",
      "Visit example.com",
      "bob@example.com",
      "Ana 🙂",
      "a".repeat(81),
      "Supercalifragilisticexpialidocious",
      "-Ana",
      null,
      42,
    ]) {
      expect(validatePersonName(n).ok, String(n)).toBe(false);
    }
  });
});

describe("isDisposableEmailDomain", () => {
  it("knows throwaway providers and their subdomains, and nothing else", () => {
    expect(isDisposableEmailDomain("mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("MAILINATOR.COM")).toBe(true);
    expect(isDisposableEmailDomain("eu.mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("yopmail.com.")).toBe(true);
    expect(isDisposableEmailDomain("sysusa.com")).toBe(false);
    expect(isDisposableEmailDomain("gmail.com")).toBe(false);
    expect(isDisposableEmailDomain("notmailinator.com")).toBe(false);
    expect(isDisposableEmailDomain("")).toBe(false);
    expect(isDisposableEmailDomain(null)).toBe(false);
  });
});

describe("signupBotSignal", () => {
  it("flags the honeypot, a too-fast submit and a missing fill time", () => {
    expect(signupBotSignal({ honeypot: "https://x.example", elapsedMs: 9000 })).toBe("honeypot");
    expect(signupBotSignal({ honeypot: "", elapsedMs: MIN_FORM_FILL_MS - 1 })).toBe("too_fast");
    expect(signupBotSignal({ honeypot: undefined, elapsedMs: undefined })).toBe("no_timing");
    expect(signupBotSignal({ honeypot: "", elapsedMs: "5000" })).toBe("no_timing");
    expect(signupBotSignal({ honeypot: "", elapsedMs: Number.NaN })).toBe("no_timing");
  });
  it("passes a person", () => {
    expect(signupBotSignal({ honeypot: "", elapsedMs: 14_000 })).toBeNull();
    expect(signupBotSignal({ honeypot: "   ", elapsedMs: MIN_FORM_FILL_MS })).toBeNull();
  });
});

describe("purgeDecision", () => {
  const cutoff = new Date("2026-09-27T00:00:00Z");
  const old = new Date("2026-09-01T00:00:00Z");
  const base = { id: "u1", verified: false, isSuperadmin: false, createdAt: old };
  const alone = [{ organizationId: "o1", organizationName: "Bot's workspace", memberCount: 1 }];

  it("takes old unverified accounts alone in their workspaces, with those workspaces", () => {
    expect(purgeDecision(base, alone, cutoff)).toEqual({ eligible: true, workspaces: [{ id: "o1", name: "Bot's workspace" }] });
    expect(purgeDecision(base, [], cutoff)).toEqual({ eligible: true, workspaces: [] });
  });
  it("leaves verified, platform admins, recent sign-ups and shared workspaces alone", () => {
    expect(purgeDecision({ ...base, verified: true }, alone, cutoff)).toEqual({ eligible: false, reason: "verified" });
    expect(purgeDecision({ ...base, isSuperadmin: true }, alone, cutoff)).toEqual({ eligible: false, reason: "superadmin" });
    expect(purgeDecision({ ...base, createdAt: new Date("2026-10-01T00:00:00Z") }, alone, cutoff)).toEqual({ eligible: false, reason: "too_recent" });
    expect(purgeDecision(base, [...alone, { organizationId: "o2", organizationName: "Real Co", memberCount: 3 }], cutoff)).toEqual({ eligible: false, reason: "shared_workspace" });
  });
  it("bounds the age", () => {
    expect(sanitizePurgeDays(30)).toBe(30);
    expect(sanitizePurgeDays(0)).toBe(7);
    expect(sanitizePurgeDays(366)).toBe(7);
    expect(sanitizePurgeDays(2.5)).toBe(7);
    expect(sanitizePurgeDays("30")).toBe(7);
  });
});

describe("deletionBlocker / soleWorkspaces", () => {
  const m = (over: Partial<DeletionMembership>): DeletionMembership => ({
    organizationId: "o1",
    organizationName: "Acme",
    role: "author",
    status: "active",
    activeMembers: 3,
    activeAdmins: 1,
    totalMembers: 3,
    ...over,
  });

  it("never yourself, never a platform admin", () => {
    expect(deletionBlocker({ targetId: "a", actorId: "a", isSuperadmin: false, memberships: [] })).toMatch(/your own/);
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: true, memberships: [] })).toMatch(/Revoke superadmin/);
  });
  it("never the last admin of a workspace that still has people", () => {
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: false, memberships: [m({ role: "admin" })] })).toMatch(/only admin of Acme/);
    // Another admin there, a disabled membership, or nobody else: fine.
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: false, memberships: [m({ role: "admin", activeAdmins: 2 })] })).toBeNull();
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: false, memberships: [m({ role: "admin", status: "disabled" })] })).toBeNull();
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: false, memberships: [m({ role: "admin", activeMembers: 1, totalMembers: 1 })] })).toBeNull();
    expect(deletionBlocker({ targetId: "b", actorId: "a", isSuperadmin: false, memberships: [m({})] })).toBeNull();
  });
  it("names the workspaces nobody else belongs to", () => {
    expect(
      soleWorkspaces([
        m({ organizationId: "o1", organizationName: "Bot's workspace", totalMembers: 1 }),
        m({ organizationId: "o2", organizationName: "Acme", totalMembers: 2, activeMembers: 0 }),
      ]),
    ).toEqual([{ id: "o1", name: "Bot's workspace" }]);
  });
});
