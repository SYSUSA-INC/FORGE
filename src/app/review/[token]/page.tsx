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
      <main className="min-h-screen bg-[#0b1220] text-text">
        <div className="mx-auto max-w-2xl p-8">
          <Brand />
          <div className="mt-8 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <div className="font-display text-xl font-semibold text-rose-300">
              Review link can&rsquo;t be opened
            </div>
            <p className="mt-2 font-mono text-[12px] text-muted">
              {res.error}
            </p>
            <p className="mt-4 font-mono text-[11px] text-muted">
              If this is unexpected, ask the sender to resend the request — or
              sign in to FORGE if you have an account.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b1220] text-text">
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
        className="grid h-10 w-10 place-items-center rounded-lg font-display text-lg font-bold text-white"
        style={{
          background: "linear-gradient(135deg, #2DD4BF, #EC4899)",
        }}
      >
        F
      </div>
      <div>
        <div className="font-display text-base font-semibold text-text">FORGE</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Opportunity review
        </div>
      </div>
    </div>
  );
}
