"use client";

import { useState } from "react";

/**
 * BL-AUTH-INVITE — what an admin sees after creating an invite or a
 * reset link: whether the email went out, and the link itself with a
 * copy button so they can hand it over by chat, ticket or phone when
 * email delivery is not configured or the message did not arrive.
 *
 * BL-AUTH-DOMAIN — with `url` null the invite is on hold for platform
 * approval: there is no link to copy yet, so the notice says who has to
 * act instead.
 */
export function InviteLinkNotice({
  url,
  emailSent,
  warning,
  sentTo,
  kind = "invite",
}: {
  url: string | null;
  emailSent: boolean;
  warning?: string;
  sentTo: string;
  kind?: "invite" | "reset";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permissions): the link is
      // still selectable in the input below.
    }
  }

  const noun = kind === "reset" ? "Reset link" : "Invitation";

  if (!url) {
    return (
      <div className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 font-mono text-[11px]">
        <div className="text-gold">
          {noun} for {sentTo} is on hold until a platform admin approves it.
        </div>
        <div className="mt-1 text-[10px] text-muted">
          {warning ??
            "The invitee has not been emailed. Once approved, they receive the invitation and it appears here with a link."}
        </div>
      </div>
    );
  }

  const tone = emailSent
    ? "border-emerald/40 bg-emerald/10"
    : "border-gold/40 bg-gold/10";

  return (
    <div className={`rounded-md border px-3 py-2 font-mono text-[11px] ${tone}`}>
      <div className={emailSent ? "text-emerald" : "text-gold"}>
        {emailSent
          ? `${noun} emailed to ${sentTo}.`
          : (warning ?? `${noun} created for ${sentTo}; the email was not sent.`)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="aur-input flex-1 text-[10px]"
          aria-label={`${noun} link`}
        />
        <button type="button" onClick={copy} className="aur-btn text-[11px]">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {!emailSent ? (
        <div className="mt-1 text-[10px] text-muted">
          The link works for 7 days (invites) or 1 hour (reset links) and is
          personal to {sentTo}.
        </div>
      ) : null}
    </div>
  );
}
