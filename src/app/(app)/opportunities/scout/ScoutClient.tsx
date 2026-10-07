"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  SCOUT_RECOMMENDATION_LABELS,
  type ScoutCandidateView,
  type ScoutDecision,
  type ScoutProfileView,
  type ScoutRecommendation,
  type ScoutRunView,
  type ScoutTrack,
} from "@/lib/scout-logic";
import {
  decideScoutCandidateAction,
  runScoutNowAction,
  saveScoutProfileAction,
} from "./actions";

/** BL-AIP-7b — settings, the new finds with the scout's take, and the decided ones. */
export function ScoutClient({
  profile,
  candidates,
  decided,
  track,
  lastRun,
  isAdmin,
}: {
  profile: ScoutProfileView;
  candidates: ScoutCandidateView[];
  decided: ScoutCandidateView[];
  track: ScoutTrack;
  lastRun: ScoutRunView | null;
  isAdmin: boolean;
}) {
  return (
    <>
      <SettingsPanel profile={profile} lastRun={lastRun} track={track} isAdmin={isAdmin} />

      <section className="mb-6">
        <Panel
          title="New finds"
          eyebrow={
            candidates.length === 0
              ? "Nothing waiting"
              : `${candidates.length} waiting · best fit first`
          }
        >
          {candidates.length === 0 ? (
            <p className="font-body text-[13px] leading-relaxed text-muted">
              No new finds. The scout runs every night; an admin can run it now from the
              settings above. Finds you import become opportunities; the ones you dismiss are
              remembered so they are not shown again.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {candidates.map((c) => (
                <CandidateCard key={c.id} candidate={c} />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {decided.length > 0 ? (
        <section className="mb-6">
          <Panel title="Recently decided" eyebrow={trackLine(track)}>
            <ul className="flex flex-col gap-1.5">
              {decided.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2"
                >
                  <GradeMark grade={c.grade} />
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                      c.status === "imported"
                        ? "border-emerald/40 bg-emerald/10 text-emerald-300"
                        : "border-layer/15 bg-layer/[0.04] text-muted"
                    }`}
                  >
                    {c.status}
                  </span>
                  {c.opportunityId ? (
                    <Link
                      href={`/opportunities/${c.opportunityId}`}
                      className="min-w-0 truncate font-display text-[13px] text-text hover:underline"
                    >
                      {c.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate font-display text-[13px] text-text">{c.title}</span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
                    {c.recommendation ? `scout said ${SCOUT_RECOMMENDATION_LABELS[c.recommendation]}` : c.triageQueued ? "triage queued" : "not triaged"}
                    {" · "}fit {c.fitScore}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </>
  );
}

function trackLine(t: ScoutTrack): string {
  if (t.n === 0) return "No decisions yet";
  const acc = t.accuracy === null ? "no decisive call yet" : `${Math.round(t.accuracy * 100)}% of decisive calls matched you`;
  return `${t.imported} imported · ${t.dismissed} dismissed · ${acc}`;
}

function SettingsPanel({
  profile,
  lastRun,
  track,
  isAdmin,
}: {
  profile: ScoutProfileView;
  lastRun: ScoutRunView | null;
  track: ScoutTrack;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(profile.enabled);
  const [keywords, setKeywords] = useState(profile.keywords.join(", "));
  const [extraNaics, setExtraNaics] = useState(profile.extraNaics.join(", "));
  const [days, setDays] = useState(profile.postedDaysBack);
  const [saving, startSaving] = useTransition();
  const [running, startRunning] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function save() {
    setNote(null);
    startSaving(async () => {
      const res = await saveScoutProfileAction({ enabled, keywords, extraNaics, postedDaysBack: days });
      setNote(res.ok ? "Saved." : res.error);
      if (res.ok) router.refresh();
    });
  }

  function runNow() {
    setNote(null);
    startRunning(async () => {
      const res = await runScoutNowAction();
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      const s = res.summary;
      setNote(
        `Searched ${s.searches} · found ${s.found} · new ${s.created} · triaged ${s.triaged}` +
          (s.skippedGated ? ` · ${s.skippedGated} not triaged (gate)` : "") +
          (s.errors ? ` · ${s.errors} error${s.errors === 1 ? "" : "s"}` : "") +
          (s.note ? ` — ${s.note}` : ""),
      );
      router.refresh();
    });
  }

  const lastRunLine = lastRun
    ? `Last run ${new Date(lastRun.startedAt).toLocaleString()} (${lastRun.trigger}): searched ${lastRun.searches}, found ${lastRun.found}, new ${lastRun.created}, triaged ${lastRun.triaged}${lastRun.stubbed ? ", AI in stub mode" : ""}${lastRun.note ? ` — ${lastRun.note}` : ""}`
    : "The scout has not run for this organization yet.";

  return (
    <section className="mb-6">
      <Panel
        title="What the scout looks for"
        eyebrow={enabled ? "Nightly · 09:00 UTC" : "Paused"}
        actions={
          isAdmin ? (
            <span className="inline-flex items-center gap-2">
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                disabled={running || saving}
                onClick={runNow}
                title="Search SAM.gov and your watchlist now, as the nightly run would"
              >
                {running ? "Scouting…" : "Run scout now"}
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-primary text-[11px]"
                disabled={saving || running}
                onClick={save}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </span>
          ) : undefined
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="aur-label">Keywords (comma-separated, up to 10; the first three are searched nightly)</span>
            <input
              className="aur-input mt-1 font-body text-sm"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              disabled={!isAdmin}
              placeholder="zero trust, help desk, cloud migration"
            />
          </label>
          <label className="block">
            <span className="aur-label">Extra NAICS codes (added to your organization&apos;s codes)</span>
            <input
              className="aur-input mt-1 font-mono text-sm"
              value={extraNaics}
              onChange={(e) => setExtraNaics(e.target.value)}
              disabled={!isAdmin}
              placeholder="541512, 541519"
            />
          </label>
          <label className="block">
            <span className="aur-label">Posted in the last</span>
            <select
              className="aur-input mt-1 font-mono text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={!isAdmin}
            >
              {[1, 2, 3, 5, 7, 14].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 font-body text-[13px] text-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!isAdmin}
          />
          Run nightly for this organization
        </label>
        <p className="mt-3 font-mono text-[11px] text-muted">{lastRunLine}</p>
        <p className="mt-1 font-mono text-[11px] text-muted">{trackLine(track)}</p>
        {note ? <p className="mt-2 font-mono text-[11px] text-text">{note}</p> : null}
        {!isAdmin ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-subtle">
            An org admin changes these settings.
          </p>
        ) : null}
      </Panel>
    </section>
  );
}

const REC_CLASS: Record<ScoutRecommendation, string> = {
  pursue: "border-emerald/40 bg-emerald/10 text-emerald-300",
  watch: "border-cobalt/40 bg-cobalt/10 text-text",
  skip: "border-rose/40 bg-rose/10 text-rose-300",
};

function RecBadge({ candidate }: { candidate: ScoutCandidateView }) {
  const r = candidate.recommendation;
  if (!r) {
    return (
      <span className="rounded border border-layer/15 bg-layer/[0.04] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
        {candidate.stubbed ? "Scored (AI stub)" : candidate.triageQueued ? "AI triage queued" : "Scored · not triaged"}
      </span>
    );
  }
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${REC_CLASS[r]}`}>
      {SCOUT_RECOMMENDATION_LABELS[r]}
      {candidate.confidence !== null ? ` · ${Math.round(candidate.confidence * 100)}%` : ""}
    </span>
  );
}

function GradeMark({ grade }: { grade: ScoutCandidateView["grade"] }) {
  const cls =
    grade === "correct"
      ? "text-emerald-300"
      : grade === "wrong"
        ? "text-rose-300"
        : "text-subtle";
  const glyph = grade === "correct" ? "✓" : grade === "wrong" ? "✗" : "–";
  const title =
    grade === "correct"
      ? "The scout's call matched your decision"
      : grade === "wrong"
        ? "The scout's call did not match your decision"
        : "No decisive call to grade";
  return (
    <span title={title} className={`w-4 text-center font-mono text-[12px] ${cls}`}>
      {glyph}
    </span>
  );
}

function CandidateCard({ candidate: c }: { candidate: ScoutCandidateView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: ScoutDecision; opportunityId: string | null } | null>(null);

  function decide(decision: ScoutDecision) {
    setError(null);
    startTransition(async () => {
      const res = await decideScoutCandidateAction(c.id, decision);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ status: res.status, opportunityId: res.opportunityId });
      router.refresh();
    });
  }

  const when =
    c.daysToDue === null
      ? c.source === "watchlist_award"
        ? ""
        : "no due date"
      : c.daysToDue < 0
        ? `due ${-c.daysToDue}d ago`
        : `${c.source === "watchlist_award" ? "ends" : "due"} in ${c.daysToDue}d`;

  return (
    <li className="rounded-md border border-layer/10 bg-layer/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <RecBadge candidate={c} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Fit {c.fitScore}</span>
        {c.source === "watchlist_award" ? (
          <span className="rounded border border-violet/40 bg-violet/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-text">
            Expiring award
          </span>
        ) : null}
        {when ? (
          <span
            className={`ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest ${
              c.daysToDue !== null && c.daysToDue < 5 ? "text-rose-300" : "text-muted"
            }`}
          >
            {when}
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-display text-[14px] text-text">
        {c.uiLink ? (
          <a href={c.uiLink} target="_blank" rel="noreferrer" className="hover:underline">
            {c.title}
          </a>
        ) : (
          c.title
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        {[c.agency, c.noticeType, c.setAside, c.naicsCode ? `NAICS ${c.naicsCode}` : "", c.incumbent ? `incumbent ${c.incumbent}` : ""]
          .filter(Boolean)
          .join(" · ") || "—"}
      </div>
      {c.signals.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {c.signals.slice(0, 5).map((s) => (
            <li
              key={s}
              className="rounded border border-layer/10 bg-layer/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted"
            >
              {s}
            </li>
          ))}
        </ul>
      ) : null}
      {c.rationale ? (
        <p className="mt-2 font-body text-[13px] leading-relaxed text-muted">{c.rationale}</p>
      ) : (
        <p className="mt-2 line-clamp-2 font-body text-[12px] leading-relaxed text-subtle">{c.description}</p>
      )}
      {c.nextActions.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 font-body text-[12px] leading-relaxed text-muted">
          {c.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {done ? (
          done.opportunityId ? (
            <Link href={`/opportunities/${done.opportunityId}`} className="aur-btn aur-btn-primary text-[11px]">
              Open the new opportunity →
            </Link>
          ) : (
            <span className="font-mono text-[11px] text-muted">Dismissed.</span>
          )
        ) : (
          <>
            <button
              type="button"
              className="aur-btn aur-btn-primary text-[11px]"
              disabled={pending}
              onClick={() => decide("imported")}
            >
              {pending ? "…" : "Import as opportunity"}
            </button>
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px]"
              disabled={pending}
              onClick={() => decide("dismissed")}
            >
              Dismiss
            </button>
          </>
        )}
        {error ? <span className="font-mono text-[11px] text-rose-300">{error}</span> : null}
      </div>
    </li>
  );
}
