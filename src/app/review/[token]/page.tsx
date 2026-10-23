import { getReviewRequestByTokenAction } from "@/app/(app)/opportunities/[id]/review/actions";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function PublicReviewPage({
  params,
}: {
  params: { token: string };
}) {
  const res = await getReviewRequestByTokenAction(params.token);

  if (!res.ok) {
    return (
      <main className="min-h-screen bg-canvas text-text">
        <div className="mx-auto max-w-2xl p-8">
          <Brand />
          <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <div className="font-display text-xl font-semibold text-rose-300">
              Review link can&rsquo;t be opened
            </div>
            <p className="mt-2 font-mono text-[12px] text-muted">
              {res.error}
            </p>
            <p className="mt-4 font-body text-[13px] leading-[1.5] text-muted">
              If this is unexpected, ask the sender to resend the request — or
              sign in to FORGE if you have an account.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas text-text">
      <div className="mx-auto max-w-2xl p-8">
        <Brand />
        <ReviewClient
          token={params.token}
          state={res}
        />
      </div>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div
        className="aur-brand-mark grid h-10 w-10 place-items-center rounded-lg font-display text-lg font-medium text-white"
      >
        F
      </div>
      <div>
        <div className="font-display text-base font-semibold text-text">FORGE</div>
        <div className="font-mono text-[10px] uppercase tracking-label text-muted">
          Opportunity review
        </div>
      </div>
    </div>
  );
}
