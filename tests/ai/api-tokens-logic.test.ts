/**
 * BL-16 apiAccess — the pure rules of the read-only API: token shape and
 * the Authorization header, names and lifetimes, a token's state, list
 * paging, and the JSON shapes.
 */

import { describe, expect, it } from "vitest";
import {
  apiOpportunity,
  apiProposal,
  decodeCursor,
  encodeCursor,
  isApiTokenShape,
  pageOf,
  parseListParams,
  shouldTouchLastUsed,
  tokenDisplayPrefix,
  tokenExpiry,
  tokenFromAuthorization,
  tokenState,
  validateTokenName,
} from "@/lib/api-tokens-logic";

const TOKEN = `forge_${"a".repeat(20)}-_${"B9".repeat(10)}x`;
const NOW = new Date("2026-10-04T12:00:00Z");
const ID = "0b8f6c3e-2a51-4c7e-9d8a-1f2e3d4c5b6a";

describe("tokens", () => {
  it("recognises the token shape and reads it from the Authorization header", () => {
    expect(TOKEN).toHaveLength(49);
    expect(isApiTokenShape(TOKEN)).toBe(true);
    expect(isApiTokenShape(TOKEN.slice(0, -1))).toBe(false);
    expect(isApiTokenShape(`sk_${TOKEN.slice(6)}`)).toBe(false);
    expect(tokenFromAuthorization(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromAuthorization(`bearer   ${TOKEN} `)).toBe(TOKEN);
    expect(tokenFromAuthorization(`Basic ${TOKEN}`)).toBeNull();
    expect(tokenFromAuthorization("Bearer forge_short")).toBeNull();
    expect(tokenFromAuthorization(null)).toBeNull();
    expect(tokenDisplayPrefix(TOKEN)).toBe("forge_aaaaaa");
  });

  it("validates names and lifetimes", () => {
    expect(validateTokenName("  Salesforce   sync ")).toEqual({ ok: true, value: "Salesforce sync" });
    expect(validateTokenName("x")).toMatchObject({ ok: false });
    expect(validateTokenName("x".repeat(61))).toMatchObject({ ok: false });
    expect(validateTokenName(42)).toMatchObject({ ok: false });
    expect(tokenExpiry(30, NOW)).toEqual(new Date("2026-11-03T12:00:00Z"));
    expect(tokenExpiry(0, NOW)).toBeNull();
    expect(tokenExpiry(7, NOW)).toBeUndefined();
    expect(tokenExpiry("90", NOW)).toBeUndefined();
  });

  it("works out a token's state and when to record its last use", () => {
    expect(tokenState({ expiresAt: null, revokedAt: null }, NOW)).toBe("active");
    expect(tokenState({ expiresAt: new Date("2026-10-05T00:00:00Z"), revokedAt: null }, NOW)).toBe("active");
    expect(tokenState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("expired");
    expect(tokenState({ expiresAt: new Date("2027-01-01T00:00:00Z"), revokedAt: NOW }, NOW)).toBe("revoked");
    expect(shouldTouchLastUsed(null, NOW)).toBe(true);
    expect(shouldTouchLastUsed(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
    expect(shouldTouchLastUsed(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(true);
  });
});

describe("list paging", () => {
  const stages = ["identified", "capture", "won"] as const;
  const parse = (q: string) => parseListParams(new URLSearchParams(q), stages);

  it("round-trips a cursor and refuses one it didn't issue", () => {
    const c = { updatedAt: new Date("2026-10-01T08:30:00.123Z"), id: ID };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-01|nope").toString("base64url"))).toBeNull();
  });

  it("parses limit, cursor, updated_since and stage", () => {
    expect(parse("")).toEqual({ ok: true, value: { limit: 50, cursor: null, updatedSince: null, stage: null } });
    const cursor = encodeCursor({ updatedAt: NOW, id: ID });
    expect(parse(`limit=10&cursor=${cursor}&updated_since=2026-10-01T00:00:00Z&stage=won`)).toEqual({
      ok: true,
      value: { limit: 10, cursor: { updatedAt: NOW, id: ID }, updatedSince: new Date("2026-10-01T00:00:00Z"), stage: "won" },
    });
    expect(parse("limit=0")).toMatchObject({ ok: false });
    expect(parse("limit=101")).toMatchObject({ ok: false });
    expect(parse("limit=2.5")).toMatchObject({ ok: false });
    expect(parse("cursor=garbage")).toMatchObject({ ok: false, error: expect.stringMatching(/cursor/) });
    expect(parse("updated_since=yesterday")).toMatchObject({ ok: false, error: expect.stringMatching(/ISO 8601/) });
    expect(parse("stage=lost")).toMatchObject({ ok: false, error: expect.stringMatching(/identified, capture, won/) });
  });

  it("trims the look-ahead row and points at the next page", () => {
    const rows = [3, 2, 1].map((n) => ({ id: `${ID.slice(0, -1)}${n}`, updatedAt: new Date(NOW.getTime() - n * 1000) }));
    expect(pageOf(rows, 3)).toEqual({ items: rows, nextCursor: null });
    const page = pageOf(rows, 2);
    expect(page.items).toEqual(rows.slice(0, 2));
    expect(decodeCursor(page.nextCursor!)).toEqual({ updatedAt: rows[1]!.updatedAt, id: rows[1]!.id });
  });
});

describe("response shapes", () => {
  it("serialises dates as ISO strings and renames the SAM notice id", () => {
    const opp = apiOpportunity({
      id: ID, title: "Cloud ops", agency: "GSA", office: "FAS", stage: "capture", solicitationNumber: "47QTCA",
      noticeId: "abc123", naicsCode: "541512", pscCode: "D302", setAside: "SBA", contractType: "FFP",
      placeOfPerformance: "DC", incumbent: "Acme", valueLow: "1M", valueHigh: "5M", pWin: 40,
      releaseDate: null, responseDueDate: new Date("2026-11-01T17:00:00Z"), awardDate: null, createdAt: NOW, updatedAt: NOW,
    });
    expect(opp).toMatchObject({ samNoticeId: "abc123", responseDueDate: "2026-11-01T17:00:00.000Z", releaseDate: null, updatedAt: NOW.toISOString() });
    expect(opp).not.toHaveProperty("noticeId");
    expect(apiProposal({ id: ID, opportunityId: ID, title: "P", stage: "draft", submittedAt: null, createdAt: NOW, updatedAt: NOW })).toEqual({
      id: ID, opportunityId: ID, title: "P", stage: "draft", submittedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
  });
});
