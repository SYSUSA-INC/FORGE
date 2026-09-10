/**
 * BL-AI-STREAMING — minimal Server-Sent Events helpers.
 *
 * Pure module (no server-only, no DOM assumptions beyond TextEncoder /
 * TextDecoder / ReadableStream, all of which exist in Node 18+, edge
 * and browsers) so the same code serves the route handler that emits
 * events, the gateway that consumes a provider's SSE stream, and the
 * client component that reads ours.
 *
 * Wire format we emit: one `data: <json>\n\n` block per event. We never
 * use `event:` or `id:` fields, so a parser only has to join `data:`
 * lines per block.
 */

const encoder = new TextEncoder();

/** Encode one JSON-serialisable event as an SSE data block. */
export function encodeSseEvent(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Response headers for a streaming SSE body. */
export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Tell nginx-style proxies (and Vercel's edge) not to buffer.
    "x-accel-buffering": "no",
  };
}

export type SseParser = {
  /** Feed a decoded text chunk; returns the `data` payloads of every complete block. */
  push(chunk: string): string[];
  /** Return the payload of a trailing block that never got its blank line. */
  flush(): string[];
};

/**
 * Incremental SSE block parser. Blocks are separated by a blank line;
 * within a block, `data:` lines are joined with `\n` per the spec.
 * Other fields (`event:`, `id:`, comments) are ignored.
 */
export function createSseParser(): SseParser {
  let buffer = "";

  function extract(block: string): string | null {
    const dataLines: string[] = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (!rawLine.startsWith("data:")) continue;
      // Spec: strip a single leading space after the colon if present.
      const v = rawLine.slice(5);
      dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
    }
    return dataLines.length > 0 ? dataLines.join("\n") : null;
  }

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      // A block ends at a blank line. Keep whatever follows the last
      // separator as the partial buffer for the next push.
      for (;;) {
        const m = /\r?\n\r?\n/.exec(buffer);
        if (!m) break;
        const block = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const payload = extract(block);
        if (payload !== null) out.push(payload);
      }
      return out;
    },
    flush(): string[] {
      const rest = buffer;
      buffer = "";
      if (!rest.trim()) return [];
      const payload = extract(rest);
      return payload !== null ? [payload] : [];
    },
  };
}

/**
 * Read an SSE response to completion, invoking `onEvent` for every JSON
 * payload. Non-JSON payloads (e.g. OpenAI's `[DONE]`) are skipped.
 * Resolves when the stream ends; rejects on abort or network error.
 */
export async function readSseStream(
  res: Response,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error("Response has no body to stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  const deliver = (payloads: string[]) => {
    for (const p of payloads) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(p);
      } catch {
        continue;
      }
      onEvent(parsed);
    }
  };

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      deliver(parser.push(decoder.decode(value, { stream: true })));
    }
    deliver(parser.push(decoder.decode()));
    deliver(parser.flush());
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
