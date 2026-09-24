/**
 * BL-AIP-3 — the emails the notification rules engine sends.
 *
 * Pure builders (no Resend, no env) so the wording and escaping are
 * unit-tested; `src/lib/email.ts` wraps them in the shared shell and
 * sends. Until this existed the engine's "email" channel recorded a
 * delivery as sent and never sent anything.
 */

export type BuiltEmail = { subject: string; html: string; text: string };

const SUBJECT_MAX = 120;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Join the app origin and an in-app path without doubling slashes. */
export function joinAppUrl(appUrl: string, path: string | undefined): string {
  const base = appUrl.replace(/\/+$/, "");
  const p = (path ?? "/notifications").trim() || "/notifications";
  return `${base}${p.startsWith("/") ? p : `/${p}`}`;
}

function footer(ruleName: string): { html: string; text: string } {
  return {
    html: `<p style="margin:24px 0 0 0;font-size:12px;color:#64748b;line-height:1.5;">Sent by the notification rule &ldquo;${escapeHtml(ruleName)}&rdquo;. Manage rules under Operations Management &rarr; Notification rules.</p>`,
    text: `Sent by the notification rule "${ruleName}". Manage rules under Operations Management → Notification rules.`,
  };
}

function openLink(url: string): string {
  return `<p style="margin:20px 0 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2DD4BF;color:#0b1220;font-weight:600;text-decoration:none;font-size:14px;">Open in FORGE</a></p>`;
}

/** One immediate-frequency notification. */
export function buildRuleNotificationEmail(input: {
  subject: string;
  body?: string;
  linkPath?: string;
  ruleName: string;
  appUrl: string;
}): BuiltEmail {
  const subject = `[FORGE] ${input.subject.trim()}`.slice(0, SUBJECT_MAX);
  const url = joinAppUrl(input.appUrl, input.linkPath);
  const body = (input.body ?? "").trim();
  const f = footer(input.ruleName);
  const html = [
    `<h1 style="margin:0 0 12px 0;font-size:18px;color:#e6edf7;">${escapeHtml(input.subject.trim())}</h1>`,
    body ? `<p style="margin:0;font-size:14px;line-height:1.55;color:#94a3b8;">${escapeHtml(body)}</p>` : "",
    openLink(url),
    f.html,
  ]
    .filter(Boolean)
    .join("\n");
  const text = [input.subject.trim(), body, `Open in FORGE: ${url}`, f.text]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}

/** A daily / weekly digest for a batched-frequency rule. */
export function buildDigestEmail(input: {
  ruleName: string;
  count: number;
  cadence: "daily" | "weekly";
  appUrl: string;
}): BuiltEmail {
  const n = Math.max(0, Math.floor(input.count));
  const noun = n === 1 ? "update" : "updates";
  const headline = `${input.ruleName} — ${n} ${input.cadence} ${noun}`;
  const subject = `[FORGE] ${headline}`.slice(0, SUBJECT_MAX);
  const url = joinAppUrl(input.appUrl, "/notifications");
  const f = footer(input.ruleName);
  const html = [
    `<h1 style="margin:0 0 12px 0;font-size:18px;color:#e6edf7;">${escapeHtml(headline)}</h1>`,
    `<p style="margin:0;font-size:14px;line-height:1.55;color:#94a3b8;">Your ${input.cadence} digest has ${n} ${noun} waiting in your FORGE inbox.</p>`,
    openLink(url),
    f.html,
  ].join("\n");
  const text = [headline, `Your ${input.cadence} digest has ${n} ${noun} waiting in your FORGE inbox.`, `Open in FORGE: ${url}`, f.text].join("\n\n");
  return { subject, html, text };
}
