import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth } from "@/lib/auth-helpers";
import { getMfaStatus } from "@/lib/mfa-store";
import { safeQuery } from "@/lib/schema-resilience";
import { SecurityPanel } from "./SecurityPanel";

export const dynamic = "force-dynamic";

/**
 * BL-STAB-8a-1 — Settings → Security: the signed-in person's second
 * factors and recovery codes. User-scoped, not tenant-scoped: it reads
 * nothing but the person's own rows.
 */
export default async function SecuritySettingsPage({ searchParams }: { searchParams: { low?: string } }) {
  const user = await requireAuth();
  const status = await safeQuery(() => getMfaStatus(user.id), { factors: [], enrolledAt: null, recoveryCodesLeft: 0, available: false }, { tag: "settings.security" });
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Security"
        subtitle="Two-step sign-in: a passkey or an authenticator app, and recovery codes for when you lose them."
        meta={[
          { label: "Authenticators", value: String(status.factors.length) },
          { label: "Recovery codes left", value: String(status.recoveryCodesLeft) },
          { label: "Enrolled", value: status.enrolledAt ? status.enrolledAt.toISOString().slice(0, 10) : "—" },
        ]}
      />
      {searchParams.low === "1" ? (
        <p className="mb-4 rounded-md border border-brass/40 bg-brass/10 px-3 py-2 font-body text-[13px] text-text">
          You are running low on recovery codes. Replace them now so a lost phone does not lock you out.
        </p>
      ) : null}
      <SecurityPanel
        email={user.email ?? ""}
        factors={status.factors.map((f) => ({ id: f.id, kind: f.kind, label: f.label, createdAt: f.createdAt.toISOString().slice(0, 10), lastUsedAt: f.lastUsedAt ? f.lastUsedAt.toISOString().slice(0, 10) : null }))}
        recoveryCodesLeft={status.recoveryCodesLeft}
        available={status.available}
      />
    </>
  );
}
