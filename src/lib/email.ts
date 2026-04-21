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
}): Promise<void> {
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — would have sent "${opts.subject}" to ${opts.to}`,
    );
    return;
  }
  await getClient().emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

function baseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
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
      <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:linear-gradient(135deg,#2DD4BF,#34D399);color:#0b1220;text-decoration:none;font-weight:600;font-size:14px;">Verify email</a>
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
      <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:linear-gradient(135deg,#2DD4BF,#34D399);color:#0b1220;text-decoration:none;font-weight:600;font-size:14px;">Reset password</a>
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
