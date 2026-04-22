"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function SsoButtons({
  callbackUrl,
  mode = "sign-in",
}: {
  callbackUrl?: string;
  mode?: "sign-in" | "sign-up";
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function onClick(provider: "google" | "microsoft-entra-id") {
    setLoading(provider);
    try {
      await signIn(provider, { callbackUrl: callbackUrl ?? "/" });
    } catch {
      setLoading(null);
    }
  }

  const verb = mode === "sign-up" ? "Continue" : "Sign in";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onClick("google")}
        disabled={loading !== null}
        className="aur-btn aur-btn-ghost flex w-full items-center justify-center gap-3 py-3 text-sm disabled:opacity-60"
      >
        <GoogleIcon />
        <span>
          {loading === "google" ? "Redirecting…" : `${verb} with Google`}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onClick("microsoft-entra-id")}
        disabled={loading !== null}
        className="aur-btn aur-btn-ghost flex w-full items-center justify-center gap-3 py-3 text-sm disabled:opacity-60"
      >
        <MicrosoftIcon />
        <span>
          {loading === "microsoft-entra-id"
            ? "Redirecting…"
            : `${verb} with Microsoft`}
        </span>
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}
