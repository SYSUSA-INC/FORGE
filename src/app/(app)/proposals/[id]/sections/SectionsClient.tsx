"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ProposalSectionKind,
  ProposalSectionStatus,
  TipTapDoc,
} from "@/db/schema";
import {
  SECTION_KIND_LABELS,
  SECTION_STATUS_COLORS,
  SECTION_STATUS_LABELS,
} from "@/lib/proposal-types";
import { countWords as countDocWords, fromPlainText, projectToPlain } from "@/lib/tiptap-doc";
import { appendAsTrackedInsertion, applyAsTrackedChanges } from "@/lib/tracked-diff";
import { pickColorForUser } from "@/lib/collab-user";
import {
  RichSectionEditor,
  type ChangeDecisionEvent,
  type CollabConfig,
  type CommentsConfig,
  type SnapshotsConfig,
  type TrackChangesConfig,
} from "@/components/editor/RichSectionEditor";
import { AiAssistantPanel } from "./ai/AiAssistantPanel";
import { BrainSuggestPanel } from "./ai/BrainSuggestPanel";
import { ResearchRail } from "./ai/ResearchRail";
import {
  addCustomSectionAction,
  removeSectionAction,
  saveSectionAction,
} from "../../actions";
import { recordChangeDecisionsAction } from "./change-decision-actions";
import { triggerProposalScanIfStaleAction } from "../scan-actions";
import { THEME } from "@/lib/theme-colors";

type Section = {
  id: string;
  kind: ProposalSectionKind;
  title: string;
  ordering: number;
  content: string;
  bodyDoc: TipTapDoc;
  status: ProposalSectionStatus;
  wordCount: number;
  pageLimit: number | null;
  authorUserId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  // BL-FB-SCAN-CONTINUOUS — per-section severity from the latest health
  // scan, or null when no scan has run / no issue was raised for this
  // section. Drives the red/amber/green dot in the section list.
  scanSeverity: "high" | "medium" | "low" | null;
  scanIssue: string | null;
  // BL-FB-SCAN-THEMES — theme coverage counts from the latest scan.
  // null when no scan exists or no themes are configured.
  themeReinforced: number | null;
  themeTotal: number | null;
};

type TeamMember = { id: string; name: string | null; email: string };

type CurrentUser = {
  id: string;
  displayName: string;
};

const STATUSES: ProposalSectionStatus[] = [
  "not_started",
  "in_progress",
  "draft_complete",
  "in_review",
  "approved",
];

const KIND_OPTIONS: ProposalSectionKind[] = [
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
  "executive_summary",
];

/**
 * BL-9 Slice 2b — build the per-section CollabConfig for the editor.
 *
 * Returns undefined when collab isn't enabled in this environment, so
 * `RichSectionEditor` falls back to its existing single-user path —
 * byte-identical behavior with pre-collab deploys.
 *
 * `serverUrl` defaults to `NEXT_PUBLIC_COLLAB_URL` (e.g.
 * `wss://collab.forge.app`). Without it, even if the feature flag is
 * on, we can't connect — bail to single-user instead of crashing.
 */
function buildCollabConfig(
  sectionId: string,
  user: CurrentUser,
): CollabConfig | undefined {
  const enabled = process.env.NEXT_PUBLIC_COLLAB_ENABLED === "1";
  const serverUrl = process.env.NEXT_PUBLIC_COLLAB_URL || "";
  if (!enabled || !serverUrl) return undefined;
  return {
    docName: `section/${sectionId}`,
    serverUrl,
    userName: user.displayName,
    userColor: pickColorForUser(user.id),
    fetchToken: fetchCollabToken,
  };
}

/**
 * BL-9 Slice 3 — track changes author config for the current user.
 * Always provided so the editor has track-changes capability in both
 * collab and single-user modes.
 *
 * BL-9 Slice 5a — `isOwner` controls whether this user can flip the
 * editor mode, accept/reject changes, or only suggest. Section author
 * counts as the owner of their section; everyone else suggests.
 * When no author has been assigned the section is treated as ownerless,
 * so the current user gets the full picker (most common for new
 * single-author sections that haven't been re-assigned yet).
 */
function buildTrackChangesConfig(
  user: CurrentUser,
  authorUserId: string | null,
  onDecision?: (event: ChangeDecisionEvent) => void,
): TrackChangesConfig {
  return {
    author: {
      id: user.id,
      name: user.displayName,
      color: pickColorForUser(user.id),
    },
    isOwner: authorUserId === null || authorUserId === user.id,
    onDecision,
  };
}

/**
 * BL-9 Slice 4 — comments author config for the current user.
 * Comments only activate when collab is enabled (the Y.Doc backs them);
 * `RichSectionEditor` enforces that gate, so we can safely always pass
 * the config.
 */
function buildCommentsConfig(user: CurrentUser): CommentsConfig {
  return {
    author: {
      id: user.id,
      name: user.displayName,
    },
  };
}

/**
 * BL-9 Slice 5b — snapshots config for the editor.
 * The owner mirror of `buildTrackChangesConfig` — anyone can take a
 * snapshot, but only the section author (or an ownerless section)
 * can restore or delete one. `onRestored` is filled in by the row
 * itself so it can pull the freshly-restored doc back from the DB.
 */
function buildSnapshotsConfig(opts: {
  proposalId: string;
  sectionId: string;
  currentUser: CurrentUser;
  authorUserId: string | null;
  onRestored: () => void;
}): SnapshotsConfig {
  return {
    proposalId: opts.proposalId,
    sectionId: opts.sectionId,
    isOwner: opts.authorUserId === null || opts.authorUserId === opts.currentUser.id,
    onRestored: opts.onRestored,
  };
}

async function fetchCollabToken(): Promise<string> {
  const res = await fetch("/api/collab/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`collab token request failed: ${res.status}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("collab token response missing `token`");
  return body.token;
}

export function SectionsClient({
  proposalId,
  sections,
  team,
  currentUser,
}: {
  proposalId: string;
  sections: Section[];
  team: TeamMember[];
  currentUser: CurrentUser;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    sections[0]?.id ?? null,
  );

  return (
    <div className="flex flex-col gap-3">
      <AddSectionRow proposalId={proposalId} />

      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <SectionRow
            key={s.id}
            proposalId={proposalId}
            section={s}
            team={team}
            currentUser={currentUser}
            open={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function AddSectionRow({ proposalId }: { proposalId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ProposalSectionKind>("technical");
  const [error, setError] = useState<string | null>(null);

  function onSubmit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addCustomSectionAction({
        proposalId,
        kind,
        title,
      });
      if (!res.ok) return setError(res.error);
      setTitle("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-layer/10 bg-layer/[0.02] p-3 md:flex-row md:items-end">
      <div className="flex-1">
        <label className="aur-label">Add section</label>
        <input
          className="aur-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Volume III – Key Personnel"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
      <div className="md:w-48">
        <label className="aur-label">Kind</label>
        <select
          className="aur-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as ProposalSectionKind)}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {SECTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="aur-btn aur-btn-ghost text-[12px] md:w-32"
        disabled={pending || !title.trim()}
        onClick={onSubmit}
      >
        {pending ? "Adding…" : "+ Add"}
      </button>
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[10px] text-rose md:w-full">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SectionRow({
  proposalId,
  section,
  team,
  currentUser,
  open,
  onToggle,
}: {
  proposalId: string;
  section: Section;
  team: TeamMember[];
  currentUser: CurrentUser;
  open: boolean;
  onToggle: () => void;
}) {
  // BL-9 Slice 2b — collab config (undefined when feature flag is off).
  // Memoized via inline call: the inputs (section.id, currentUser) are
  // stable for this row's lifetime, so referential identity stays put.
  const collab = buildCollabConfig(section.id, currentUser);
  // BL-9 Slice 7 — every accept / reject lands in section_change_decision
  // (audited) so the Brain learns what owners keep and strike. Fire and
  // forget: a failed record never blocks or surfaces in the editor.
  const onDecision = useCallback(
    (event: ChangeDecisionEvent) => {
      void recordChangeDecisionsAction({
        proposalId,
        sectionId: section.id,
        bulk: event.bulk,
        decisions: event.decisions.map((d) => ({
          id: d.id,
          type: d.type,
          decision: d.decision,
          authorId: d.authorId,
          authorName: d.authorName,
          text: d.text,
        })),
      }).catch(() => undefined);
    },
    [proposalId, section.id],
  );
  // BL-9 Slice 3 — track changes config (always provided).
  // Slice 5a — section author is the owner; non-authors can only suggest.
  const trackChanges = useMemo(
    () => buildTrackChangesConfig(currentUser, section.authorUserId, onDecision),
    [currentUser, section.authorUserId, onDecision],
  );
  // BL-9 Slice 4 — comments config (activates only when collab is on).
  const comments = buildCommentsConfig(currentUser);
  const router = useRouter();
  // BL-AIP-2 — a restore is an explicit request to discard local edits;
  // the server-sync effect below honours it even while dirty.
  const restorePendingRef = useRef(false);
  // BL-9 Slice 5b — snapshots config. The restore path mutates the
  // section's body_doc server-side, so a successful restore triggers
  // a router.refresh(); the refreshed props are adopted into the editor
  // by the server-sync effect (BL-AIP-2).
  const snapshots = buildSnapshotsConfig({
    proposalId,
    sectionId: section.id,
    currentUser,
    authorUserId: section.authorUserId,
    onRestored: () => {
      restorePendingRef.current = true;
      router.refresh();
    },
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // BL-FB-SCAN-CONTINUOUS — after-save background scan timer.
  // 65 seconds after the last successful save we fire the server-side
  // trigger (which enforces its own 60s debounce). If the trigger
  // actually fires a scan, refresh the page ~20s later to pick up
  // the updated health dots. Using refs so multiple saves within the
  // debounce window cancel-and-restart cleanly.
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const [title, setTitle] = useState(section.title);
  const initialDoc: TipTapDoc =
    section.bodyDoc?.content?.length
      ? section.bodyDoc
      : fromPlainText(section.content);
  const [bodyDoc, setBodyDoc] = useState<TipTapDoc>(initialDoc);
  const [plainContent, setPlainContent] = useState(section.content);
  const [wordCount, setWordCount] = useState(section.wordCount);
  const [status, setStatus] = useState<ProposalSectionStatus>(section.status);
  const [pageLimit, setPageLimit] = useState<string>(
    section.pageLimit === null ? "" : String(section.pageLimit),
  );
  const [authorUserId, setAuthorUserId] = useState<string>(
    section.authorUserId ?? "",
  );

  // BL-AIP-2 — the editor reads `doc` once at mount. Every replacement
  // from outside it (AI accept, Brain insert, snapshot restore) bumps
  // `docVersion` so RichSectionEditor pushes the new document into
  // TipTap; until now those actions changed page state while the
  // visible text stayed, and the next Save threw the AI text away.
  const [docVersion, setDocVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const bodyDocRef = useRef<TipTapDoc>(initialDoc);
  bodyDocRef.current = bodyDoc;
  const plainRef = useRef(plainContent);
  plainRef.current = plainContent;

  function replaceDoc(doc: TipTapDoc, plain: string, count: number) {
    setBodyDoc(doc);
    setPlainContent(plain);
    setWordCount(count);
    setDirty(true);
    setDocVersion((v) => v + 1);
  }

  // BL-AIP-6 — AI text lands as tracked changes authored "FORGE AI" on
  // top of the current document: unchanged blocks (tables, lists, marks)
  // survive, the owner accepts or rejects each change in the editor,
  // and every decision is recorded against the AI author.
  const [reviewSignal, setReviewSignal] = useState(0);
  function applyTracked(text: string) {
    const res = applyAsTrackedChanges({ doc: bodyDocRef.current, proposedText: text });
    if (res.changes === 0) {
      setNotice("The AI text matches the section — nothing to change.");
      return;
    }
    replaceDoc(res.doc, projectToPlain(res.doc), countDocWords(res.doc));
    setReviewSignal((v) => v + 1);
    setNotice(
      `FORGE AI suggested ${res.changes} change${res.changes === 1 ? "" : "s"} (+${res.insertedWords} / −${res.deletedWords} words). Accept or reject them in Track changes, then save.`,
    );
  }
  function insertTracked(text: string) {
    const res = appendAsTrackedInsertion({ doc: bodyDocRef.current, text });
    if (res.changes === 0) return;
    replaceDoc(res.doc, projectToPlain(res.doc), countDocWords(res.doc));
    setReviewSignal((v) => v + 1);
    setNotice("Inserted as a tracked suggestion by FORGE AI. Accept it in Track changes, then save.");
  }

  // Server data changed underneath us (snapshot restore, or a refresh
  // while there are no unsaved edits): adopt it. Never while dirty —
  // that would throw away typing — unless a restore was requested.
  useEffect(() => {
    const serverDoc: TipTapDoc = section.bodyDoc?.content?.length
      ? section.bodyDoc
      : fromPlainText(section.content);
    if (JSON.stringify(serverDoc) === JSON.stringify(bodyDocRef.current)) {
      restorePendingRef.current = false;
      return;
    }
    if (dirty && !restorePendingRef.current) return;
    restorePendingRef.current = false;
    setBodyDoc(serverDoc);
    setPlainContent(section.content);
    setWordCount(section.wordCount);
    setDirty(false);
    setDocVersion((v) => v + 1);
    // `dirty` is read but deliberately not a dependency: typing must not
    // re-run the adoption check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.bodyDoc, section.content, section.wordCount]);

  // Unsaved-changes guard.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function save() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveSectionAction({
        proposalId,
        sectionId: section.id,
        title,
        bodyDoc,
        status,
        pageLimit: pageLimit.trim() === "" ? null : Number(pageLimit),
        authorUserId: authorUserId || null,
      });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      setNotice("Saved.");
      router.refresh();

      // BL-FB-SCAN-CONTINUOUS — schedule a background scan trigger after
      // the debounce window. Cancels any pending timer so rapid saves
      // collapse into a single scan attempt.
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      scanTimerRef.current = setTimeout(() => {
        triggerProposalScanIfStaleAction(proposalId)
          .then((r) => {
            if (r.triggered) {
              // Scan is running in the background — refresh dots once it lands.
              refreshTimerRef.current = setTimeout(
                () => router.refresh(),
                20_000,
              );
            }
          })
          .catch(() => {
            // best effort — dots update on next page load at latest
          });
      }, 65_000);
    });
  }

  function remove() {
    if (
      !window.confirm(`Remove section "${section.title}"? This cannot be undone.`)
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await removeSectionAction(proposalId, section.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const words = wordCount;

  return (
    <li className="overflow-hidden rounded-lg border border-layer/10 bg-layer/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
              {section.ordering}
            </span>
            {/* BL-FB-SCAN-CONTINUOUS — health dot per section */}
            <ScanDot severity={section.scanSeverity} issue={section.scanIssue} />
            {/* BL-FB-SCAN-THEMES — win-theme coverage badge */}
            {section.themeTotal !== null && section.themeReinforced !== null ? (
              <ThemeBadge
                reinforced={section.themeReinforced}
                total={section.themeTotal}
              />
            ) : null}
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {section.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            <span>{SECTION_KIND_LABELS[section.kind]}</span>
            <span>·</span>
            <span>{section.wordCount} words</span>
            {section.pageLimit ? (
              <>
                <span>·</span>
                <span>{section.pageLimit}p cap</span>
              </>
            ) : null}
            {section.authorName || section.authorEmail ? (
              <>
                <span>·</span>
                <span>{section.authorName ?? section.authorEmail}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
          style={{
            color: SECTION_STATUS_COLORS[section.status],
            backgroundColor: `${SECTION_STATUS_COLORS[section.status]}1A`,
            border: `1px solid ${SECTION_STATUS_COLORS[section.status]}40`,
          }}
        >
          {SECTION_STATUS_LABELS[section.status]}
        </span>
        <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="border-t border-layer/10 bg-canvas/40 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="aur-label">Section title</label>
              <input
                className="aur-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="aur-label">Status</label>
                <select
                  className="aur-input"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as ProposalSectionStatus)
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {SECTION_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="aur-label">Page cap</label>
                <input
                  className="aur-input"
                  inputMode="numeric"
                  value={pageLimit}
                  onChange={(e) => setPageLimit(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="aur-label">Author</label>
                <select
                  className="aur-input"
                  value={authorUserId}
                  onChange={(e) => setAuthorUserId(e.target.value)}
                >
                  <option value="">—</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <AiAssistantPanel
              sectionId={section.id}
              hasContent={plainContent.trim().length > 0}
              getCurrentText={() => plainRef.current}
              onAccept={(doc, plain, count) => replaceDoc(doc, plain, count)}
              onApplyTracked={applyTracked}
            />
            <BrainSuggestPanel
              sectionId={section.id}
              onInsert={(text) => {
                // BL-AIP-6 — appended as a tracked insertion; the rest of
                // the document (tables, lists, pending suggestions) is
                // left exactly as it is instead of rebuilt from plain text.
                if (plainRef.current.trim()) {
                  insertTracked(text);
                  return;
                }
                const next = text.trim();
                const doc = fromPlainText(next);
                replaceDoc(doc, next, next.split(/\s+/).filter(Boolean).length);
              }}
            />
            <div className="flex items-center justify-between">
              <label className="aur-label mb-0">Content</label>
              <span className="font-mono text-[10px] text-muted">
                {words} words
                {dirty ? (
                  <span
                    className="ml-2 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-200"
                    title="Changes in this section have not been saved"
                  >
                    unsaved
                  </span>
                ) : null}
              </span>
            </div>
            <RichSectionEditor
              doc={bodyDoc}
              docVersion={docVersion}
              reviewSignal={reviewSignal}
              onChange={(doc, plain, count) => {
                setBodyDoc(doc);
                setPlainContent(plain);
                setWordCount(count);
                setDirty(true);
              }}
              placeholder="Draft prose here. Use the toolbar for headings, lists, tables, links."
              collab={collab}
              trackChanges={trackChanges}
              comments={comments}
              snapshots={snapshots}
            />
            <input type="hidden" value={plainContent} readOnly />
            {/* BL-AIP-6 — research while you write */}
            <ResearchRail
              sectionId={section.id}
              text={plainContent}
              onInsertTracked={insertTracked}
            />
          </div>

          {error ? (
            <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-2 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
              {notice}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="aur-btn aur-btn-primary text-[12px]"
              disabled={pending}
              onClick={save}
            >
              {pending ? "Saving…" : "Save section"}
            </button>
            <button
              type="button"
              className="aur-btn aur-btn-danger text-[11px]"
              disabled={pending}
              onClick={remove}
            >
              Remove section
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ScanDot({
  severity,
  issue,
}: {
  severity: "high" | "medium" | "low" | null;
  issue: string | null;
}) {
  // Emerald = no issue raised in the last scan (or no scan yet, which
  // we render the same neutral colour to avoid alarming the operator
  // about a freshly-started proposal).
  const color =
    severity === "high"
      ? THEME.red
      : severity === "medium"
        ? THEME.brass
        : severity === "low"
          ? THEME.muted
          : THEME.green;
  const label =
    severity === "high"
      ? "Critical issue"
      : severity === "medium"
        ? "Needs attention"
        : severity === "low"
          ? "Minor issue"
          : "Healthy";
  return (
    <span
      title={issue ? `${label}: ${issue}` : label}
      aria-label={label}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        background: color,
        boxShadow: `0 0 0 1px ${color}55`,
      }}
    />
  );
}

// BL-FB-SCAN-THEMES — per-section win-theme coverage badge.
function ThemeBadge({
  reinforced,
  total,
}: {
  reinforced: number;
  total: number;
}) {
  if (total === 0) return null;
  const color =
    reinforced === total
      ? THEME.green
      : reinforced > 0
        ? THEME.brass
        : THEME.red;
  const title =
    reinforced === total
      ? `All ${total} win theme${total === 1 ? "" : "s"} reinforced`
      : `${reinforced}/${total} win theme${total === 1 ? "" : "s"} reinforced`;
  return (
    <span
      className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] tabular-nums tracking-widest"
      style={{
        color,
        backgroundColor: `${color}1A`,
        border: `1px solid ${color}50`,
      }}
      title={title}
    >
      {reinforced}/{total}
    </span>
  );
}
