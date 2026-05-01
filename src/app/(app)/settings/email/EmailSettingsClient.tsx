"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import {
  disconnectEmailAccountAction,
  setDefaultEmailAccountAction,
} from "./actions";

type Account = {
  id: string;
  provider: "google" | "microsoft";
  emailAddress: string;
  isDefault: boolean;
  connectedAt: string;
  lastUsedAt: string | null;
  lastError: string;
};

const PROVIDER_LABELS: Record<Account["provider"], string> = {
  google: "Google",
  microsoft: "Microsoft",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function EmailSettingsClient({
  accounts,
  googleClientConfigured,
  encryptionConfigured,
  flashConnected,
  flashError,
}: {
  accounts: Account[];
  googleClientConfigured: boolean;
  encryptionConfigured: boolean;
  flashConnected: boolean;
  flashError: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(flashError || null);
  const [notice, setNotice] = useState<string | null>(
    flashConnected ? "Account connected." : null,
  );

  const liveReady = googleClientConfigured && encryptionConfigured;
  const defaultAccount = accounts.find((a) => a.isDefault) ?? null;

  function disconnect(accountId: string, label: string) {
    if (
      !window.confirm(
        `Disconnect ${label}? Outbound mail will fall back to the platform sender (noreply@sysgov.com) until you re-connect.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await disconnectEmailAccountAction(accountId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`Disconnected ${label}.`);
      router.refresh();
    });
  }

  function makeDefault(accountId: string, label: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await setDefaultEmailAccountAction(accountId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${label} is now the default sender.`);
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings · Outbound email"
        title="Email senders"
        subtitle="Connect a personal or shared mailbox so outbound review-request emails come from a real person at your organization, not the platform default."
        meta={[
          {
            label: "Connected",
            value: String(accounts.length).padStart(2, "0"),
          },
          {
            label: "Default sender",
            value: defaultAccount ? defaultAccount.emailAddress : "—",
          },
        ]}
      />

      {!liveReady ? (
        <Panel title="Setup required" accent="hazard">
          <ul className="font-mono text-[12px] leading-relaxed text-amber-200 space-y-1">
            {!googleClientConfigured ? (
              <li>
                <strong>GOOGLE_EMAIL_CLIENT_ID</strong> /{" "}
                <strong>GOOGLE_EMAIL_CLIENT_SECRET</strong> not set on Vercel.
                Re-use existing Google OAuth credentials, but add the
                <code className="px-1">https://www.googleapis.com/auth/gmail.send</code>{" "}
                scope.
              </li>
            ) : null}
            {!encryptionConfigured ? (
              <li>
                <strong>EMAIL_ENCRYPTION_KEY</strong> not set. Generate one
                with{" "}
                <code className="px-1">openssl rand -hex 32</code> and add it
                to Vercel (Production + Preview + Development).
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      {error ? (
        <div className="aur-card border-rose/40 bg-rose/10 px-4 py-3 font-mono text-[12px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="aur-card border-emerald/40 bg-emerald/10 px-4 py-3 font-mono text-[12px] text-emerald">
          {notice}
        </div>
      ) : null}

      <Panel
        title="Connected accounts"
        eyebrow="Mailboxes you've authorized FORGE to send from"
        actions={
          <a
            href="/api/email-oauth/google/connect"
            className="aur-btn aur-btn-primary text-[11px]"
            title={
              liveReady
                ? "Connect a Google mailbox via OAuth."
                : "Configure env vars first."
            }
          >
            + Connect Google
          </a>
        }
      >
        {accounts.length === 0 ? (
          <p className="font-body text-[14px] leading-relaxed text-muted">
            No accounts connected. Click <strong>Connect Google</strong> to
            authorize FORGE to send mail through your Gmail account. Until you
            connect one, outbound review-request emails go through the
            platform default address (<code>noreply@sysgov.com</code>).
          </p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => {
              const label = `${PROVIDER_LABELS[a.provider]} · ${a.emailAddress}`;
              return (
                <li
                  key={a.id}
                  className="aur-card-elevated flex items-start justify-between gap-4 px-4 py-3"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-teal-300">
                        {PROVIDER_LABELS[a.provider]}
                      </span>
                      {a.isDefault ? (
                        <span className="aur-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/30">
                          default
                        </span>
                      ) : null}
                    </div>
                    <div className="font-body text-[14px] text-foreground">
                      {a.emailAddress}
                    </div>
                    <div className="font-mono text-[11px] text-muted">
                      Connected {formatDate(a.connectedAt)} · Last used{" "}
                      {formatDate(a.lastUsedAt)}
                    </div>
                    {a.lastError ? (
                      <div className="font-mono text-[11px] text-rose">
                        Last error: {a.lastError}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!a.isDefault ? (
                      <button
                        type="button"
                        onClick={() => makeDefault(a.id, label)}
                        disabled={pending}
                        className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
                      >
                        Make default
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => disconnect(a.id, label)}
                      disabled={pending}
                      className="aur-btn aur-btn-danger text-[11px] disabled:opacity-60"
                    >
                      Disconnect
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="How it works"
        eyebrow="What happens when you connect a mailbox"
      >
        <ol className="font-body text-[14px] leading-relaxed text-muted space-y-2 list-decimal pl-5">
          <li>
            <strong>You consent</strong> to FORGE on Google&apos;s OAuth screen
            with the <code>gmail.send</code> scope only. We never read your
            inbox.
          </li>
          <li>
            <strong>Tokens are encrypted at rest</strong> with AES-256-GCM
            using a server-side master key (<code>EMAIL_ENCRYPTION_KEY</code>).
            The plaintext access/refresh tokens never live in the database.
          </li>
          <li>
            <strong>Outbound review-request emails</strong> use your default
            connected account. Reviewers see the message from your real
            address — replies land in your inbox, not the platform&apos;s.
          </li>
          <li>
            <strong>You stay in control.</strong> Revoke any time at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer noopener"
              className="text-teal-300 underline"
            >
              myaccount.google.com/permissions
            </a>{" "}
            or click <em>Disconnect</em> above.
          </li>
        </ol>
      </Panel>
    </>
  );
}
