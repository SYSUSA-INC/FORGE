"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { ResultHead, ResultRow, type ResultCall } from "@/components/scout/ResultRow";
import {
  defaultFindsFilter,
  filterFinds,
  isWeakFit,
  SCOUT_LIST_FILTERS,
  SCOUT_RECOMMENDATION_LABELS,
  scoutKeywordQuery,
  type ScoutCandidateView,
  type ScoutDecision,
  type ScoutListFilter,
  type ScoutProfileView,
  type ScoutRunView,
  type ScoutTrack,
} from "@/lib/scout-logic";
import { decideScoutCandidateAction, runScoutNowAction, saveScoutProfileAction } from "./actions";

/**
 * BL-SCOUT-ONEPAGE — the All tab of the Scout: the search bar (what the
 * nightly scout looks for; Search runs it once with the bar's words,
 * Save keeps them for the nightly run), the finds in one list with the
 * same rows as every other source, and the decided ones.
 */
export function ScoutClient({
  profile,
  orgCodes,
  candidates,
  decided,
  track,
  lastRun,
  isAdmin,
  unreviewedTotal,
  weakTotal,
  waitingTotal,
}: {
  profile: ScoutProfileView;
  /** The organization's own NAICS codes, searched after the bar's. */
  orgCodes: string[];
  candidates: ScoutCandidateView[];
  decided: ScoutCandidateView[];
  track: ScoutTrack;
  lastRun: ScoutRunView | null;
  isAdmin: boolean;
  /** Every unreviewed find, and every waiting find, when the page loads only the first ones. */
  unreviewedTotal?: number;
  weakTotal?: number;
  waitingTotal?: number;
}) {
  return (
    <>
      <SearchBar profile={profile} orgCodes={orgCodes} lastRun={lastRun} track={track} isAdmin={isAdmin} />
      <FindsList candidates={candidates} lastRun={lastRun} unreviewedTotal={unreviewedTotal ?? 0} weakTotal={weakTotal ?? 0} waitingTotal={waitingTotal ?? candidates.length} />
      {decided.length > 0 ? (
        <details className="mb-6 rounded-md border border-layer/10 px-4 py-3">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-label text-muted">
            Recently decided ({decided.length}) · {trackLine(track)}
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-layer/10">
            {decided.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-1 py-2">
                <GradeMark grade={c.grade} />
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${c.status === "imported" ? "border-emerald/40 bg-emerald/10 text-emerald-300" : "border-layer/15 bg-layer/[0.04] text-muted"}`}>
                  {c.status === "imported" ? "added" : "set aside"}
                </span>
                {c.opportunityId ? (
                  <Link href={`/opportunities/${c.opportunityId}`} className="min-w-0 truncate font-display text-[13px] text-text hover:underline">
                    {c.title}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate font-display text-[13px] text-text">{c.title}</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {c.recommendation ? `scout said ${SCOUT_RECOMMENDATION_LABELS[c.recommendation]}` : "not reviewed"} · fit {c.fitScore}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

const DAYS = [1, 2, 3, 5, 7, 14];

/**
 * One bar for what the scout looks for. Search runs the scout once with
 * what is in the bar (finds join the list; nothing saved changes); Save
 * makes it the nightly search. Org admins change it; members read it.
 */
function SearchBar({ profile, orgCodes, lastRun, track, isAdmin }: { profile: ScoutProfileView; orgCodes: string[]; lastRun: ScoutRunView | null; track: ScoutTrack; isAdmin: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(profile.enabled);
  const [keywords, setKeywords] = useState(profile.keywords.join(", "));
  const [extraNaics, setExtraNaics] = useState(profile.extraNaics.join(", "));
  const [days, setDays] = useState(profile.postedDaysBack);
  const [busy, start] = useTransition();
  const [doing, setDoing] = useState<"search" | "save" | "backfill" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // BL-STAB-10d — what the scout makes of the keywords ("“IT” is in almost every notice").
  const keywordNotes = useMemo(() => scoutKeywordQuery(keywords.split(/[,;\n]+/).map((k) => k.trim()).filter(Boolean))?.notes ?? [], [keywords]);
  const changed =
    enabled !== profile.enabled || keywords !== profile.keywords.join(", ") || extraNaics !== profile.extraNaics.join(", ") || days !== profile.postedDaysBack;

  function search() {
    setNote(null);
    setDoing("search");
    start(async () => {
      const res = await runScoutNowAction(changed ? { keywords, extraNaics, postedDaysBack: days } : undefined);
      setDoing(null);
      if (!res.ok) return setNote(res.error);
      const s = res.summary;
      setNote(`Found ${s.found}, ${s.created} new, ${s.triaged} reviewed by the AI${s.errors ? `, ${s.errors} error${s.errors === 1 ? "" : "s"}` : ""}.${s.note ? ` ${s.note}` : ""}`);
      router.refresh();
    });
  }
  function backfill() {
    setNote(null);
    setDoing("backfill");
    start(async () => {
      const res = await runScoutNowAction(undefined, { backfill: true });
      setDoing(null);
      if (!res.ok) return setNote(res.error);
      const s = res.summary;
      setNote(`Read everything still open in your codes: ${s.found} found, ${s.created} new.${s.note ? ` ${s.note}` : ""}`);
      router.refresh();
    });
  }
  function save() {
    setNote(null);
    setDoing("save");
    start(async () => {
      const res = await saveScoutProfileAction({ enabled, keywords, extraNaics, postedDaysBack: days });
      setDoing(null);
      setNote(res.ok ? "Saved: the nightly scout searches with these from tonight." : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <section aria-label="What the scout looks for" className="mb-4 rounded-md border border-layer/10 px-4 py-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_auto] md:items-end">
        <label className="block">
          <span className="aur-label">Keywords</span>
          <input className="aur-input mt-1 font-body text-sm" value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={!isAdmin} placeholder="zero trust, help desk, cloud migration" />
        </label>
        <label className="block">
          <span className="aur-label">NAICS codes</span>
          <input className="aur-input mt-1 font-mono text-sm" value={extraNaics} onChange={(e) => setExtraNaics(e.target.value)} disabled={!isAdmin} placeholder={orgCodes.join(", ") || "541512, 541519"} />
        </label>
        <label className="block">
          <span className="aur-label">Posted in</span>
          <select className="aur-input mt-1 font-mono text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={!isAdmin}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="aur-btn aur-btn-primary" disabled={busy} onClick={search} title="Search SAM.gov and your watchlist now with what is in the bar; the nightly search stays as saved">
              {doing === "search" ? "Searching…" : "Search"}
            </button>
            <button type="button" className="aur-btn" disabled={busy || !changed} onClick={save} title="Make this the nightly search">
              {doing === "save" ? "Saving…" : "Save as nightly scout"}
            </button>
            <button type="button" className="aur-btn" disabled={busy} onClick={backfill} title="Read every notice SAM.gov still holds as open in your codes (up to a year back), not just the last few days. A new company's first scout does this on its own.">
              {doing === "backfill" ? "Reading…" : "Search every open notice"}
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-2 font-body text-[12px] leading-[1.5] text-muted">
        Every open notice in your NAICS codes{orgCodes.length > 0 ? ` (these, then your organization's: ${orgCodes.join(", ")})` : ""} is a find; your keywords raise its score. With no codes, a find must mention a keyword.{" "}
        {keywordNotes.length > 0 ? <span className="text-gold">{keywordNotes.join(" ")} </span> : null}
        {isAdmin ? null : "An org admin changes what the scout looks for; the SAM.gov tab searches for anything."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!isAdmin} />
          Run nightly at 09:00 UTC
        </label>
        <span>{trackLine(track)}</span>
        {lastRun ? (
          <details className="min-w-0">
            <summary className="cursor-pointer">
              Last run {new Date(lastRun.startedAt).toLocaleString()}: found {lastRun.found}, {lastRun.created} new, {lastRun.triaged} reviewed
            </summary>
            {lastRun.note ? <p className="mt-1 max-w-4xl font-body text-[12px] leading-[1.5]">{lastRun.note}</p> : null}
          </details>
        ) : (
          <span>The scout has not run yet.</span>
        )}
      </div>
      {note ? <p className="mt-2 font-body text-[12px] leading-[1.5] text-text">{note}</p> : null}
    </section>
  );
}

/** BL-SCOUT-REACH — the not-yet-reviewed view opens on its best 20. */
const UNREVIEWED_SHOWN = 20;

function FindsList({ candidates, lastRun, unreviewedTotal, weakTotal, waitingTotal }: { candidates: ScoutCandidateView[]; lastRun: ScoutRunView | null; unreviewedTotal: number; weakTotal: number; waitingTotal: number }) {
  const [filter, setFilter] = useState<ScoutListFilter>(() => defaultFindsFilter(candidates));
  const [showAll, setShowAll] = useState(false);
  // BL-SCOUT-FILES — what was just added or set aside, kept in view: the
  // list reloads with waiting finds only, so a decided row leaves it.
  const [recent, setRecent] = useState<{ id: string; title: string; status: ScoutDecision; opportunityId: string | null }[]>([]);
  const counts: Record<ScoutListFilter, number> = {
    recommended: candidates.filter((c) => c.recommendation === "pursue" || c.recommendation === "watch").length,
    unreviewed: Math.max(unreviewedTotal, candidates.filter((c) => !c.recommendation && !isWeakFit(c)).length),
    all: Math.max(waitingTotal - weakTotal - candidates.filter((c) => c.recommendation === "skip").length, 0),
    skipped: candidates.filter((c) => c.recommendation === "skip").length,
    weak: Math.max(weakTotal, candidates.filter(isWeakFit).length),
  };
  const shown = filterFinds(candidates, filter);
  const capped = (filter === "unreviewed" || filter === "all") && !showAll ? shown.slice(0, filter === "all" ? 50 : UNREVIEWED_SHOWN) : shown;
  const why = unreviewedReason(candidates.filter((c) => !c.recommendation && !isWeakFit(c)), lastRun);

  return (
    <Panel
      title="Finds"
      eyebrow={`${waitingTotal} waiting · ${counts.recommended} recommended${counts.weak > 0 ? ` · ${counts.weak} weak fit, not shown` : ""} · best first`}
      actions={
        <nav aria-label="Filter the finds" className="flex flex-wrap gap-1">
          {SCOUT_LIST_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setShowAll(false);
              }}
              className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${filter === f.key ? "bg-cobalt/15 text-text" : "text-muted hover:text-text"}`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </nav>
      }
    >
      {recent.length > 0 ? (
        <ul aria-label="Just decided" className="mb-3 flex flex-col gap-1 rounded-md border border-green/30 bg-green/5 px-3 py-2">
          {recent.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 font-body text-[13px] text-text">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{d.status === "imported" ? "Added to Evaluate" : "Set aside"}</span>
              <span className="min-w-0 truncate">{d.title}</span>
              {d.opportunityId ? (
                <>
                  <Link href={`/opportunities/${d.opportunityId}`} className="aur-link font-mono text-[11px]">
                    Open
                  </Link>
                  <Link href="/pipeline/evaluate" className="aur-link font-mono text-[11px]">
                    Go to Evaluate
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {(filter === "unreviewed" || filter === "all") && why ? <p className="mb-2 font-body text-[12px] leading-[1.5] text-muted">{why}</p> : null}
      {filter === "weak" ? <p className="mb-2 font-body text-[12px] leading-[1.5] text-muted">These match nothing your company does, so they are kept out of the default views and the AI&apos;s queue. Nothing is deleted: add any that Scout got wrong.</p> : null}
      {filter === "skipped" && shown.length > 0 ? <p className="mb-2 font-body text-[12px] leading-[1.5] text-muted">The AI&apos;s skips, shown so you can overrule it.</p> : null}
      {shown.length === 0 ? (
        <p className="font-body text-[13px] leading-relaxed text-muted">
          {filter === "recommended"
            ? "Nothing the AI recommends right now. See All for every find, or search with other keywords and codes above."
            : "Nothing here. The scout runs every night; Search above runs it now."}
        </p>
      ) : (
        <>
          <ResultHead />
          <ul>
            {capped.map((c) => (
              <FindRow key={c.id} candidate={c} onDecided={(d) => setRecent((prev) => [{ id: c.id, title: c.title, ...d }, ...prev.filter((x) => x.id !== c.id)].slice(0, 8))} />
            ))}
          </ul>
          {capped.length < shown.length || (filter === "unreviewed" && counts.unreviewed > shown.length) ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
              {capped.length < shown.length ? (
                <button type="button" className="aur-link font-mono text-[10px] uppercase tracking-widest" onClick={() => setShowAll(true)}>
                  Show all {shown.length}
                </button>
              ) : null}
              {filter === "unreviewed" && counts.unreviewed > shown.length ? <span>The best {shown.length} of {counts.unreviewed} are listed.</span> : null}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function callOf(c: ScoutCandidateView): ResultCall {
  if (!c.recommendation) return { label: c.stubbed ? "AI stub" : c.triageQueued ? "Queued" : "Not reviewed", tone: "none", title: c.triageQueued ? "The AI reviews it in tonight's batch" : "The AI has not reviewed this find yet" };
  return {
    label: SCOUT_RECOMMENDATION_LABELS[c.recommendation],
    tone: c.recommendation,
    title: `The AI's call${c.confidence !== null ? `, ${Math.round(c.confidence * 100)}% sure` : ""}; not a chance of winning.`,
  };
}

function FindRow({ candidate: c, onDecided }: { candidate: ScoutCandidateView; onDecided?: (d: { status: ScoutDecision; opportunityId: string | null }) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: ScoutDecision; opportunityId: string | null } | null>(null);

  function decide(decision: ScoutDecision) {
    setError(null);
    startTransition(async () => {
      const res = await decideScoutCandidateAction(c.id, decision);
      if (!res.ok) return setError(res.error);
      setDone({ status: res.status, opportunityId: res.opportunityId });
      onDecided?.({ status: res.status, opportunityId: res.opportunityId });
      router.refresh();
    });
  }

  const due =
    c.daysToDue === null ? (c.source === "watchlist_award" ? null : "no date") : c.daysToDue < 0 ? `${-c.daysToDue}d ago` : `${c.source === "watchlist_award" ? "ends " : ""}${c.daysToDue}d`;

  return (
    <ResultRow
      call={callOf(c)}
      title={c.title}
      href={c.uiLink || null}
      meta={[c.agency, c.noticeType, c.setAside, c.naicsCode ? `NAICS ${c.naicsCode}` : ""].filter(Boolean).join(" · ")}
      source={c.source === "watchlist_award" ? "Watchlist" : c.source === "portal_email" ? "Portal email" : "SAM.gov"}
      due={due}
      dueSoon={c.daysToDue !== null && c.daysToDue < 5}
      fit={c.fitScore}
      badges={c.source === "watchlist_award" ? <span className="rounded border border-violet/40 bg-violet/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-text">Expiring award</span> : null}
      details={
        <div className="flex flex-col gap-2">
          {c.signals.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {c.signals.map((s) => (
                <li key={s} className="rounded border border-layer/10 bg-layer/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {s}
                </li>
              ))}
            </ul>
          ) : null}
          {c.rationale ? <p className="font-body text-[13px] leading-relaxed text-text">{c.rationale}</p> : null}
          {c.nextActions.length > 0 ? (
            <ul className="list-disc pl-5 font-body text-[12px] leading-relaxed text-muted">
              {c.nextActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
          {c.description ? <p className="line-clamp-6 font-body text-[12px] leading-relaxed text-muted">{c.description}</p> : null}
        </div>
      }
      actions={
        done ? (
          done.opportunityId ? (
            <Link href={`/opportunities/${done.opportunityId}`} className="font-mono text-[11px] text-cobalt hover:underline">
              Open →
            </Link>
          ) : (
            <span className="font-mono text-[11px] text-muted">Set aside</span>
          )
        ) : (
          <>
            <button type="button" className="aur-btn aur-btn-primary" disabled={pending} onClick={() => decide("imported")}>
              {pending ? "…" : "Add to pipeline"}
            </button>
            <button type="button" className="aur-btn aur-btn-ghost" disabled={pending} onClick={() => decide("dismissed")}>
              Not for us
            </button>
            {error ? <span className="font-mono text-[11px] text-rose-300">{error}</span> : null}
          </>
        )
      }
    />
  );
}

/** Why finds are waiting for the AI's review, from the finds and the last run's notes. */
function unreviewedReason(unreviewed: ScoutCandidateView[], lastRun: ScoutRunView | null): string {
  if (unreviewed.length === 0) return "";
  if (unreviewed.some((c) => c.stubbed) || lastRun?.stubbed) return "AI is in stub mode on this deployment, so the scout scored the finds but could not review them.";
  const sentences = (lastRun?.note ?? "").split(/\n|(?<=\.)\s+/);
  const stopped = sentences.find((n) => n.startsWith("Triage stopped"));
  if (stopped) return `${stopped} The scout reviews the rest on its next run once that is resolved.`;
  const held = sentences.find((n) => n.startsWith("AI review held to"));
  if (held) return `${held.replace(/;.*$/, ".")} The rest are listed by fit, best first.`;
  if (unreviewed.every((c) => c.triageQueued)) return "Queued for tonight's review, which runs as a batch at half price.";
  return "The scout has the AI review the 25 best finds each run; the rest wait their turn, best first.";
}

function trackLine(t: ScoutTrack): string {
  if (t.n === 0) return "No decisions yet";
  const acc = t.accuracy === null ? "no decisive call yet" : `${Math.round(t.accuracy * 100)}% of decisive calls matched you`;
  return `${t.imported} added · ${t.dismissed} set aside · ${acc}`;
}

function GradeMark({ grade }: { grade: ScoutCandidateView["grade"] }) {
  const cls = grade === "correct" ? "text-emerald-300" : grade === "wrong" ? "text-rose-300" : "text-subtle";
  const glyph = grade === "correct" ? "✓" : grade === "wrong" ? "✗" : "–";
  const title = grade === "correct" ? "The scout's call matched your decision" : grade === "wrong" ? "The scout's call did not match your decision" : "No decisive call to grade";
  return (
    <span title={title} className={`w-4 text-center font-mono text-[12px] ${cls}`}>
      {glyph}
    </span>
  );
}
