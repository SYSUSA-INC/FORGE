import { requireAuth } from "@/lib/auth-helpers";
import { listUserEmailAccounts } from "@/lib/email-oauth";
import { EmailSettingsClient } from "./EmailSettingsClient";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const user = await requireAuth();
  const accounts = await listUserEmailAccounts(user.id);

  const stub = {
    googleClientConfigured:
      Boolean(process.env.GOOGLE_EMAIL_CLIENT_ID) ||
      Boolean(process.env.GOOGLE_CLIENT_ID),
    encryptionConfigured: Boolean(process.env.EMAIL_ENCRYPTION_KEY),
  };

  return (
    <EmailSettingsClient
      accounts={accounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        emailAddress: a.emailAddress,
        isDefault: a.isDefault,
        connectedAt: a.connectedAt.toISOString(),
        lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
        lastError: a.lastError,
      }))}
      googleClientConfigured={stub.googleClientConfigured}
      encryptionConfigured={stub.encryptionConfigured}
      flashConnected={Boolean(searchParams.connected)}
      flashError={searchParams.error ?? ""}
    />
  );
}
