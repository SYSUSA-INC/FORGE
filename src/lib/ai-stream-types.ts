/**
 * BL-AI-STREAMING — wire types shared by the streaming API routes and
 * the client panel that consumes them. Pure module: no server-only, so
 * client components can import the types.
 */
import type { TipTapDoc } from "@/db/schema";
import type { SectionDraftMode } from "@/lib/ai-prompts";

/** Payload of the terminal `done` event for a streamed section draft. */
export type DraftDonePayload = {
  mode: SectionDraftMode;
  text: string;
  bodyDoc: TipTapDoc;
  provider: string;
  model: string;
  stubbed: boolean;
  inputTokens?: number;
  outputTokens?: number;
  generatedAt: string;
  /** BL-11 draft-signal row id, present for draft / draft_alt modes. */
  signalId?: string;
};

export type DraftStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: DraftDonePayload }
  | { type: "error"; error: string };

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply: string; stubbed: boolean }
  | { type: "error"; error: string };

export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

export function isDraftStreamEvent(v: unknown): v is DraftStreamEvent {
  return isStreamEventShape(v);
}

export function isChatStreamEvent(v: unknown): v is ChatStreamEvent {
  return isStreamEventShape(v);
}

function isStreamEventShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const t = (v as { type?: unknown }).type;
  return t === "delta" || t === "done" || t === "error";
}
