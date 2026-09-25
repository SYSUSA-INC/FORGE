/**
 * BL-AUTH-INVITE — deliver an invite or a reset link and tell the truth
 * about it.
 *
 * `sendEmail` deliberately no-ops without RESEND_API_KEY so the app keeps
 * working in stub mode, but the admin-facing actions used to treat that
 * as success. These helpers return `{ emailSent, warning }` so the
 * calling action can hand the link to the admin instead of leaving the
 * invitee with nothing.
 */
import "server-only";

import { inviteUrl, passwordResetUrl } from "@/lib/app-url";
import {
  emailConfigured,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "@/lib/email";
import { log } from "@/lib/log";

export const EMAIL_NOT_CONFIGURED_WARNING =
  "Email delivery is not configured on this deployment (RESEND_API_KEY), so nothing was sent. Copy the link below and send it to the person yourself.";

export type Delivery = { emailSent: boolean; warning?: string };

export async function deliverInvite(input: {
  to: string;
  inviteId: string;
  token: string;
  organizationName: string;
  inviterName: string;
  role: string;
  tag: string;
}): Promise<Delivery & { inviteUrl: string }> {
  const url = inviteUrl(input.inviteId, input.token);
  if (!emailConfigured()) {
    log.warn(input.tag, "invite created but email is not configured", {
      inviteId: input.inviteId,
    });
    return { inviteUrl: url, emailSent: false, warning: EMAIL_NOT_CONFIGURED_WARNING };
  }
  try {
    await sendInviteEmail({
      to: input.to,
      inviteId: input.inviteId,
      token: input.token,
      organizationName: input.organizationName,
      inviterName: input.inviterName,
      role: input.role,
    });
    return { inviteUrl: url, emailSent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(input.tag, "sendInviteEmail failed", { error: err, inviteId: input.inviteId });
    return {
      inviteUrl: url,
      emailSent: false,
      warning: `The invitation was created but the email could not be sent (${message}). Copy the link below and send it to the person yourself.`,
    };
  }
}

export async function deliverPasswordReset(input: {
  to: string;
  token: string;
  tag: string;
}): Promise<Delivery & { resetUrl: string }> {
  const url = passwordResetUrl(input.to, input.token);
  if (!emailConfigured()) {
    log.warn(input.tag, "reset link issued but email is not configured", { to: input.to });
    return { resetUrl: url, emailSent: false, warning: EMAIL_NOT_CONFIGURED_WARNING };
  }
  try {
    await sendPasswordResetEmail(input.to, input.token);
    return { resetUrl: url, emailSent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(input.tag, "sendPasswordResetEmail failed", { error: err });
    return {
      resetUrl: url,
      emailSent: false,
      warning: `The reset link was issued but the email could not be sent (${message}). Copy the link below and send it to the person yourself.`,
    };
  }
}
