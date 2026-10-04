import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TRIAL_DAYS } from "@/lib/trial-logic";
import { RequestTrialForm } from "./RequestTrialForm";

export const dynamic = "force-dynamic";

/**
 * BL-AUTH-ABUSE Slice 2b — public Request-a-trial page. A request waits
 * for a platform admin; an approved one becomes a workspace with a
 * 14-day trial and an emailed admin invite.
 */
export default async function RequestTrialPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4 py-12">
      <div className="aur-card-elevated w-full max-w-md overflow-hidden">
        <div className="h-[2px] w-full" style={{ background: "var(--g-brand-bar)" }} />
        <div className="px-8 py-10">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Try FORGE for {TRIAL_DAYS} days</h1>
          <p className="mt-2 text-sm text-muted">
            Tell us who you are. We review every request and, once approved, email you an invitation to your own workspace. When the trial ends your
            work stays and editing carries on; AI features pause until you choose a plan.
          </p>
          <RequestTrialForm />
          <Link href="/sign-in" className="aur-btn aur-btn-ghost mt-6 flex w-full items-center justify-center py-3 text-sm">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
