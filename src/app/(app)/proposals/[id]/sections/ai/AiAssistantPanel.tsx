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
import type { ChatMessage } from "./chat-actions";
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
    <div className="mt-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
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
                    : "border border-white/10 text-muted"
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
};

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

export function AiAssistantPanel({ sectionId, hasContent, onAccept }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("generate");

  // Generate tab state. `pending` is plain state (not useTransition)
  // because the draft streams over fetch rather than a server action.
  const [pending, setPending] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Success | null>(null);
  const [mode, setMode] = useState<SectionDraftMode>(
    hasContent ? "improve" : "draft",
  );
  // BL-FB-GEN-CITE — citation mode + the legend streamed before the body.
  const [cite, setCite] = useState(false);
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

  function cancelDraft() {
    draftAbortRef.current?.abort();
    draftAbortRef.current = null;
    setPending(false);
    setStreamText("");
  }

  async function generate(forMode: SectionDraftMode) {
    draftAbortRef.current?.abort();
    const ac = new AbortController();
    draftAbortRef.current = ac;

    setError(null);
    setResult(null);
    setMode(forMode);
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
        body: JSON.stringify({ sectionId, mode: forMode, cite }),
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

  function accept() {
    if (!result) return;
    const words = result.text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    onAccept(result.bodyDoc, result.text, words);
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

    const priorHistory = chatHistory;
    // Optimistic user turn + an empty assistant bubble that fills in as
    // deltas arrive. Both are rolled back on failure.
    setChatHistory([
      ...priorHistory,
      { role: "user", content: msg },
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
        body: JSON.stringify({ sectionId, message: msg, history: priorHistory }),
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
            scroll();
          } else if (ev.type === "done") {
            finished = true;
            setAssistant(ev.reply);
            scroll();
          } else {
            finished = true;
            setChatError(ev.error);
            rollback();
          }
        },
        ac.signal,
      );
      if (!finished && !ac.signal.aborted) {
        setChatError("The connection closed before the reply finished.");
        rollback();
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        setChatError(err instanceof Error ? err.message : "Chat request failed.");
        rollback();
      }
    } finally {
      if (chatAbortRef.current === ac) {
        chatAbortRef.current = null;
        setChatPending(false);
      }
    }
  }

  function applyChatSuggestion(text: string) {
    const words = text
      .split(/\s+/g)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    import("@/lib/tiptap-doc").then(({ fromPlainText }) => {
      onAccept(fromPlainText(text), text, words);
    });
  }

  if (!open) {
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
    <div className="rounded-md border border-teal/40 bg-teal/[0.04] p-3">
      {/* Header + tabs */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-teal">
            ✨ AI assist
          </span>
          <div className="flex gap-1 rounded border border-white/10 p-0.5">
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
                        : "border-white/10 bg-white/[0.02]"
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
                    <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded border border-white/10 bg-canvas px-2 py-1.5 font-body text-[12px] leading-relaxed text-text">
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
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
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
            <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
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
                  Ground the draft in your Brain. Supported claims get [S#]
                  markers you can verify; anything unsupported is flagged
                  [NEEDS CITATION] instead of invented.
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
            </div>
            <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md border border-white/10 bg-canvas px-3 py-2 font-body text-[13px] leading-relaxed text-text">
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
                  onClick={() => generate(result.mode)}
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
                <button
                  type="button"
                  onClick={accept}
                  className="aur-btn aur-btn-primary text-[11px]"
                >
                  Replace section with this
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
            solicitation requirements.
          </p>

          {/* Message history */}
          {chatHistory.length > 0 ? (
            <div className="flex max-h-[340px] flex-col gap-2 overflow-y-auto rounded-md border border-white/10 bg-canvas p-2">
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
                    {msg.role === "user" ? "You" : "AI"}
                  </span>
                  <div
                    className={`max-w-[90%] rounded-md px-3 py-2 font-body text-[12px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-teal/10 text-text"
                        : "border border-white/10 bg-white/[0.03] text-foreground"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === "assistant" ? (
                      <button
                        type="button"
                        onClick={() => applyChatSuggestion(msg.content)}
                        className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-teal hover:text-teal/80"
                      >
                        Apply to section ↑
                      </button>
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
              className="flex-1 resize-none rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 font-body text-[12px] text-text placeholder:text-muted/50 focus:border-teal/40 focus:outline-none"
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
                setChatHistory([]);
                setChatError(null);
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
