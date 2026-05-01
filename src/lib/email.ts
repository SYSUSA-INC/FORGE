import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "Forge <noreply@sysgov.com>";

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
    console.warn(
      `[email] RESEND_API_KEY not set — would have sent "${opts.subject}" to ${opts.to}`,
    );
    return;
  }
  await getClient().emails.send({
    from: opts.from ?? from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });
}

function baseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return "https://www.sysgov.com";
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "https://www.sysgov.com";
}

function emailShell(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf7;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#111a2c;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
            <tr>
              <td style="padding:0;">
                <div style="height:2px;background:linear-gradient(90deg,#2DD4BF,#34D399 55%,#EC4899);"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
                  <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#2DD4BF,#EC4899);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px;">F</div>
                  <div>
                    <div style="font-weight:600;font-size:14px;color:#e6edf7;">FORGE</div>
                    <div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#94a3b8;">Proposal Ops</div>
                  </div>
                </div>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#64748b;">
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
  const url = `${baseUrl()}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">Verify your email</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      Welcome to Forge. Confirm this is your email address by clicking the button below.
      The link expires in 24 hours.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Verify email</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn't work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:#64748b;">
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
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">Reset your password</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      We received a request to reset your Forge password. Click the button below to choose a new one.
      The link expires in 1 hour.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Reset password</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn't work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:#64748b;">
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
  const url = `${baseUrl()}/sign-up?invite=${encodeURIComponent(
    opts.token,
  )}&id=${encodeURIComponent(opts.inviteId)}`;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">You&#39;re invited to Forge</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      ${escapeHtml(opts.inviterName)} has invited you to join <strong style="color:#e6edf7;">${escapeHtml(
        opts.organizationName,
      )}</strong> on Forge as <strong style="color:#e6edf7;">${escapeHtml(
        opts.role,
      )}</strong>. Click below to create your account.
      The link expires in 7 days.
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Accept invitation</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
    </p>
    <p style="margin:24px 0 0 0;font-size:12px;color:#64748b;">
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
    ? ` You're assigned to <strong style="color:#e6edf7;">${escapeHtml(
        opts.sectionTitle,
      )}</strong>.`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">${escapeHtml(
      opts.reviewColor,
    )} review assigned</h1>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      ${escapeHtml(opts.starterName)} started a ${escapeHtml(
        opts.reviewColor,
      )} review on <strong style="color:#e6edf7;">${escapeHtml(
        opts.proposalTitle,
      )}</strong> and added you as a reviewer.${scope} ${escapeHtml(due)}
    </p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
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
    ? ` on <strong style="color:#e6edf7;">${escapeHtml(opts.sectionTitle)}</strong>`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">${escapeHtml(
      opts.authorName,
    )} mentioned you</h1>
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      In a ${escapeHtml(opts.reviewColor)} review comment${where} on
      <strong style="color:#e6edf7;">${escapeHtml(opts.proposalTitle)}</strong>:
    </p>
    <blockquote style="margin:0 0 24px 0;padding:12px 16px;border-left:2px solid #2DD4BF;background:rgba(45,212,191,0.06);font-size:14px;line-height:1.55;color:#e6edf7;">
      ${escapeHtml(opts.commentBody.slice(0, 600))}${opts.commentBody.length > 600 ? "…" : ""}
    </blockquote>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
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
    ? `<blockquote style="margin:0 0 24px 0;padding:12px 16px;border-left:2px solid #2DD4BF;background:rgba(45,212,191,0.06);font-size:14px;line-height:1.55;color:#e6edf7;">
        ${escapeHtml(opts.summary.slice(0, 600))}${opts.summary.length > 600 ? "…" : ""}
      </blockquote>`
    : "";
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">${escapeHtml(
      opts.reviewColor,
    )} review closed — ${escapeHtml(opts.verdict)}</h1>
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      ${escapeHtml(opts.closerName)} closed the ${escapeHtml(opts.reviewColor)} review on
      <strong style="color:#e6edf7;">${escapeHtml(opts.proposalTitle)}</strong> with a verdict of
      <strong style="color:#e6edf7;">${escapeHtml(opts.verdict)}</strong>.
    </p>
    ${summarySnippet}
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Open review</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If the button doesn&#39;t work, paste this URL in your browser:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
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
    ? `<div style="margin:20px 0;padding:14px 16px;border-left:3px solid #2DD4BF;background:rgba(45,212,191,0.06);border-radius:6px;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#2DD4BF;margin-bottom:6px;">Note from ${escapeHtml(opts.senderName)}</div>
        <div style="font-size:13px;color:#e6edf7;line-height:1.5;">${escapeHtml(opts.note)}</div>
      </div>`
    : "";
  const synopsisBlock = opts.synopsis
    ? `<div style="margin-top:10px;font-size:13px;line-height:1.55;color:#94a3b8;">${escapeHtml(opts.synopsis).slice(0, 800)}</div>`
    : "";
  const greeting = opts.reviewerName
    ? `Hi ${escapeHtml(opts.reviewerName.split(" ")[0] ?? opts.reviewerName)},`
    : "Hi,";

  const opportunityCard = `
    <div style="margin:0;padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02);">
      <div style="font-size:15px;font-weight:600;color:#e6edf7;margin-bottom:8px;">${escapeHtml(opts.opportunityTitle)}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:11px;color:#94a3b8;width:100%;">
        <tr>
          <td style="padding:2px 0;width:80px;">Agency</td>
          <td style="padding:2px 0;color:#e6edf7;">${escapeHtml(opts.agency || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">NAICS</td>
          <td style="padding:2px 0;color:#e6edf7;">${escapeHtml(opts.naics || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Set-aside</td>
          <td style="padding:2px 0;color:#e6edf7;">${escapeHtml(opts.setAside || "—")}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;">Due</td>
          <td style="padding:2px 0;color:#e6edf7;">${escapeHtml(opts.dueDate || "—")}</td>
        </tr>
      </table>
      ${synopsisBlock}
    </div>
  `;

  const button = `
    <a href="${url}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#2DD4BF;color:#0b1220;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.02em;">Review opportunity</a>
  `;

  // Render the bullet structure as a styled list. Email clients don't
  // honor list-item flex/grid, so we use plain <ul><li> + inline styles.
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#e6edf7;">Review request</h1>
    <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      ${greeting}
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#94a3b8;">
      <strong style="color:#e6edf7;">${escapeHtml(opts.senderName)}</strong>
      from ${escapeHtml(opts.organizationName)} would like your quick read on this opportunity:
    </p>
    ${noteBlock}
    <ul style="margin:8px 0 0 0;padding-left:20px;list-style-type:disc;color:#94a3b8;font-size:14px;line-height:1.55;">
      <li style="margin-bottom:14px;">
        ${opportunityCard}
      </li>
      <li style="margin-bottom:14px;">
        Please open the link below to recommend
        <strong style="color:#34D399;">Bid</strong>,
        <strong style="color:#EC4899;">No-bid</strong>, or
        <strong style="color:#e6edf7;">More info</strong>:
        <ul style="margin:10px 0 0 0;padding-left:20px;list-style-type:circle;">
          <li style="margin:0;">
            <div style="margin:4px 0 8px 0;">${button}</div>
            <div style="font-size:12px;color:#64748b;line-height:1.5;">
              Magic-link button, 72-hour TTL token. The link is good for 72 hours.
            </div>
          </li>
        </ul>
      </li>
    </ul>
    <p style="margin:24px 0 0 0;font-size:12px;color:#64748b;">
      If the button doesn&rsquo;t work, paste this URL:<br/>
      <span style="color:#94a3b8;word-break:break-all;">${url}</span>
    </p>
  `;

  // From line: platform brand. The sender's identity is conveyed in
  // the body ("[Sender Name] from [Sender Company] would like..."),
  // and Reply-To routes replies to the human's real address.
  const fromAddr = process.env.EMAIL_FROM_ADDRESS ?? "noreply@sysgov.com";
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
      `\n\nMagic-link button, 72-hour TTL token. The link is good for 72 hours.`,
  });
}
