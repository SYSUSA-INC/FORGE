/**
 * FORGE embeddings gateway.
 *
 * Provider-agnostic embedding interface. Live mode uses OpenAI's
 * text-embedding-3-small (1536 dims). Stub mode generates
 * deterministic 1536-dim vectors from a seeded hash so the UI flow
 * (chunking, indexing, semantic search) is testable without an API
 * key. Stub vectors are NOT semantically meaningful — search results
 * in stub mode are technically correct but practically useless.
 *
 * Pinned to 1536 dims so we don't have to re-create the pgvector
 * column to swap providers. If we ever add Voyage / Cohere, we'd
 * either pad/truncate to 1536 or run a separate column.
 */

import { KNOWLEDGE_EMBEDDING_DIM } from "@/db/schema";

export type EmbeddingProviderName = "openai" | "stub";

export type EmbeddingResult = {
  vectors: number[][];
  provider: EmbeddingProviderName;
  model: string;
  stubbed: boolean;
};

export type EmbeddingProviderStatus = {
  name: EmbeddingProviderName;
  configured: boolean;
  reason: string;
};

export function getEmbeddingProviderStatus(): {
  active: EmbeddingProviderStatus;
  all: EmbeddingProviderStatus[];
} {
  const requested = (
    process.env.EMBEDDING_PROVIDER ?? "openai"
  ).toLowerCase();
  const all: EmbeddingProviderStatus[] = [
    statusFor("openai"),
    { name: "stub", configured: true, reason: "Stub is always available" },
  ];

  let active: EmbeddingProviderStatus;
  if (requested === "stub") {
    active = { name: "stub", configured: true, reason: "Stub explicitly selected" };
  } else if (requested === "openai") {
    const s = statusFor("openai");
    active = s.configured
      ? s
      : { name: "stub", configured: true, reason: `Falling back: ${s.reason}` };
  } else {
    active = {
      name: "stub",
      configured: true,
      reason: `Unknown EMBEDDING_PROVIDER="${requested}", falling back to stub`,
    };
  }

  return { active, all };
}

function statusFor(name: EmbeddingProviderName): EmbeddingProviderStatus {
  if (name === "openai") {
    const key = process.env.OPENAI_API_KEY;
    return key
      ? {
          name,
          configured: true,
          reason: "OPENAI_API_KEY present",
        }
      : { name, configured: false, reason: "OPENAI_API_KEY not set" };
  }
  return { name: "stub", configured: true, reason: "Stub" };
}

/**
 * Embed a batch of texts and return one vector per input. Inputs >
 * 8000 chars are truncated client-side — text-embedding-3-small caps
 * at 8191 tokens per item.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult> {
  const cleaned = texts.map((t) => t.slice(0, 8000));
  const { active } = getEmbeddingProviderStatus();

  if (active.name === "openai") {
    return embedOpenAI(cleaned);
  }
  return embedStub(cleaned);
}

const OPENAI_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

async function embedOpenAI(texts: string[]): Promise<EmbeddingResult> {
  const key = process.env.OPENAI_API_KEY!;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: texts,
      dimensions: KNOWLEDGE_EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: { embedding: number[]; index: number }[];
    model?: string;
  };
  const vectors = (json.data ?? [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  if (vectors.length !== texts.length) {
    throw new Error(
      `OpenAI returned ${vectors.length} vectors for ${texts.length} inputs`,
    );
  }

  return {
    vectors,
    provider: "openai",
    model: json.model ?? OPENAI_MODEL,
    stubbed: false,
  };
}

/**
 * Deterministic, hash-based stub embedder. Same input → same output,
 * which keeps tests stable. The vectors are normalized to unit length
 * so cosine distance behaves sensibly, but they have no semantic
 * meaning beyond "two similar inputs hash to similar buckets".
 */
function embedStub(texts: string[]): EmbeddingResult {
  const vectors = texts.map((t) => stubVector(t));
  return {
    vectors,
    provider: "stub",
    model: "stub-embedding-1536",
    stubbed: true,
  };
}

function stubVector(text: string): number[] {
  const dim = KNOWLEDGE_EMBEDDING_DIM;
  const out = new Array<number>(dim).fill(0);

  // Tokenize into rough word buckets and hash each into a few slots.
  // Keeps similar text close-ish in vector space without the cost of
  // real semantic embedding.
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const a = hash32(tok);
    const b = hash32("salt-" + tok);
    out[a % dim]! += 1;
    out[b % dim]! += 0.5;
  }
  // Add a small dependence on length so empty vs full text differs.
  out[0]! += Math.log1p(text.length) / 10;

  // Normalize to unit length.
  let mag = 0;
  for (const v of out) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) {
    out[0] = 1;
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / mag;
  return out;
}

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Format a JS number array as a pgvector literal: `[0.1,0.2,…]`.
 * pgvector accepts either string-cast (`'[…]'::vector`) or array
 * arrays — strings are simpler over the wire.
 */
export function vectorToPgLiteral(vec: number[]): string {
  // Cap precision so we don't blow query size on huge dims.
  return `[${vec.map((v) => v.toFixed(6)).join(",")}]`;
}

/**
 * Parse pgvector's text representation back into a number array.
 * pgvector returns `'[0.1,0.2,…]'` as a string when read as text.
 */
export function pgLiteralToVector(s: string | null): number[] | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n));
}
