import { Resend } from "resend";
import { log } from "@/lib/log";
import { appBaseUrl, inviteUrl, passwordResetUrl, verifyEmailUrl } from "@/lib/app-url";
import { buildDigestEmail, buildRuleNotificationEmail } from "@/lib/notification-email";
import { EMAIL_HEX } from "@/lib/theme-colors";
import { emailFrom, emailFromAddress } from "@/lib/site-domain";

const apiKey = process.env.RESEND_API_KEY;
// BL-DOMAIN-FORGEAXI 2 — from the site's domain unless EMAIL_FROM says otherwise.
const from = emailFrom();

let client: Resend | null = null;

function getClient(): Resend {
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. Emails cannot be sent. Add the env var on Vercel.",
    );
  }
  if (!client) client = new Resend(apiKey);
  return client;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Override the From header for this send. Format: `"Name" <addr@host>"` or just `addr@host`. */
  from?: string;
  /** Reply-To header — where replies should land. */
  replyTo?: string;
}): Promise<void> {
  if (!apiKey) {
    log.warn("[email]", "RESEND_API_KEY not set — email skipped (stub mode)", {
      subject: opts.subject,
      to: opts.to,
    });
    return;
  }
  // BL-DOMAIN-FORGEAXI 2 — Resend reports a refused message (an
  // unverified sending domain, a bad address) in `error`, not by
  // throwing. Ignoring it made every refusal look like a sent email.
  const sender = opts.from ?? from;
  const res = await getClient().emails.send({
    from: sender,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });
  if (res?.error) {
    const message = res.error.message || res.error.name || "the email service refused the message";
    log.error("[email]", "send refused", { subject: opts.subject, from: sender, error: message });
    throw new Error(/domain/i.test(message) ? `${message} (the sending domain must be verified in Resend)` : message);
  }
}

// BL-AUTH-INVITE — the origin and the invite / reset links are built in
// src/lib/app-url.ts so the "copy link" an admin sees is byte-identical
// to what the email carries.
const baseUrl = appBaseUrl;

function emailShell(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_HEX.page};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${EMAIL_HEX.ink};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_HEX.page};padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:${EMAIL_HEX.card};border-radius:5px;overflow:hidden;border:1px solid ${EMAIL_HEX.line};">
            <tr>
              <td style="padding:32px 40px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
                  <div style="width:32px;height:32px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px;">F</div>
                  <div>
                    <div style="font-weight:600;font-size:14px;color:${EMAIL_HEX.ink};">FORGE</div>
                    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${EMAIL_HEX.muted};">Proposal Ops</div>
                  </div>
                </div>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px;border-top:1px solid ${EMAIL_HEX.line};font-size:11px;color:${EMAIL_HEX.muted};">
                FORGE · Government procurement response platform
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = verifyEmailUrl(to, token);
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Verify your email</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      Welcome to Forge. Confirm this is your email address by clicking the button below.
      The link expires in 24 hours.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Verify email</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn't work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Didn't sign up? You can safely ignore this email.
    </p>
  `;
  await sendEmail({
    to,
    subject: "Verify your email for Forge",
    html: emailShell("Verify your email", body),
    text: `Verify your email for Forge by visiting: ${url}\n\nThis link expires in 24 hours.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = passwordResetUrl(to, token);
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Reset your password</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      We received a request to reset your Forge password. Click the button below to choose a new one.
      The link expires in 1 hour.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Reset password</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn't work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Didn't request this? You can safely ignore this email — your password will not change.
    </p>
  `;
  await sendEmail({
    to,
    subject: "Reset your Forge password",
    html: emailShell("Reset your password", body),
    text: `Reset your Forge password by visiting: ${url}\n\nThis link expires in 1 hour.`,
  });
}

export async function sendInviteEmail(opts: {
  to: string;
  inviteId: string;
  token: string;
  organizationName: string;
  inviterName: string;
  role: string;
}): Promise<void> {
  const url = inviteUrl(opts.inviteId, opts.token);
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">You&#39;re invited to Forge</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${escapeHtml(opts.inviterName)} has invited you to join <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(
        opts.organizationName,
      )}</strong> on Forge as <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(
        opts.role,
      )}</strong>. Click below to create your account.
      The link expires in 7 days.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Accept invitation</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Not expecting this? You can safely ignore this email.
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: `You're invited to ${opts.organizationName} on Forge`,
    html: emailShell("You're invited to Forge", body),
    text: `${opts.inviterName} has invited you to join ${opts.organizationName} on Forge.\nAccept: ${url}\n\nThis link expires in 7 days.`,
  });
}

export async function sendReviewAssignedEmail(opts: {
  to: string;
  recipientName: string | null;
  starterName: string;
  proposalTitle: string;
  reviewColor: string;
  proposalId: string;
  reviewId: string;
  dueDate: Date | null;
  sectionTitle: string | null;
}): Promise<void> {
  const url = `${baseUrl()}/proposals/${opts.proposalId}/reviews/${opts.reviewId}`;
  const due = opts.dueDate
    ? `Due ${opts.dueDate.toISOString().slice(0, 10)}.`
    : "No due date set.";
  const scope = opts.sectionTitle
    ? ` You're assigned to <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(
        opts.sectionTitle,
      )}</strong>.`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">${escapeHtml(
      opts.reviewColor,
    )} review assigned</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${escapeHtml(opts.starterName)} started a ${escapeHtml(
        opts.reviewColor,
      )} review on <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(
        opts.proposalTitle,
      )}</strong> and added you as a reviewer.${scope} ${escapeHtml(due)}
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: `${opts.reviewColor} review on ${opts.proposalTitle}`,
    html: emailShell(`${opts.reviewColor} review assigned`, body),
    text: `${opts.starterName} added you as a reviewer on a ${opts.reviewColor} review of ${opts.proposalTitle}.\n${due}\nOpen: ${url}`,
  });
}

export async function sendCommentMentionEmail(opts: {
  to: string;
  authorName: string;
  proposalTitle: string;
  reviewColor: string;
  commentBody: string;
  sectionTitle: string | null;
  proposalId: string;
  reviewId: string;
}): Promise<void> {
  const url = `${baseUrl()}/proposals/${opts.proposalId}/reviews/${opts.reviewId}`;
  const where = opts.sectionTitle
    ? ` on <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.sectionTitle)}</strong>`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">${escapeHtml(
      opts.authorName,
    )} mentioned you</h1>
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      In a ${escapeHtml(opts.reviewColor)} review comment${where} on
      <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.proposalTitle)}</strong>:
    </p>
    <blockquote style="margin:0 0 24px 0;padding:12px 16px;border-left:2px solid ${EMAIL_HEX.accent};background:${EMAIL_HEX.tint};font-size:14px;line-height:1.55;color:${EMAIL_HEX.ink};">
      ${escapeHtml(opts.commentBody.slice(0, 600))}${opts.commentBody.length > 600 ? "…" : ""}
    </blockquote>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: `${opts.authorName} mentioned you on ${opts.proposalTitle}`,
    html: emailShell(`${opts.authorName} mentioned you`, body),
    text: `${opts.authorName} mentioned you in a ${opts.reviewColor} review comment on ${opts.proposalTitle}.\n\n${opts.commentBody}\n\nOpen: ${url}`,
  });
}

export async function sendReviewCompletedEmail(opts: {
  to: string;
  closerName: string;
  proposalTitle: string;
  reviewColor: string;
  verdict: string;
  summary: string;
  proposalId: string;
  reviewId: string;
}): Promise<void> {
  const url = `${baseUrl()}/proposals/${opts.proposalId}/reviews/${opts.reviewId}`;
  const summarySnippet = opts.summary
    ? `<blockquote style="margin:0 0 24px 0;padding:12px 16px;border-left:2px solid ${EMAIL_HEX.accent};background:${EMAIL_HEX.tint};font-size:14px;line-height:1.55;color:${EMAIL_HEX.ink};">
        ${escapeHtml(opts.summary.slice(0, 600))}${opts.summary.length > 600 ? "…" : ""}
      </blockquote>`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">${escapeHtml(
      opts.reviewColor,
    )} review closed — ${escapeHtml(opts.verdict)}</h1>
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${escapeHtml(opts.closerName)} closed the ${escapeHtml(opts.reviewColor)} review on
      <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.proposalTitle)}</strong> with a verdict of
      <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.verdict)}</strong>.
    </p>
    ${summarySnippet}
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: `${opts.reviewColor} review closed — ${opts.verdict}`,
    html: emailShell(`${opts.reviewColor} review closed`, body),
    text: `${opts.closerName} closed the ${opts.reviewColor} review on ${opts.proposalTitle} — verdict ${opts.verdict}.\n\n${opts.summary}\n\nOpen: ${url}`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send-for-review request — capture manager pings a teammate (or
 * external email) for a Bid / No-bid / More-info call. The link is
 * token-authed so external reviewers can answer without a login.
 */
export async function sendOpportunityReviewRequestEmail(opts: {
  to: string;
  reviewerName: string;
  senderName: string;
  /** Sender's real email address — used for Reply-To so replies land on the human. */
  senderEmail: string;
  organizationName: string;
  opportunityTitle: string;
  agency: string;
  naics: string;
  setAside: string;
  dueDate: string; // already formatted
  synopsis: string;
  note: string;
  token: string;
}): Promise<void> {
  const url = `${baseUrl()}/review/${encodeURIComponent(opts.token)}`;
  const noteBlock = opts.note
    ? `<div style="margin:20px 0;padding:14px 16px;border-left:3px solid ${EMAIL_HEX.accent};background:${EMAIL_HEX.tint};border-radius:6px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${EMAIL_HEX.accent};margin-bottom:6px;">Note from ${escapeHtml(opts.senderName)}</div>
        <div style="font-size:13px;color:${EMAIL_HEX.ink};line-height:1.5;">${escapeHtml(opts.note)}</div>
      </div>`
    : "";
  const synopsisBlock = opts.synopsis
    ? `<div style="margin-top:10px;font-size:13px;line-height:1.55;color:${EMAIL_HEX.muted};">${escapeHtml(opts.synopsis).slice(0, 800)}</div>`
    : "";
  const greeting = opts.reviewerName
    ? `Hi ${escapeHtml(opts.reviewerName.split(" ")[0] ?? opts.reviewerName)},`
    : "Hi,";

  const opportunityCard = `
    <div style="margin:0;padding:14px 16px;border:1px solid ${EMAIL_HEX.line};border-radius:10px;background:${EMAIL_HEX.page};">
      <div style="font-size:15px;font-weight:600;color:${EMAIL_HEX.ink};margin-bottom:8px;">${escapeHtml(opts.opportunityTitle)}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:11px;color:${EMAIL_HEX.muted};width:100%;">
        <tr>
          <td style="padding:2px 0;width:80px;">Agency</td>
          <td style="padding:2px 0;color:${EMAIL_HEX.ink};">${escapeHtml(opts.agency || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">NAICS</td>
          <td style="padding:2px 0;color:${EMAIL_HEX.ink};">${escapeHtml(opts.naics || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Set-aside</td>
          <td style="padding:2px 0;color:${EMAIL_HEX.ink};">${escapeHtml(opts.setAside || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Due</td>
          <td style="padding:2px 0;color:${EMAIL_HEX.ink};">${escapeHtml(opts.dueDate || "—")}</td>
        </tr>
      </table>
      ${synopsisBlock}
    </div>
  `;

  const button = `
    <a href="${url}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Review opportunity</a>
  `;

  // Render the bullet structure as a styled list. Email clients don't
  // honor list-item flex/grid, so we use plain <ul><li> + inline styles.
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Review request</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${greeting}
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.senderName)}</strong>
      from ${escapeHtml(opts.organizationName)} would like your quick read on this opportunity:
    </p>
    ${noteBlock}
    <ul style="margin:8px 0 0 0;padding-left:20px;list-style-type:disc;color:${EMAIL_HEX.muted};font-size:14px;line-height:1.55;">
      <li style="margin-bottom:14px;">
        ${opportunityCard}
      </li>
      <li style="margin-bottom:14px;">
        Please open the link below to recommend
        <strong style="color:${EMAIL_HEX.green};">Bid</strong>,
        <strong style="color:${EMAIL_HEX.brass};">No-bid</strong>, or
        <strong style="color:${EMAIL_HEX.ink};">More info</strong>:
        <ul style="margin:10px 0 0 0;padding-left:20px;list-style-type:circle;">
          <li style="margin:0;">
            <div style="margin:4px 0 8px 0;">${button}</div>
            <div style="font-size:12px;color:${EMAIL_HEX.muted};line-height:1.5;">
              This link is personal to you and expires in 72 hours.
            </div>
          </li>
        </ul>
      </li>
    </ul>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn&rsquo;t work, paste this URL:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
  `;

  // From line: platform brand. The sender's identity is conveyed in
  // the body ("[Sender Name] from [Sender Company] would like..."),
  // and Reply-To routes replies to the human's real address.
  const fromAddr = emailFromAddress();
  const platformFrom = `"FORGE" <${fromAddr}>`;

  await sendEmail({
    to: opts.to,
    from: platformFrom,
    replyTo: opts.senderEmail || undefined,
    subject: `[FORGE] Review request — ${opts.opportunityTitle}`.slice(0, 120),
    html: emailShell(`Review request — ${opts.opportunityTitle}`, body),
    text:
      `${opts.senderName} from ${opts.organizationName} would like your quick read on "${opts.opportunityTitle}" (${opts.agency}, due ${opts.dueDate}).` +
      (opts.note ? `\n\nNote: ${opts.note}` : "") +
      `\n\nPlease open the link below to recommend Bid / No-bid / More info:\n${url}` +
      `\n\nThis link is personal to you and expires in 72 hours.`,
  });
}

/** BL-AIP-3 — whether a provider key is present; callers record the truth when not. */
/** BL-STAB-8a-4 — a platform administrator reset the person's two-step sign-in. */
export async function sendMfaResetEmail(opts: { to: string; reason: string; byEmail: string | null; byCompanyAdmin?: boolean }): Promise<void> {
  const url = `${appBaseUrl()}/sign-in`;
  // BL-MFA-ADMIN — a company admin can reset a member too.
  const who = opts.byCompanyAdmin ? "Your company's FORGE administrator" : "A FORGE platform administrator";
  const reason = escapeHtml(opts.reason);
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Your two-step sign-in was reset</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${who}${opts.byEmail ? ` (${escapeHtml(opts.byEmail)})` : ""} removed the authenticator apps, passkeys and recovery codes from your account and signed you out everywhere. Their reason:
    </p>
    <blockquote style="margin:0 0 20px 0;padding:10px 14px;border-left:3px solid ${EMAIL_HEX.accent};font-size:14px;line-height:1.55;color:${EMAIL_HEX.ink};">${reason}</blockquote>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      Your password is unchanged. The next time you sign in, FORGE asks you to set up two-step sign-in again (a passkey or an authenticator app) and gives you new recovery codes.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Sign in</a>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Did not expect this? Reply to this email or contact your administrator before signing in.
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: "Your FORGE two-step sign-in was reset",
    html: emailShell("Two-step sign-in reset", body),
    text: `${who}${opts.byEmail ? ` (${opts.byEmail})` : ""} reset your two-step sign-in and signed you out everywhere.\n\nReason: ${opts.reason}\n\nYour password is unchanged. Sign in at ${url} to set it up again.\n\nDid not expect this? Contact your administrator before signing in.`,
  });
}

/** BL-MFA-RECOVERY — the single-use link that gets a person past the second step once. */
export async function sendMfaRecoveryLinkEmail(opts: { to: string; url: string; minutes: number }): Promise<void> {
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Your FORGE recovery link</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      You asked for a way past the second step because your passkey and authenticator app can't be used. Open this link in the browser where you just entered your password. It works once, for ${opts.minutes} minutes.
    </p>
    <p style="margin:24px 0;">
      <a href="${opts.url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Continue signing in</a>
    </p>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      Once you are in, FORGE takes you to Settings → Security to replace what you lost.
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Did not ask for this? Someone has your password. Change it now, and tell your administrator.
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: "Your FORGE recovery link",
    html: emailShell("Recovery link", body),
    text: `Open this link in the browser where you just entered your password. It works once, for ${opts.minutes} minutes:\n\n${opts.url}\n\nDid not ask for this? Someone has your password: change it now and tell your administrator.`,
  });
}

/** BL-MFA-RECOVERY — a recovery link was used: told to the person and to every platform administrator. */
export async function sendMfaRecoveryUsedEmail(opts: { to: string; who: string; at: string; self: boolean }): Promise<void> {
  const who = escapeHtml(opts.who);
  const lead = opts.self ? "You signed in to FORGE with a recovery link" : `${who} signed in to FORGE with a recovery link`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">A recovery link was used</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${lead} at ${escapeHtml(opts.at)} (UTC), in place of a passkey or authenticator code. It is recorded in the Audit Log.
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      ${opts.self ? "Not you? Someone has your password and your email. Change both now and tell your administrator." : "Not expected? Reset their two-step sign-in from Platform admin → Users and contact them."}
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: opts.self ? "You used a FORGE recovery link" : `${opts.who} used a FORGE recovery link`,
    html: emailShell("Recovery link used", body),
    text: `${opts.self ? "You" : opts.who} signed in to FORGE with a recovery link at ${opts.at} (UTC). It is recorded in the Audit Log.`,
  });
}

/** BL-STAB-8b-3 — the link to the new address: click it and the account moves to it. */
export async function sendEmailChangeConfirmEmail(opts: { to: string; token: string; currentEmail: string }): Promise<void> {
  const url = `${appBaseUrl()}/confirm-email?token=${encodeURIComponent(opts.token)}&email=${encodeURIComponent(opts.to)}`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Confirm your new email address</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      The FORGE account for <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.currentEmail)}</strong> asked to move to this address. Click the button to confirm. Nothing changes until you do; the link expires in 24 hours.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Confirm new address</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      If the button doesn't work, paste this URL in your browser:<br/>
      <span style="color:${EMAIL_HEX.muted};word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:${EMAIL_HEX.muted};">
      Didn't ask for this? Ignore this email and nothing changes.
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: "Confirm your new FORGE email address",
    html: emailShell("Confirm your new email address", body),
    text: `The FORGE account for ${opts.currentEmail} asked to move to this address. Confirm by visiting: ${url}\n\nNothing changes until you do; the link expires in 24 hours. If you didn't ask for this, ignore this email.`,
  });
}

/** BL-STAB-8b-3 — the old address is told: a change was requested, or it went through. */
export async function sendEmailChangeNoticeEmail(opts: { to: string; newEmail: string; confirmed: boolean }): Promise<void> {
  const url = `${appBaseUrl()}/settings/security`;
  const headline = opts.confirmed ? "Your FORGE email address changed" : "A change of email address was requested";
  const line = opts.confirmed
    ? `Your FORGE account now signs in as <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.newEmail)}</strong>, and every open session was signed out. This address no longer opens the account.`
    : `Someone signed in to your FORGE account and asked to move it to <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.newEmail)}</strong>. Nothing changes until that inbox confirms within 24 hours. If this was you, there is nothing to do.`;
  const action = opts.confirmed
    ? "If this was not you, contact your administrator at once: they can reset your two-step sign-in and your password."
    : `If this was not you, cancel it under Settings → Security (${url}) and change your password.`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">${headline}</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">${line}</p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">${escapeHtml(action)}</p>
  `;
  await sendEmail({
    to: opts.to,
    subject: headline,
    html: emailShell(headline, body),
    text: `${headline}. ${line.replace(/<[^>]+>/g, "")}\n\n${action}`,
  });
}

export function emailConfigured(): boolean {
  return !!apiKey;
}

/**
 * BL-AUTH-DOMAIN — ask the platform admins to approve a cross-domain
 * invitation. Only superadmins receive this; tenant admins cannot
 * approve it.
 */
export async function sendCrossDomainApprovalEmail(opts: {
  to: string;
  inviteeEmail: string;
  targetOrganizationName: string;
  homeOrganizationName: string | null;
  requestedBy: string;
}): Promise<void> {
  const url = `${baseUrl()}/admin`;
  const home = opts.homeOrganizationName
    ? `their email domain belongs to <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.homeOrganizationName)}</strong>`
    : "their email domain is not owned by any tenant on Forge";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:${EMAIL_HEX.ink};">Approval needed: cross-domain invitation</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${EMAIL_HEX.muted};">
      ${escapeHtml(opts.requestedBy)} invited <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.inviteeEmail)}</strong>
      to join <strong style="color:${EMAIL_HEX.ink};">${escapeHtml(opts.targetOrganizationName)}</strong>, but ${home}.
      By default people may only join the tenant that owns their email domain, so this invitation is on hold
      until a platform admin approves it. The invitee has not been contacted.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:3px;background:${EMAIL_HEX.accent};color:${EMAIL_HEX.card};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Review the request</a>
    </p>
    <p style="margin:0;font-size:12px;color:${EMAIL_HEX.muted};">
      Platform admin &rarr; Organizations &rarr; Cross-domain approvals. Approving sends the invitation;
      &ldquo;Approve and allow domain&rdquo; also lets that domain into the tenant without further approvals.
      Denying revokes the invitation.
    </p>
  `;
  await sendEmail({
    to: opts.to,
    subject: `Approval needed: ${opts.inviteeEmail} → ${opts.targetOrganizationName}`,
    html: emailShell("Approval needed", body),
    text: `${opts.requestedBy} invited ${opts.inviteeEmail} to join ${opts.targetOrganizationName}. The invitee's email domain is ${opts.homeOrganizationName ? `owned by ${opts.homeOrganizationName}` : "not owned by any tenant"}, so the invitation is on hold until a platform admin approves it. Review: ${url}`,
  });
}

/**
 * BL-AIP-3 — one notification from the rules engine (immediate
 * frequency, email channel). Throws on provider failure so the
 * dispatcher can record the error on the delivery row.
 */
export async function sendRuleNotificationEmail(opts: {
  to: string;
  subject: string;
  body?: string;
  linkPath?: string;
  ruleName: string;
}): Promise<void> {
  const built = buildRuleNotificationEmail({ ...opts, appUrl: baseUrl() });
  await sendEmail({
    to: opts.to,
    subject: built.subject,
    html: emailShell(built.subject, built.html),
    text: built.text,
  });
}

/** BL-AIP-3 — a daily / weekly digest for a batched-frequency rule. */
export async function sendDigestEmail(opts: {
  to: string;
  ruleName: string;
  count: number;
  cadence: "daily" | "weekly";
  nextActions?: { title: string; pursuit: string; href: string }[];
}): Promise<void> {
  const built = buildDigestEmail({ ...opts, appUrl: baseUrl() });
  await sendEmail({
    to: opts.to,
    subject: built.subject,
    html: emailShell(built.subject, built.html),
    text: built.text,
  });
}
