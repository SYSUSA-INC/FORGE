"use client";

import { useRef, useState, useTransition } from "react";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import type { TipTapDoc } from "@/db/schema";
import {
  generateSectionDraftAction,
  type SectionDraftResult,
} from "./actions";
import { chatWithSectionAction, type ChatMessage } from "./chat-actions";
import type { SectionDraftMode } from "@/lib/ai-prompts";

type Success = Extract<SectionDraftResult, { ok: true }>;
type ActiveTab = "generate" | "chat";

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

  // Generate tab state
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Success | null>(null);
  const [mode, setMode] = useState<SectionDraftMode>(
    hasContent ? "improve" : "draft",
  );

  // Chat tab state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, startChatTransition] = useTransition();
  const [chatError, setChatError] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  function generate(forMode: SectionDraftMode) {
    setError(null);
    setResult(null);
    setMode(forMode);
    startTransition(async () => {
      const res = await generateSectionDraftAction({
        sectionId,
        mode: forMode,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
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

  function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatPending) return;
    setChatInput("");
    setChatError(null);
    const nextHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: msg },
    ];
    setChatHistory(nextHistory);
    startChatTransition(async () => {
      const res = await chatWithSectionAction({
        sectionId,
        message: msg,
        history: chatHistory,
      });
      if (!res.ok) {
        setChatError(res.error);
        setChatHistory((h) => h.slice(0, -1));
        return;
      }
      setChatHistory((h) => [
        ...h,
        { role: "assistant", content: res.reply },
      ]);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    });
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
        !result ? (
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
            {pending ? (
              <div className="mt-2 font-mono text-[10px] text-muted">
                Generating…
              </div>
            ) : null}
            {error ? (
              <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
                {error}
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
              {chatPending ? (
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
