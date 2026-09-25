"use client";

import { useState } from "react";

/**
 * BL-AUTH-INVITE — what an admin sees after creating an invite or a
 * reset link: whether the email went out, and the link itself with a
 * copy button so they can hand it over by chat, ticket or phone when
 * email delivery is not configured or the message did not arrive.
 */
export function InviteLinkNotice({
  url,
  emailSent,
  warning,
  sentTo,
  kind = "invite",
}: {
  url: string;
  emailSent: boolean;
  warning?: string;
  sentTo: string;
  kind?: "invite" | "reset";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
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
