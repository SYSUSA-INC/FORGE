import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { companyMemberSecurity } from "@/lib/company-security";
import { companyResetBlocker, memberState, methodsLabel } from "@/lib/company-security-logic";
import { mfaEnforcementNow } from "@/lib/session-policy";
import { MemberSecurityTable, type MemberSecurityView } from "./MemberSecurityTable";

export const dynamic = "force-dynamic";

/**
 * BL-MFA-ADMIN — Administration → Security (owner, 2026-11-07): two-step
 * sign-in is required for everyone; a company admin sees each member's
 * methods and can reset a member who lost their device.
 */
export default async function CompanySecurityPage() {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const rows = await companyMemberSecurity(organizationId);
  const enforcement = mfaEnforcementNow();
  const view: MemberSecurityView[] = rows.map((r) => ({
    userId: r.userId,
    name: r.name || r.email,
    email: r.email,
    role: r.role,
    status: r.status,
    isSuperadmin: r.isSuperadmin,
    methods: methodsLabel(r),
    setUp: memberState(r) === "set_up",
    recoveryCodesLeft: r.recoveryCodesLeft,
    lastSecondStepAt: r.lastSecondStepAt,
    blocker: companyResetBlocker(actor.id, r),
  }));
  const active = view.filter((v) => v.status === "active");
  const setUp = active.filter((v) => v.setUp).length;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Security"
        subtitle="Two-step sign-in for everyone in your company: who has set up what, and a reset for someone who lost their device."
        meta={[
          { label: "Active members", value: String(active.length) },
          { label: "Set up", value: String(setUp), accent: setUp === active.length && active.length > 0 ? "emerald" : undefined },
          { label: "Not set up yet", value: String(active.length - setUp), accent: active.length - setUp > 0 ? "gold" : undefined },
        ]}
      />
      <Panel title="Two-step sign-in" eyebrow={enforcement.on ? "Required for everyone" : "Switched off"}>
        {enforcement.on ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">
            Everyone in this company signs in with a password (or Google / Microsoft) and then a passkey or an authenticator app. Someone who hasn&apos;t set it up yet does so at their next sign-in, before anything opens. Someone who can&apos;t use either can email themselves a recovery link from the sign-in page; use <span className="text-text">Reset second step</span> below only when that can&apos;t work for them.
          </p>
        ) : (
          <p className="font-body text-[13px] leading-[1.5] text-red">
            Two-step sign-in is switched off on this deployment ({enforcement.reason === "env_off" ? "MFA_ENFORCEMENT is off" : "FORGE_SECRET_KEYS is not set"}): a password alone signs people in. Ask your platform administrator to turn it back on.
          </p>
        )}
      </Panel>
      <div className="mt-4">
        <MemberSecurityTable rows={view} />
      </div>
    </>
  );
}
