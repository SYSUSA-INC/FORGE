/**
 * BL-AUTH-INVITE — shared result shapes for invite and reset actions.
 *
 * Every action that creates an invite or a reset token now hands the
 * link back to the admin, and says honestly whether an email went out.
 * Before this, `sendEmail` silently skipped when RESEND_API_KEY was
 * unset and the UI reported "Invitation sent" — the invitee never got
 * the only link that lets them set a password.
 *
 * BL-AUTH-DOMAIN — a cross-domain invite is created on hold: it exists,
 * but no link is issued and nothing is emailed to the invitee until a
 * platform admin approves it. `inviteUrl` is null and `pendingApproval`
 * is true in that case.
 *
 * Plain types: "use server" modules may re-export types but not
 * constants, so this lives beside them.
 */

export type InviteResult =
  | {
      ok: true;
      inviteId: string;
      /** The exact sign-up link the email carries; share it manually if needed. Null while on hold. */
      inviteUrl: string | null;
      emailSent: boolean;
      /** Set when the email did not go out and the admin should share the link. */
      warning?: string;
      /** BL-AUTH-DOMAIN — waiting for a platform admin; no link exists yet. */
      pendingApproval?: boolean;
    }
  | { ok: false; error: string };

export type ResetLinkResult =
  | {
      ok: true;
      resetUrl: string;
      emailSent: boolean;
      warning?: string;
    }
  | { ok: false; error: string };
