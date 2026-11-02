import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";
import { consumeToken, consumeTokenDetailed, issueToken, markTokenSent } from "@/lib/tokens";

/** BL-STAB-8b-1 — a token remembers whether its link went out by email. */
describe("markTokenSent / consumeTokenDetailed", () => {
  const subject = `sent-${Date.now().toString(36)}@bl-stab-8b.test`;
  afterEach(async () => {
    await db.delete(verificationTokens).where(eq(verificationTokens.identifier, `reset-password:${subject}`));
  });

  it("a freshly issued token is not yet sent; marking it says so on consumption", async () => {
    const raw = await issueToken("reset-password", subject);
    const [row] = await db.select({ sent: verificationTokens.sentByEmail }).from(verificationTokens).where(eq(verificationTokens.identifier, `reset-password:${subject}`));
    expect(row?.sent).toBe(false);
    await markTokenSent("reset-password", subject);
    expect(await consumeTokenDetailed("reset-password", subject, raw)).toEqual({ ok: true, sentByEmail: true });
    expect(await consumeToken("reset-password", subject, raw)).toBe(false);
  });

  it("a copied (never sent) token consumes with sentByEmail false, and a wrong token with ok false", async () => {
    const raw = await issueToken("reset-password", subject);
    expect(await consumeTokenDetailed("reset-password", subject, "not-the-token")).toEqual({ ok: false, sentByEmail: false });
    expect(await consumeTokenDetailed("reset-password", subject, raw)).toEqual({ ok: true, sentByEmail: false });
  });

  it("re-issuing a token resets the sent flag", async () => {
    await issueToken("reset-password", subject);
    await markTokenSent("reset-password", subject);
    const raw2 = await issueToken("reset-password", subject);
    expect(await consumeTokenDetailed("reset-password", subject, raw2)).toEqual({ ok: true, sentByEmail: false });
  });
});
