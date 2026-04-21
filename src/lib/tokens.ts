import { randomBytes, createHash } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";

export type TokenPurpose = "verify-email" | "reset-password" | "invite";

const LIFETIMES_MS: Record<TokenPurpose, number> = {
  "verify-email": 24 * 60 * 60 * 1000,
  "reset-password": 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
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

export async function consumeToken(
  purpose: TokenPurpose,
  subject: string,
  rawToken: string,
): Promise<boolean> {
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

  if (!row) return false;
  if (row.expires.getTime() < Date.now()) {
    await db
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, hashed),
        ),
      );
    return false;
  }

  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashed),
      ),
    );

  return true;
}

export async function purgeExpiredTokens(): Promise<void> {
  await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, new Date()));
}
