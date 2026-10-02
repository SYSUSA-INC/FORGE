"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import type { TipTapDoc } from "@/db/schema";
import type { SectionDraftResult } from "./actions";
import {
  generateSectionDraftABAction,
  selectABVariantAction,
  type ABDraftResult,
} from "./ab-actions";
import {
  attachChatDocumentAction,
  clearSectionChatAction,
  getSectionChatHistoryAction,
  listChatAttachmentsAction,
  removeChatAttachmentAction,
  saveChatAttachmentToKnowledgeAction,
  type ChatAttachmentView,
  type ChatMessage,
} from "./chat-actions";
import { CHAT_ATTACHMENT_ACCEPT, describeChars } from "@/lib/chat-attachments-logic";
import type { SectionDraftMode } from "@/lib/ai-prompts";
import {
  isChatStreamEvent,
  isDraftStreamEvent,
  type DraftSource,
} from "@/lib/ai-stream-types";
import { extractCitationStats } from "@/lib/citations";
import { readSseStream } from "@/lib/sse";

type Success = Extract<SectionDraftResult, { ok: true }>;
type ActiveTab = "generate" | "chat";

/**
 * BL-FB-GEN-CITE — legend for the numbered sources the drafter could
 * cite, with live counts parsed from the text: which sources were used
 * and how many claims still need a citation.
 */
function SourceLegend({
  sources,
  stubbed,
  text,
}: {
  sources: DraftSource[];
  stubbed: boolean;
  text: string;
}) {
  const stats = extractCitationStats(text);
  const cited = new Set(stats.citedSources);
  return (
    <div className="mt-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
        <span>
          Sources · {cited.size}/{sources.length} cited
          {stubbed ? " · stub embeddings" : ""}
        </span>
        {stats.needsCitation > 0 ? (
          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 tracking-widest text-amber-200">
            {stats.needsCitation} needs citation
          </span>
        ) : text.trim() ? (
          <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 tracking-widest text-emerald-300">
            no unsupported claims
          </span>
        ) : null}
      </div>
      <ul className="space-y-1">
        {sources.map((s) => {
          const used = cited.has(s.index);
          return (
            <li
              key={s.index}
              className={`flex gap-2 font-body text-[11px] leading-relaxed ${used ? "text-text" : "text-muted"}`}
            >
              <span
                className={`shrink-0 rounded px-1 font-mono text-[10px] ${
                  used
                    ? "border border-teal/40 bg-teal/10 text-teal"
                    : "border border-layer/10 text-muted"
                }`}
              >
                S{s.index}
              </span>
              <span className="min-w-0">
                {s.href ? (
                  <a href={s.href} target="_blank" rel="noreferrer" className="hover:underline">
                    {s.label}
                  </a>
                ) : (
                  <span>{s.label}</span>
                )}
                {s.outcomeLabel && s.outcomeLabel !== "none" ? (
                  <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                    {s.outcomeLabel}
                  </span>
                ) : null}
                <span className="block truncate text-muted">{s.excerpt}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * BL-AI-STREAMING — read a failed (non-SSE) response into a message the
 * user can act on. Middleware and the route both answer JSON on refusal;
 * an HTML body means the session bounced to sign-in.
 */
async function readErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === "string" && j.error) return j.error;
    } catch {
      // fall through
    }
  }
  if (res.status === 401 || ct.includes("text/html")) {
    return "Your session has expired. Sign in again to continue.";
  }
  return `Request failed (${res.status}).`;
}

type Props = {
  sectionId: string;
  hasContent: boolean;
  onAccept: (bodyDoc: TipTapDoc, plain: string, words: number) => void;
  /**
   * BL-AIP-2 — the section text as it stands in the editor. Improve,
   * Tighten and Chat send it so the AI works on what the writer sees,
   * not the last saved copy. A getter (not a value) so keystrokes do not
   * re-render this panel.
   */
  getCurrentText?: () => string;
  /**
   * BL-AIP-6 — apply the AI text as tracked changes authored "FORGE AI"
   * on top of the current document, so the owner accepts or rejects
   * paragraph by paragraph and formatting outside the edits survives.
   * The default action whenever the section already has content.
   */
  onApplyTracked?: (text: string) => void;
  /**
   * BL-FB-SCAN-TONE — click-to-fix from the tone check: open the panel
   * and run Improve with this guidance. A new nonce starts a new pass.
   */
  improveRequest?: { hint: string; nonce: number } | null;
  /** Reports whether a draft pass is running (the tone panel disables its button). */
  onPendingChange?: (pending: boolean) => void;
  /**
   * BL-FB-CHAT-SIDEBYSIDE — "side" puts the panel in the left pane next
   * to the draft: always open, on the Chat tab, with a taller thread.
   */
  layout?: "stacked" | "side";
  onLayoutChange?: (layout: "stacked" | "side") => void;
  /**
   * The chat reply as it streams and once it is done — or an earlier
   * reply the author asks to preview (`explicit`) — so the right pane can
   * show it as edits to the draft. null clears the preview.
   */
  onSuggestion?: (s: { text: string; streaming: boolean; explicit: boolean } | null) => void;
};

/** The routes cap the live body at 60k characters. */
const LIVE_BODY_MAX_CHARS = 60_000;

const MODES: { key: SectionDraftMode; label: string; description: string }[] = [
  {
    key: "draft",
    label: "Draft",
    description: "Generate a first draft from the proposal context and solicitation requirements.",
  },
  {
    key: "improve",
    label: "Improve",
    description:
      "Tighten prose, surface themes, fix weak phrasing — keep facts.",
  },
  {
    key: "tighten",
    label: "Tighten",
    description: "Cut to fit the section's page cap. Keep every fact.",
  },
];

export function AiAssistantPanel({
  sectionId,
  hasContent,
  onAccept,
  getCurrentText,
  onApplyTracked,
  improveRequest,
  onPendingChange,
  layout = "stacked",
  onLayoutChange,
  onSuggestion,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("generate");
  // BL-FB-CHAT-SIDEBYSIDE — the left pane is always open, on the chat.
  const isOpen = open || layout === "side";
  useEffect(() => {
    if (layout === "side") setActiveTab("chat");
  }, [layout]);

  // Generate tab state. `pending` is plain state (not useTransition)
  // because the draft streams over fetch rather than a server action.
  const [pending, setPending] = useState(false);
  // BL-FB-SCAN-TONE — the guidance the running / finished pass was given.
  const [guidance, setGuidance] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A request that predates this mount (section collapsed and reopened)
  // is not re-run.
  const lastRequestRef = useRef(improveRequest?.nonce ?? 0);
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Success | null>(null);
  const [mode, setMode] = useState<SectionDraftMode>(
    hasContent ? "improve" : "draft",
  );
  // BL-FB-GEN-CITE — citation mode + the legend streamed before the body.
  // BL-AIP-5 — on by default; the author opts out per draft.
  const [cite, setCite] = useState(true);
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [sourcesStubbed, setSourcesStubbed] = useState(false);
  // One in-flight stream per panel; a new request or Discard aborts it.
  const draftAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      draftAbortRef.current?.abort();
      chatAbortRef.current?.abort();
    };
  }, []);

  // A/B compare state (BL-11)
  type ABSuccess = Extract<ABDraftResult, { ok: true }>;
  const [abPending, startAbTransition] = useTransition();
  const [abResult, setAbResult] = useState<ABSuccess | null>(null);
  const [abError, setAbError] = useState<string | null>(null);

  // Chat tab state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // BL-FB-CHAT-PERSIST — load the section's thread the first time the
  // chat tab is shown, so reopening a section resumes the conversation.
  const [chatLoaded, setChatLoaded] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  // BL-FB-CHAT-UPLOAD — reference documents scoped to this conversation.
  const [attachments, setAttachments] = useState<ChatAttachmentView[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  useEffect(() => {
    if (!open || activeTab !== "chat" || chatLoaded || chatLoading) return;
    let cancelled = false;
    setChatLoading(true);
    Promise.all([getSectionChatHistoryAction(sectionId), listChatAttachmentsAction(sectionId)])
      .then(([res, att]) => {
        if (cancelled) return;
        if (res.ok) {
          setChatHistory(
            res.messages.map((m) => ({
              role: m.role,
              content: m.content,
              authorName: m.authorName,
              isMine: m.isMine,
            })),
          );
        }
        if (att.ok) setAttachments(att.attachments);
        setChatLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setChatLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, chatLoaded, chatLoading, sectionId]);

  function cancelDraft() {
    draftAbortRef.current?.abort();
    draftAbortRef.current = null;
    setPending(false);
    setStreamText("");
  }

  async function generate(forMode: SectionDraftMode, hint?: string) {
    draftAbortRef.current?.abort();
    const ac = new AbortController();
    draftAbortRef.current = ac;

    setError(null);
    setResult(null);
    setAbResult(null);
    setMode(forMode);
    setGuidance(hint?.trim() ? hint.trim() : null);
    setStreamText("");
    setSources([]);
    setSourcesStubbed(false);
    setPending(true);

    let acc = "";
    let finished = false;
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sectionId,
          mode: forMode,
          cite,
          currentBodyPlain: getCurrentText?.().slice(0, LIVE_BODY_MAX_CHARS),
          ...(hint?.trim() ? { hint: hint.trim() } : {}),
        }),
        signal: ac.signal,
      });
      const isSse = (res.headers.get("content-type") ?? "").includes(
        "text/event-stream",
      );
      if (!res.ok || !isSse) {
        setError(await readErrorMessage(res));
        return;
      }
      await readSseStream(
        res,
        (ev) => {
          if (!isDraftStreamEvent(ev)) return;
          if (ev.type === "sources") {
            setSources(ev.sources);
            setSourcesStubbed(ev.stubbed);
          } else if (ev.type === "delta") {
            acc += ev.text;
            setStreamText(acc);
          } else if (ev.type === "done") {
            finished = true;
            setResult({ ok: true, ...ev.result });
          } else {
            finished = true;
            setError(ev.error);
          }
        },
        ac.signal,
      );
      if (!finished && !ac.signal.aborted) {
        setError("The connection closed before the draft finished. Try again.");
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : "AI request failed.");
      }
    } finally {
      if (draftAbortRef.current === ac) {
        draftAbortRef.current = null;
        setPending(false);
        setStreamText("");
      }
    }
  }

  // BL-FB-SCAN-TONE — a click on "Fix with AI" opens the panel on the
  // Generate tab and runs Improve with the tone findings as guidance.
  useEffect(() => {
    if (!improveRequest || improveRequest.nonce === lastRequestRef.current) return;
    lastRequestRef.current = improveRequest.nonce;
    setOpen(true);
    setActiveTab("generate");
    void generate("improve", improveRequest.hint);
    setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    // `generate` reads the latest props itself; the request is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [improveRequest]);

  function accept() {
    if (!result) return;
    const words = result.text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    onAccept(result.bodyDoc, result.text, words);
    setOpen(false);
    setResult(null);
  }

  // BL-AIP-6 — tracked apply is the default when there is text to
  // compare against; a first draft into an empty section still replaces.
  const canApplyTracked = hasContent && !!onApplyTracked;
  function applyTracked() {
    if (!result || !onApplyTracked) return;
    onApplyTracked(result.text);
    setOpen(false);
    setResult(null);
  }

  function generateAB() {
    setAbError(null);
    setAbResult(null);
    setResult(null);
    setError(null);
    startAbTransition(async () => {
      const res = await generateSectionDraftABAction({ sectionId });
      if (!res.ok) {
        setAbError(res.error);
        return;
      }
      setAbResult(res);
    });
  }

  function acceptAB(variant: "a" | "b") {
    if (!abResult) return;
    const chosen = variant === "a" ? abResult.variantA : abResult.variantB;
    const words = chosen.text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    // Fire-and-forget selection record
    void selectABVariantAction({
      abPairId: abResult.abPairId,
      selectedVariant: variant,
    });
    onAccept(chosen.bodyDoc, chosen.text, words);
    setOpen(false);
    setAbResult(null);
  }

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatPending) return;
    setChatInput("");
    setChatError(null);
    onSuggestion?.(null);

    const priorHistory = chatHistory;
    // Optimistic user turn + an empty assistant bubble that fills in as
    // deltas arrive. Both are rolled back on failure.
    setChatHistory([
      ...priorHistory,
      { role: "user", content: msg, isMine: true },
      { role: "assistant", content: "" },
    ]);
    setChatPending(true);

    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;

    const setAssistant = (content: string) =>
      setChatHistory((h) => {
        if (h.length === 0) return h;
        const next = h.slice();
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { role: "assistant", content };
        }
        return next;
      });
    const rollback = () => setChatHistory(priorHistory);
    const scroll = () =>
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);

    let acc = "";
    let finished = false;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // History is read server-side from the persisted thread.
        body: JSON.stringify({
          sectionId,
          message: msg,
          currentBodyPlain: getCurrentText?.().slice(0, LIVE_BODY_MAX_CHARS),
        }),
        signal: ac.signal,
      });
      const isSse = (res.headers.get("content-type") ?? "").includes(
        "text/event-stream",
      );
      if (!res.ok || !isSse) {
        setChatError(await readErrorMessage(res));
        rollback();
        return;
      }
      await readSseStream(
        res,
        (ev) => {
          if (!isChatStreamEvent(ev)) return;
          if (ev.type === "delta") {
            acc += ev.text;
            setAssistant(acc);
            onSuggestion?.({ text: acc, streaming: true, explicit: false });
            scroll();
          } else if (ev.type === "done") {
            finished = true;
            setAssistant(ev.reply);
            onSuggestion?.({ text: ev.reply, streaming: false, explicit: false });
            scroll();
          } else {
            finished = true;
            setChatError(ev.error);
            onSuggestion?.(null);
            rollback();
          }
        },
        ac.signal,
      );
      if (!finished && !ac.signal.aborted) {
        setChatError("The connection closed before the reply finished.");
        onSuggestion?.(null);
        rollback();
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
        onSuggestion?.(null);
        rollback();
      }
    } finally {
      if (chatAbortRef.current === ac) {
        chatAbortRef.current = null;
        setChatPending(false);
      }
    }
  }

  // BL-FB-CHAT-UPLOAD — attach / remove / save reference documents.
  async function attachFile(file: File) {
    setAttachBusy(true);
    setChatError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sectionId", sectionId);
      const res = await attachChatDocumentAction(fd);
      if (!res.ok) {
        setChatError(res.error);
        return;
      }
      setAttachments((list) => [...list, res.attachment]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not attach the file.");
    } finally {
      setAttachBusy(false);
    }
  }
  async function removeAttachment(id: string) {
    const res = await removeChatAttachmentAction(id);
    if (!res.ok) {
      setChatError(res.error);
      return;
    }
    setAttachments((list) => list.filter((a) => a.id !== id));
  }
  async function saveAttachment(id: string) {
    const res = await saveChatAttachmentToKnowledgeAction(id);
    if (!res.ok) {
      setChatError(res.error);
      return;
    }
    setAttachments((list) => list.map((a) => (a.id === id ? { ...a, savedArtifactId: res.artifactId } : a)));
  }

  function applyChatSuggestion(text: string) {
    // BL-AIP-6 — into an existing draft, chat language lands as tracked
    // changes the owner reviews rather than replacing the section.
    if (canApplyTracked && onApplyTracked) {
      onApplyTracked(text);
      return;
    }
    const words = text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    import("@/lib/tiptap-doc").then(({ fromPlainText }) => {
      onAccept(fromPlainText(text), text, words);
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="aur-btn aur-btn-ghost text-[11px]"
      >
        ✨ AI assist
      </button>
    );
  }

  return (
    <div ref={rootRef} className="rounded-md border border-teal/40 bg-teal/[0.04] p-3">
      {/* Header + tabs */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
            ✨ AI assist
          </span>
          <div className="flex gap-1 rounded border border-layer/10 p-0.5">
            {(["generate", "chat"] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  activeTab === tab
                    ? "bg-teal/20 text-teal"
                    : "text-muted hover:text-text"
                }`}
              >
                {tab === "generate" ? "Generate" : "Chat"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* BL-FB-CHAT-SIDEBYSIDE — chat beside the draft, or stacked above it */}
          {onLayoutChange ? (
            <button
              type="button"
              onClick={() => onLayoutChange(layout === "side" ? "stacked" : "side")}
              className="hidden font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text md:inline"
              title={layout === "side" ? "Stack the AI panel above the draft" : "Chat on the left, draft on the right"}
            >
              {layout === "side" ? "⇆ Stacked" : "⇆ Side by side"}
            </button>
          ) : null}
          {layout !== "side" ? (
            <button
              type="button"
              onClick={() => {
                cancelDraft();
                setOpen(false);
                setResult(null);
                setError(null);
              }}
              className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Generate tab ── */}
      {activeTab === "generate" ? (
        abResult ? (
          /* ── A/B comparison view ── */
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">
                A/B Compare
              </span>
              <span className="rounded bg-teal/10 px-1.5 py-0.5 font-mono text-[9px] text-teal">
                {abResult.recommended === "b" ? "Alt. recommended" : "Standard recommended"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["a", "b"] as const).map((v) => {
                const variant = v === "a" ? abResult.variantA : abResult.variantB;
                const isRecommended = abResult.recommended === v;
                return (
                  <div
                    key={v}
                    className={`flex flex-col gap-2 rounded-md border p-3 ${
                      isRecommended
                        ? "border-teal/40 bg-teal/[0.04]"
                        : "border-layer/10 bg-layer/[0.02]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                        Variant {v.toUpperCase()} · {variant.wordCount}w
                        {v === "b" ? " (alt.)" : " (standard)"}
                      </span>
                      {isRecommended ? (
                        <span className="font-mono text-[9px] text-teal">★ rec.</span>
                      ) : null}
                    </div>
                    <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded border border-layer/10 bg-canvas px-2 py-1.5 font-body text-[12px] leading-relaxed text-text">
                      {variant.text}
                    </div>
                    <button
                      type="button"
                      onClick={() => acceptAB(v)}
                      className="aur-btn aur-btn-primary text-[11px]"
                    >
                      Use Variant {v.toUpperCase()}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => { setAbResult(null); setAbError(null); }}
              className="self-start font-mono text-[9px] uppercase tracking-wider text-muted hover:text-text"
            >
              Discard comparison
            </button>
          </div>
        ) : !result ? (
          <>
            <div className="grid gap-2 md:grid-cols-3">
              {MODES.map((m) => {
                const disabled =
                  pending ||
                  ((m.key === "improve" || m.key === "tighten") && !hasContent);
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => generate(m.key)}
                    className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                      pending && mode === m.key
                        ? "border-teal/60 bg-teal/10"
                        : "border-layer/10 bg-layer/[0.02] hover:border-layer/20"
                    }`}
                  >
                    <span className="font-display text-[13px] font-semibold text-text">
                      {m.label}
                    </span>
                    <span className="font-body text-[11px] leading-relaxed text-muted">
                      {m.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Cite sources — BL-FB-GEN-CITE */}
            <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
              <input
                type="checkbox"
                checked={cite}
                onChange={(e) => setCite(e.target.checked)}
                disabled={pending}
                className="mt-0.5 accent-teal"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-display text-[13px] font-semibold text-text">
                  Cite sources
                </span>
                <span className="font-body text-[11px] leading-relaxed text-muted">
                  On by default. Ground the draft in your Brain: supported claims
                  get [S#] markers, a verifier pass checks each one against its
                  source, and anything unsupported is flagged [NEEDS CITATION]
                  instead of invented. Open markers block the export.
                </span>
              </span>
            </label>
            {/* A/B Compare button — BL-11 */}
            <button
              type="button"
              disabled={pending || abPending}
              onClick={generateAB}
              className="mt-1 flex w-full items-center justify-between rounded-md border border-teal/20 bg-teal/[0.03] px-3 py-2 text-left transition-colors hover:border-teal/40 disabled:opacity-50"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-display text-[13px] font-semibold text-teal">
                  A/B Compare
                </span>
                <span className="font-body text-[11px] text-muted">
                  Generate two drafts (standard + alternative lead) and pick the stronger one.
                </span>
              </div>
              {abPending ? (
                <span className="font-mono text-[10px] text-teal">generating…</span>
              ) : null}
            </button>
            {pending && guidance ? (
              /* BL-FB-SCAN-TONE — what this pass was asked to fix. */
              <details className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-amber-200">
                  Guidance for this pass · from the tone check
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-body text-[11px] leading-relaxed text-muted">{guidance}</pre>
              </details>
            ) : null}
            {pending ? (
              /* BL-AI-STREAMING — live preview fills in as the model writes. */
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between font-mono text-[10px] text-muted">
                  <span>
                    {streamText
                      ? `Writing… ${streamText.split(/\s+/).filter(Boolean).length} words`
                      : "Reading proposal context…"}
                  </span>
                  <button
                    type="button"
                    onClick={cancelDraft}
                    className="font-mono text-[9px] uppercase tracking-wider text-muted hover:text-text"
                  >
                    Stop
                  </button>
                </div>
                {streamText ? (
                  <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-teal/20 bg-canvas px-3 py-2 font-body text-[13px] leading-relaxed text-text">
                    {streamText}
                    <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-teal align-text-bottom" />
                  </div>
                ) : null}
                {cite && sources.length > 0 ? (
                  <SourceLegend
                    sources={sources}
                    stubbed={sourcesStubbed}
                    text={streamText}
                  />
                ) : null}
              </div>
            ) : abPending ? (
              <div className="mt-2 font-mono text-[10px] text-muted">
                Generating…
              </div>
            ) : null}
            {(error || abError) ? (
              <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
                {error ?? abError}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
              {MODES.find((m) => m.key === result.mode)?.label} preview ·{" "}
              {result.text.split(/\s+/).filter(Boolean).length} words
              {guidance ? (
                <span className="ml-2 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 tracking-widest text-amber-200" title={guidance}>
                  guided by the tone check
                </span>
              ) : null}
            </div>
            {result.truncated ? (
              <div className="mb-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 font-mono text-[11px] text-gold">
                The model hit its output limit before finishing, so this draft is
                cut short. Accept it as a start, then use Tighten, or split the
                section.
              </div>
            ) : null}
            {result.verification ? (
              <div className="mb-2 font-mono text-[10px] text-muted">
                Citation check: {result.verification.checked} cited sentence
                {result.verification.checked === 1 ? "" : "s"} reviewed
                {result.verification.unsupported > 0
                  ? ` · ${result.verification.unsupported} not supported by the cited source → flagged [NEEDS CITATION]`
                  : ""}
                {result.verification.invalidMarkers > 0
                  ? ` · ${result.verification.invalidMarkers} marker${result.verification.invalidMarkers === 1 ? "" : "s"} named no listed source → flagged`
                  : ""}
                {result.verification.skipped ? ` · check skipped (${result.verification.skipped})` : ""}
              </div>
            ) : null}
            <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-layer/10 bg-canvas px-3 py-2 font-body text-[13px] leading-relaxed text-text">
              {result.text}
            </div>
            {result.sources && result.sources.length > 0 ? (
              <SourceLegend
                sources={result.sources}
                stubbed={Boolean(result.sourcesStubbed)}
                text={result.text}
              />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-subtle">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {result.stubbed ? <StubModeBanner variant="inline" /> : null}
                <span>{result.provider}</span>
                <span>{result.model}</span>
                {typeof result.inputTokens === "number" ? (
                  <span>in {result.inputTokens}</span>
                ) : null}
                {typeof result.outputTokens === "number" ? (
                  <span>out {result.outputTokens}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => generate(result.mode, guidance ?? undefined)}
                  className="aur-btn aur-btn-ghost text-[11px]"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setError(null);
                  }}
                  className="aur-btn aur-btn-ghost text-[11px]"
                >
                  Discard
                </button>
                {canApplyTracked ? (
                  <button
                    type="button"
                    onClick={applyTracked}
                    className="aur-btn aur-btn-primary text-[11px]"
                    title="Show the AI's edits as tracked changes by FORGE AI; accept or reject each one in the editor"
                  >
                    Apply as tracked changes
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={accept}
                  className={`aur-btn ${canApplyTracked ? "aur-btn-ghost" : "aur-btn-primary"} text-[11px]`}
                  title={canApplyTracked ? "Discard the current text and use this draft as is" : undefined}
                >
                  {canApplyTracked ? "Replace section" : "Replace section with this"}
                </button>
              </div>
            </div>
          </>
        )
      ) : null}

      {/* ── Chat tab ── */}
      {activeTab === "chat" ? (
        <div className="flex flex-col gap-2">
          <p className="font-body text-[11px] text-muted">
            Ask questions, request specific language, or get feedback on this
            section. The AI has full context about the opportunity and
            solicitation requirements. The thread is saved with the section
            and shared with your team.
          </p>
          {chatLoading ? (
            <div className="font-mono text-[10px] text-muted">Loading thread…</div>
          ) : null}

          {/* Message history */}
          {chatHistory.length > 0 ? (
            <div
              className={`flex flex-col gap-2 overflow-y-auto rounded-md border border-layer/10 bg-canvas p-2 ${
                layout === "side" ? "max-h-[55vh]" : "max-h-[340px]"
              }`}
            >
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
                    {msg.role === "assistant"
                      ? "AI"
                      : msg.isMine === false && msg.authorName
                        ? msg.authorName
                        : "You"}
                  </span>
                  <div
                    className={`max-w-[90%] rounded-md px-3 py-2 font-body text-[12px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-teal/10 text-text"
                        : "border border-layer/10 bg-layer/[0.03] text-foreground"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === "assistant" && msg.content ? (
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => applyChatSuggestion(msg.content)}
                          className="font-mono text-[9px] uppercase tracking-wider text-teal hover:text-teal/80"
                          title={canApplyTracked ? "Apply as tracked changes by FORGE AI" : "Replace the section with this text"}
                        >
                          {canApplyTracked ? "Apply as tracked changes ↑" : "Apply to section ↑"}
                        </button>
                        {/* BL-FB-CHAT-SIDEBYSIDE — pick paragraphs in the right pane first */}
                        {layout === "side" && onSuggestion ? (
                          <button
                            type="button"
                            onClick={() => onSuggestion({ text: msg.content, streaming: false, explicit: true })}
                            className="font-mono text-[9px] uppercase tracking-wider text-indigo-300 hover:text-indigo-200"
                            title="Show this reply as edits to the draft, paragraph by paragraph"
                          >
                            Preview as edits →
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {chatPending &&
              !(chatHistory[chatHistory.length - 1]?.content ?? "") ? (
                <div className="font-mono text-[10px] text-muted">
                  Thinking…
                </div>
              ) : null}
              <div ref={chatBottomRef} />
            </div>
          ) : null}

          {chatError ? (
            <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
              {chatError}
            </div>
          ) : null}

          {/* BL-FB-CHAT-UPLOAD — reference documents scoped to this conversation */}
          <div className="flex flex-wrap items-center gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="aur-chip normal-case tracking-normal"
                title={`${a.fileName} · ${describeChars(a.chars)}${a.authorName ? ` · ${a.authorName}` : ""}`}
              >
                <span aria-hidden>📎</span>
                <span className="max-w-[10rem] truncate text-text">{a.fileName}</span>
                <span className="text-subtle">{describeChars(a.chars)}</span>
                {a.savedArtifactId ? (
                  <a href={`/knowledge-base/import/${a.savedArtifactId}`} className="text-emerald-300 hover:underline">
                    in Knowledge
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => void saveAttachment(a.id)}
                    className="hover:text-text"
                    title="Save this document to Knowledge so the Brain can search it"
                  >
                    Save to Knowledge
                  </button>
                )}
                <button type="button" onClick={() => void removeAttachment(a.id)} className="hover:text-rose-300" aria-label={`Remove ${a.fileName}`}>
                  ×
                </button>
              </span>
            ))}
            <label
              className={`aur-chip cursor-pointer normal-case tracking-normal hover:text-text ${attachBusy ? "opacity-60" : ""}`}
              title="Attach a PDF, Word, Excel, PowerPoint or text file as a reference for this conversation (kept with the thread, not sent to the Brain)"
            >
              {attachBusy ? "Reading…" : "📎 Attach a document"}
              <input
                type="file"
                className="hidden"
                accept={CHAT_ATTACHMENT_ACCEPT}
                disabled={attachBusy || chatPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void attachFile(f);
                }}
              />
            </label>
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Ask about this section… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="flex-1 resize-none rounded-md border border-layer/10 bg-layer/[0.04] px-3 py-2 font-body text-[12px] text-text placeholder:text-muted/50 focus:border-teal/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={sendChat}
              disabled={chatPending || !chatInput.trim()}
              className="aur-btn aur-btn-primary shrink-0 self-end text-[11px] disabled:opacity-60"
            >
              Send
            </button>
          </div>
          {chatHistory.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                chatAbortRef.current?.abort();
                setChatHistory([]);
                setAttachments([]);
                setChatError(null);
                onSuggestion?.(null);
                // BL-FB-CHAT-PERSIST — clear the saved thread too (and its attachments).
                void clearSectionChatAction(sectionId).then((res) => {
                  if (!res.ok) setChatError(res.error);
                });
              }}
              className="self-start font-mono text-[9px] uppercase tracking-wider text-muted hover:text-text"
            >
              Clear chat
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
