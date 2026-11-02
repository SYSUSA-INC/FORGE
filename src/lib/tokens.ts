import { randomBytes, createHash } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";

export type TokenPurpose = "verify-email" | "reset-password" | "invite" | "change-email";

const LIFETIMES_MS: Record<TokenPurpose, number> = {
  "verify-email": 24 * 60 * 60 * 1000,
  "reset-password": 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
  // BL-STAB-8b-3 — the link to the new address.
  "change-email": 24 * 60 * 60 * 1000,
};

function prefix(purpose: TokenPurpose, subject: string): string {
  return `${purpose}:${subject.toLowerCase()}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueToken(
  purpose: TokenPurpose,
  subject: string,
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const hashed = hashToken(raw);
  const identifier = prefix(purpose, subject);
  const expires = new Date(Date.now() + LIFETIMES_MS[purpose]);

  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  await db.insert(verificationTokens).values({
    identifier,
    token: hashed,
    expires,
  });

  return raw;
}

/**
 * Non-consuming check: does this raw token match a live token for the
 * purpose + subject? Used to gate what a landing page may reveal before
 * the token is actually spent on submit (BL-TENANT-AUDIT 2026-09).
 */
export async function peekToken(
  purpose: TokenPurpose,
  subject: string,
  rawToken: string,
): Promise<boolean> {
  if (!rawToken) return false;
  const identifier = prefix(purpose, subject);
  const hashed = hashToken(rawToken);
  const [row] = await db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashed),
      ),
    )
    .limit(1);
  return Boolean(row && row.expires.getTime() >= Date.now());
}

/**
 * BL-STAB-8b-1 — the live token for this purpose and subject went out by
 * email. A link that travelled through the inbox proves the address when
 * it is used; a copied one (email not configured, or handed over some
 * other way) does not, and the account verifies separately.
 */
export async function markTokenSent(purpose: TokenPurpose, subject: string): Promise<void> {
  await db
    .update(verificationTokens)
    .set({ sentByEmail: true })
    .where(eq(verificationTokens.identifier, prefix(purpose, subject)));
}

export async function consumeToken(
  purpose: TokenPurpose,
  subject: string,
  rawToken: string,
): Promise<boolean> {
  return (await consumeTokenDetailed(purpose, subject, rawToken)).ok;
}

/** `consumeToken`, and whether the spent link had gone out by email. */
export async function consumeTokenDetailed(
  purpose: TokenPurpose,
  subject: string,
  rawToken: string,
): Promise<{ ok: boolean; sentByEmail: boolean }> {
  const identifier = prefix(purpose, subject);
  const hashed = hashToken(rawToken);

  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashed),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, sentByEmail: false };
  if (row.expires.getTime() < Date.now()) {
    await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, hashed),
        ),
      );
    return { ok: false, sentByEmail: false };
  }

  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashed),
      ),
    );

  return { ok: true, sentByEmail: row.sentByEmail };
}

export async function purgeExpiredTokens(): Promise<void> {
  await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, new Date()));
}
