/**
 * BL-AI-STREAMING — wire types shared by the streaming API routes and
 * the client panel that consumes them. Pure module: no server-only, so
 * client components can import the types.
 */
import type { TipTapDoc } from "@/db/schema";
import type { SectionDraftMode } from "@/lib/ai-prompts";
import type { CitationStats, DraftSource } from "@/lib/citations";

export type { DraftSource } from "@/lib/citations";

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
  /** BL-FB-GEN-CITE — sources offered to the model (citation mode only). */
  sources?: DraftSource[];
  /** BL-FB-GEN-CITE — marker counts parsed from the final text (citation mode only). */
  citations?: CitationStats;
  /** True when sources came from the stub embedder and are not meaningful. */
  sourcesStubbed?: boolean;
};

export type DraftStreamEvent =
  | { type: "sources"; sources: DraftSource[]; stubbed: boolean }
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
  return t === "delta" || t === "done" || t === "error" || t === "sources";
}
