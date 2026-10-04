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
import { ContentBlocksPanel } from "./ai/ContentBlocksPanel";
import { ResearchRail } from "./ai/ResearchRail";
import { TonePanel } from "./ai/TonePanel";
import { VoiceCheckPanel } from "./ai/VoiceCheckPanel";
import { GraphicsPanel } from "./ai/GraphicsPanel";
import { DraftPreview } from "./ai/DraftPreview";
import { PageBudgetRing } from "./PageBudgetRing";
import { normalizePageCap } from "@/lib/page-budget";
import { looksLikeRewrite, previewOps } from "@/lib/draft-preview";
import { ReviewCommentsPanel } from "./ReviewCommentsPanel";
import { describeOpenComments, type SectionReviewComment } from "@/lib/review-comments";
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
  // BL-AIP-6b — open colour-team review comments (human and FORGE AI
  // pre-review) on this section, resolvable from the editor.
  reviewComments: SectionReviewComment[];
  // BL-FB-CHAT-MULTI Slice 2 — thread messages by teammates since the
  // viewer last looked (the header badge).
  chatUnread: number;
};

type TeamMember = { id: string; name: string | null; email: string };

type CurrentUser = {
  id: string;
  displayName: string;
};

/** BL-FB-CHAT-SIDEBYSIDE — the layout choice, remembered per browser. */
const SIDE_BY_SIDE_KEY = "forge.sections.sideBySide";

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
  initialSectionId = null,
  initialTab = null,
  initialMessageId = null,
  voiceAuthorIds = [],
  houseStyle = false,
}: {
  proposalId: string;
  sections: Section[];
  team: TeamMember[];
  currentUser: CurrentUser;
  /** BL-FB-CHAT-MULTI — the section a mention notification points at, opened with its chat. */
  initialSectionId?: string | null;
  initialTab?: "chat" | null;
  /** BL-FB-CHAT-MULTI Slice 2 — the thread message the notification points at. */
  initialMessageId?: string | null;
  /** BL-FB-GEN-VOICE Slice 2 — members whose sections the drafter writes in their voice. */
  voiceAuthorIds?: string[];
  /** BL-FB-GEN-VOICE Slice 2 — whether the organization has a house style. */
  houseStyle?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    (initialSectionId && sections.some((s) => s.id === initialSectionId) ? initialSectionId : null) ?? sections[0]?.id ?? null,
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
            initialChatOpen={initialTab === "chat" && s.id === initialSectionId}
            initialMessageId={s.id === initialSectionId ? initialMessageId : null}
            voiceOn={!!s.authorUserId && voiceAuthorIds.includes(s.authorUserId)}
            houseStyle={houseStyle}
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
  initialChatOpen = false,
  initialMessageId = null,
  voiceOn = false,
  houseStyle = false,
}: {
  proposalId: string;
  section: Section;
  team: TeamMember[];
  currentUser: CurrentUser;
  open: boolean;
  onToggle: () => void;
  /** BL-FB-CHAT-MULTI — open the AI panel on the chat tab (a mention notification landed here). */
  initialChatOpen?: boolean;
  /** BL-FB-CHAT-MULTI Slice 2 — the thread message to scroll to and highlight. */
  initialMessageId?: string | null;
  /** BL-FB-GEN-VOICE Slice 2 — the section's author has an enabled voice profile. */
  voiceOn?: boolean;
  houseStyle?: boolean;
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
  // BL-FB-CHAT-MULTI Slice 2 — the header badge clears once the thread is read.
  const [chatUnread, setChatUnread] = useState(section.chatUnread);
  const markChatRead = useCallback(() => setChatUnread(0), []);
  const [authorUserId, setAuthorUserId] = useState<string>(
    section.authorUserId ?? "",
  );
  // BL-AIP-6b — the block under the cursor, reported by the editor, so
  // the research rail follows the paragraph being written.
  const [cursorParagraph, setCursorParagraph] = useState("");
  // BL-FB-SCAN-TONE — "Fix with AI" from the tone panel opens Improve
  // mode in the AI panel with the findings as guidance.
  const [improveRequest, setImproveRequest] = useState<{ hint: string; nonce: number } | null>(null);
  const [aiPending, setAiPending] = useState(false);
  // BL-FB-CHAT-SIDEBYSIDE — chat on the left, draft on the right; a reply
  // that reads as a rewrite is previewed against the draft paragraph by
  // paragraph and applied as tracked changes, paragraphs of the author's
  // choosing.
  const [sideBySide, setSideBySide] = useState(false);
  useEffect(() => {
    try {
      setSideBySide(window.localStorage.getItem(SIDE_BY_SIDE_KEY) === "1");
    } catch {
      // no storage — stacked
    }
  }, []);
  const [suggestion, setSuggestion] = useState<{ id: number; text: string; streaming: boolean } | null>(null);
  const [rightTab, setRightTab] = useState<"draft" | "preview">("draft");
  const previewDecidedRef = useRef(false);
  function changeLayout(next: "stacked" | "side") {
    setSideBySide(next === "side");
    if (next === "stacked") setRightTab("draft");
    try {
      window.localStorage.setItem(SIDE_BY_SIDE_KEY, next === "side" ? "1" : "0");
    } catch {
      // no storage — this visit only
    }
  }
  function onSuggestion(s: { text: string; streaming: boolean; explicit: boolean } | null) {
    if (!s || !s.text.trim()) {
      setSuggestion(null);
      setRightTab("draft");
      previewDecidedRef.current = false;
      return;
    }
    if (!sideBySide) return;
    setSuggestion((prev) => ({ id: prev && !s.explicit ? prev.id : Date.now(), text: s.text, streaming: s.streaming }));
    if (s.explicit) {
      setRightTab("preview");
      previewDecidedRef.current = true;
      return;
    }
    // Open the preview as soon as the reply reads as a rewrite of the
    // draft; an answer about the draft leaves the editor in view.
    if (previewDecidedRef.current) return;
    const draft = plainRef.current;
    if (looksLikeRewrite(previewOps(draft, s.text), !draft.trim())) {
      setRightTab("preview");
      previewDecidedRef.current = true;
    } else if (!s.streaming) {
      previewDecidedRef.current = true;
    }
  }
  function applyPreview(text: string) {
    if (plainRef.current.trim()) {
      applyTracked(text);
    } else {
      const next = text.trim();
      replaceDoc(fromPlainText(next), next, next.split(/\s+/).filter(Boolean).length);
    }
    setRightTab("draft");
    setSuggestion(null);
    previewDecidedRef.current = false;
  }
  // BL-FB-SCAN-PAGE-REALTIME — the cap as typed, so the ring follows an
  // unsaved cap change too.
  const liveCap = normalizePageCap(pageLimit);

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
  // BL-FB-GEN-GRAPHICS — a diagram lands as an image node at the end of
  // the section (images are not tracked changes; the author moves it).
  function insertImage(src: string, alt: string) {
    const doc: TipTapDoc = {
      type: "doc",
      content: [...(bodyDocRef.current.content ?? []), { type: "image", attrs: { src, alt, title: alt } }],
    };
    replaceDoc(doc, projectToPlain(doc), countDocWords(doc));
    setNotice(`Inserted "${alt}" at the end of the section. Drag it where it belongs, then save.`);
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

  // Brain passages and content blocks: above the editor when stacked,
  // below the two panes when side by side.
  const helperPanels = (
    <>
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
      {/* BL-FB-GEN-BLOCKS — versioned boilerplate, inserted by tag as a tracked suggestion */}
      <ContentBlocksPanel
        proposalId={proposalId}
        sectionId={section.id}
        onInsert={(text) => {
          if (plainRef.current.trim()) {
            insertTracked(text);
            return;
          }
          const next = text.trim();
          const doc = fromPlainText(next);
          replaceDoc(doc, next, next.split(/\s+/).filter(Boolean).length);
        }}
      />
    </>
  );

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
            {/* BL-AIP-6b — open review comments on this section */}
            {section.reviewComments.length > 0 ? (
              <span
                className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-200"
                title={describeOpenComments(section.reviewComments)}
              >
                ✎ {section.reviewComments.length}
              </span>
            ) : null}
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {section.title}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            <span>{SECTION_KIND_LABELS[section.kind]}</span>
            <span>·</span>
            <span>{words} words</span>
            {liveCap !== null ? (
              <>
                <span>·</span>
                {/* BL-FB-SCAN-PAGE-REALTIME — live pages against the cap */}
                <PageBudgetRing words={words} cap={liveCap} />
              </>
            ) : null}
            {section.authorName || section.authorEmail ? (
              <>
                <span>·</span>
                <span>{section.authorName ?? section.authorEmail}</span>
              </>
            ) : null}
            {/* BL-FB-CHAT-MULTI Slice 2 — teammates wrote in the thread since you looked */}
            {chatUnread > 0 ? (
              <span
                className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] normal-case tracking-widest text-amber-200"
                title={`${chatUnread} chat message${chatUnread === 1 ? "" : "s"} from teammates since you last looked`}
              >
                💬 {chatUnread} new
              </span>
            ) : null}
            {/* BL-FB-GEN-VOICE Slice 2 — what the drafter and chat write this section in */}
            {voiceOn ? (
              <span
                className="rounded border border-plum-400/40 bg-plum-400/10 px-1.5 py-0.5 text-[9px] normal-case tracking-widest text-plum-300"
                title={`The drafter and chat write this section in ${section.authorName ?? section.authorEmail ?? "the author"}'s voice${houseStyle ? ", under the team's house style" : ""}.`}
              >
                ✦ in {(section.authorName ?? section.authorEmail ?? "the author").split(/[\s@]/)[0]}&apos;s voice
              </span>
            ) : houseStyle ? (
              <span className="rounded border border-plum-400/40 bg-plum-400/10 px-1.5 py-0.5 text-[9px] normal-case tracking-widest text-plum-300" title="The drafter and chat follow the team's house style for this section.">
                ✦ house style
              </span>
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
            {/* BL-AIP-6b — what reviewers and the AI pre-review asked of this section */}
            <ReviewCommentsPanel proposalId={proposalId} comments={section.reviewComments} />
            {/* BL-FB-CHAT-SIDEBYSIDE — one column stacked, or chat left / draft right */}
            <div
              className={
                sideBySide
                  ? "grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start"
                  : "flex flex-col gap-2"
              }
            >
              <div className="flex min-w-0 flex-col gap-2">
                <AiAssistantPanel
                  sectionId={section.id}
                  hasContent={plainContent.trim().length > 0}
                  getCurrentText={() => plainRef.current}
                  onAccept={(doc, plain, count) => replaceDoc(doc, plain, count)}
                  onApplyTracked={applyTracked}
                  improveRequest={improveRequest}
                  onPendingChange={setAiPending}
                  layout={sideBySide ? "side" : "stacked"}
                  onLayoutChange={changeLayout}
                  onSuggestion={onSuggestion}
                  members={team}
                  initialOpen={initialChatOpen}
                  initialTab={initialChatOpen ? "chat" : undefined}
                  initialMessageId={initialMessageId}
                  onRead={markChatRead}
                />
                {!sideBySide ? helperPanels : null}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <label className="aur-label mb-0">Content</label>
                    {sideBySide && suggestion ? (
                      <div className="flex gap-1 rounded border border-layer/10 p-0.5">
                        {(["draft", "preview"] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setRightTab(tab)}
                            className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                              rightTab === tab ? "bg-indigo-400/20 text-indigo-200" : "text-muted hover:text-text"
                            }`}
                          >
                            {tab === "draft" ? "Draft" : `Edits preview${suggestion.streaming ? " · streaming…" : ""}`}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <span className="flex items-center gap-2 font-mono text-[10px] text-muted">
                    <span>{words} words</span>
                    {liveCap !== null ? <PageBudgetRing words={words} cap={liveCap} size={12} /> : null}
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
                {/* The editor stays mounted behind the preview so collab and track-changes state survive the switch. */}
                <div className={sideBySide && rightTab === "preview" && suggestion ? "hidden" : "contents"}>
                  <RichSectionEditor
                    doc={bodyDoc}
                    docVersion={docVersion}
                    reviewSignal={reviewSignal}
                    onCursorParagraph={setCursorParagraph}
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
                </div>
                {sideBySide && rightTab === "preview" && suggestion ? (
                  <DraftPreview
                    key={suggestion.id}
                    draft={plainContent}
                    proposed={suggestion.text}
                    streaming={suggestion.streaming}
                    onApply={applyPreview}
                    onBack={() => setRightTab("draft")}
                  />
                ) : null}
                <input type="hidden" value={plainContent} readOnly />
              </div>
            </div>
            {sideBySide ? helperPanels : null}
            {/* BL-FB-SCAN-TONE — marketing language, passive voice, reading level */}
            <TonePanel
              text={plainContent}
              fixBusy={aiPending}
              onFix={(hint) => setImproveRequest({ hint, nonce: Date.now() })}
            />
            {/* BL-FB-GEN-VOICE Slice 2 — does the draft read like its author? */}
            <VoiceCheckPanel
              sectionId={section.id}
              text={plainContent}
              enabled={voiceOn}
              fixBusy={aiPending}
              onFix={(hint) => setImproveRequest({ hint, nonce: Date.now() })}
            />
            {/* BL-FB-GEN-GRAPHICS — diagrams the section would benefit from */}
            <GraphicsPanel sectionId={section.id} getCurrentText={() => plainRef.current} onInsertImage={insertImage} />
            {/* BL-AIP-6 — research while you write */}
            <ResearchRail
              sectionId={section.id}
              text={plainContent}
              cursorParagraph={cursorParagraph}
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
