/**
 * OAuth email-from-sender — Google v1.
 *
 * Stores per-user OAuth tokens (encrypted) and exposes a
 * sendEmailFromUser() helper that uses the connected mailbox.
 *
 * Encryption: AES-256-GCM with a server-side master key.
 *   EMAIL_ENCRYPTION_KEY = 32 raw bytes, supplied as 64-char hex
 *   or 44-char base64 in env. Generate one with:
 *     openssl rand -hex 32
 *
 * Token refresh: opportunistic. Before each send we check expiry;
 * if past or within 60s, we POST to Google's token endpoint with
 * the refresh_token to get a new access_token. Refresh tokens are
 * long-lived (months/years) but can be revoked by the user via
 * their Google account.
 *
 * Microsoft (Graph) is not yet wired — schema and helper signatures
 * already accept "microsoft", but only the Google provider is built
 * out in this PR.
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  emailOauthAccounts,
  type EmailOauthAccount,
  type EmailOauthProvider,
} from "@/db/schema";

// ─────────────────────────────────────────────────────────────────
// Encryption
// ─────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard

function getKey(): Buffer {
  const raw = process.env.EMAIL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "EMAIL_ENCRYPTION_KEY is not set. Generate with `openssl rand -hex 32` and add to Vercel env vars (Production + Preview + Development).",
    );
  }
  // Accept hex (64 chars) or base64 (44 chars).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `EMAIL_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars). Got ${buf.length}-byte decode.`,
    );
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(blob: string): string {
  if (!blob) return "";
  const key = getKey();
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LEN + 16) {
    throw new Error("Encrypted blob too short.");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ciphertext = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf8");
}

// ─────────────────────────────────────────────────────────────────
// Google provider config
// ─────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
];

function googleClientId(): string {
  const v = process.env.GOOGLE_EMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_EMAIL_CLIENT_ID is not set.");
  return v;
}

function googleClientSecret(): string {
  const v =
    process.env.GOOGLE_EMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_EMAIL_CLIENT_SECRET is not set.");
  return v;
}

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return "https://www.sysgov.com";
  const v = process.env.VERCEL_URL;
  if (v) return `https://${v}`;
  return "https://www.sysgov.com";
}

export function googleOauthRedirectUri(): string {
  return `${appBaseUrl()}/api/email-oauth/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleOauthRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-auth
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    redirect_uri: googleOauthRedirectUri(),
    code,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${t.slice(0, 240)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${t.slice(0, 240)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  email_verified: boolean;
}> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed (${res.status})`);
  }
  return (await res.json()) as { email: string; email_verified: boolean };
}

// ─────────────────────────────────────────────────────────────────
// Account row helpers (encrypt/decrypt at the boundary)
// ─────────────────────────────────────────────────────────────────

export async function upsertEmailOauthAccount(input: {
  userId: string;
  provider: EmailOauthProvider;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresIn?: number;
}): Promise<{ id: string }> {
  const expiresAt = input.expiresIn
    ? new Date(Date.now() + input.expiresIn * 1000)
    : null;

  // Sequential per Neon-pgbouncer rule: try update, fall back to insert.
  const existing = await db
    .select({ id: emailOauthAccounts.id })
    .from(emailOauthAccounts)
    .where(
      and(
        eq(emailOauthAccounts.userId, input.userId),
        eq(emailOauthAccounts.provider, input.provider),
        eq(emailOauthAccounts.emailAddress, input.emailAddress),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(emailOauthAccounts)
      .set({
        accessTokenEncrypted: encryptToken(input.accessToken),
        // Google sometimes omits refresh_token on re-consent — keep
        // the previous one if the new exchange didn't return one.
        ...(input.refreshToken
          ? { refreshTokenEncrypted: encryptToken(input.refreshToken) }
          : {}),
        scope: input.scope,
        tokenExpiresAt: expiresAt,
        lastError: "",
      })
      .where(eq(emailOauthAccounts.id, existing[0].id));
    return { id: existing[0].id };
  }

  const [row] = await db
    .insert(emailOauthAccounts)
    .values({
      userId: input.userId,
      provider: input.provider,
      emailAddress: input.emailAddress,
      accessTokenEncrypted: encryptToken(input.accessToken),
      refreshTokenEncrypted: encryptToken(input.refreshToken),
      scope: input.scope,
      tokenExpiresAt: expiresAt,
      isDefault: true, // first connected account becomes default
    })
    .returning({ id: emailOauthAccounts.id });
  return { id: row!.id };
}

export async function listUserEmailAccounts(
  userId: string,
): Promise<
  {
    id: string;
    provider: EmailOauthProvider;
    emailAddress: string;
    isDefault: boolean;
    connectedAt: Date;
    lastUsedAt: Date | null;
    lastError: string;
  }[]
> {
  return db
    .select({
      id: emailOauthAccounts.id,
      provider: emailOauthAccounts.provider,
      emailAddress: emailOauthAccounts.emailAddress,
      isDefault: emailOauthAccounts.isDefault,
      connectedAt: emailOauthAccounts.connectedAt,
      lastUsedAt: emailOauthAccounts.lastUsedAt,
      lastError: emailOauthAccounts.lastError,
    })
    .from(emailOauthAccounts)
    .where(eq(emailOauthAccounts.userId, userId));
}

export async function disconnectEmailOauthAccount(
  userId: string,
  accountId: string,
): Promise<void> {
  await db
    .delete(emailOauthAccounts)
    .where(
      and(
        eq(emailOauthAccounts.id, accountId),
        eq(emailOauthAccounts.userId, userId),
      ),
    );
}

export async function setDefaultEmailAccount(
  userId: string,
  accountId: string,
): Promise<void> {
  // Sequential — clear all defaults for this user, then set the chosen one.
  await db
    .update(emailOauthAccounts)
    .set({ isDefault: false })
    .where(eq(emailOauthAccounts.userId, userId));
  await db
    .update(emailOauthAccounts)
    .set({ isDefault: true })
    .where(
      and(
        eq(emailOauthAccounts.id, accountId),
        eq(emailOauthAccounts.userId, userId),
      ),
    );
}

// ─────────────────────────────────────────────────────────────────
// Send
// ─────────────────────────────────────────────────────────────────

export type SendFromUserResult =
  | { ok: true; messageId: string; provider: EmailOauthProvider; from: string }
  | { ok: false; reason: string };

/**
 * Send an email from the user's default OAuth-connected mailbox.
 * Returns reason="no-account" if the user hasn't connected one — the
 * caller should fall back to the platform Resend pipeline.
 */
export async function sendEmailFromUser(opts: {
  userId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendFromUserResult> {
  const [account] = await db
    .select()
    .from(emailOauthAccounts)
    .where(
      and(
        eq(emailOauthAccounts.userId, opts.userId),
        eq(emailOauthAccounts.isDefault, true),
      ),
    )
    .limit(1);
  if (!account) {
    return { ok: false, reason: "no-account" };
  }

  if (account.provider !== "google") {
    return {
      ok: false,
      reason: `Provider ${account.provider} not yet implemented (Phase 13c v1 ships Google only).`,
    };
  }

  let accessToken = decryptToken(account.accessTokenEncrypted);
  const refreshToken = decryptToken(account.refreshTokenEncrypted);

  // Refresh if expired or within 60 seconds of expiry.
  const now = Date.now();
  const expiry = account.tokenExpiresAt?.getTime() ?? 0;
  if (expiry < now + 60_000 && refreshToken) {
    try {
      const refreshed = await refreshGoogleToken(refreshToken);
      accessToken = refreshed.access_token;
      await db
        .update(emailOauthAccounts)
        .set({
          accessTokenEncrypted: encryptToken(refreshed.access_token),
          tokenExpiresAt: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000)
            : null,
          lastError: "",
        })
        .where(eq(emailOauthAccounts.id, account.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(emailOauthAccounts)
        .set({ lastError: msg })
        .where(eq(emailOauthAccounts.id, account.id));
      return { ok: false, reason: msg };
    }
  }

  // Build RFC 822 message and base64url-encode for Gmail's send endpoint.
  const raw = buildRawMessage({
    from: account.emailAddress,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  const body = JSON.stringify({ raw });

  const res = await fetch(GOOGLE_GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    const msg = `Gmail send failed (${res.status}): ${t.slice(0, 240)}`;
    await db
      .update(emailOauthAccounts)
      .set({ lastError: msg })
      .where(eq(emailOauthAccounts.id, account.id));
    return { ok: false, reason: msg };
  }

  const json = (await res.json()) as { id?: string };
  await db
    .update(emailOauthAccounts)
    .set({ lastUsedAt: new Date(), lastError: "" })
    .where(eq(emailOauthAccounts.id, account.id));

  return {
    ok: true,
    messageId: json.id ?? "",
    provider: account.provider,
    from: account.emailAddress,
  };
}

function buildRawMessage(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): string {
  // Multipart/alternative so clients pick text or HTML.
  const boundary = `forge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;

  const lines: string[] = [];
  lines.push(`From: ${input.from}`);
  lines.push(`To: ${input.to}`);
  lines.push(`Subject: ${subjectEncoded}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push("");
  if (input.text) {
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("");
    lines.push(input.text);
  }
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/html; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(input.html);
  lines.push(`--${boundary}--`);

  // Base64url for Gmail.
  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
