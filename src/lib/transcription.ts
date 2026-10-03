/**
 * BL-FB-CHAT-VOICE — server-side transcription for browsers without the
 * Web Speech API. One bounded call to the configured OpenAI-compatible
 * endpoint; the clip is never stored. Callers own auth, gates and
 * limits. Server-only.
 */
import "server-only";

import { log } from "@/lib/log";
import { parseTranscriptionEnv, type TranscriptionConfig } from "@/lib/transcription-config";

export function transcriptionConfig(): TranscriptionConfig | null {
  return parseTranscriptionEnv(process.env);
}

export type TranscribeResult =
  | { ok: true; text: string; provider: string; model: string }
  | { ok: false; error: string; status?: number };

export async function transcribeAudio(input: {
  bytes: ArrayBuffer;
  contentType: string;
  fileName: string;
  /** BCP-47 language the browser reported, e.g. "en-US"; sent as its two-letter code. */
  language?: string;
}): Promise<TranscribeResult> {
  const cfg = transcriptionConfig();
  if (!cfg) return { ok: false, error: "No transcription provider is configured on the server." };
  const form = new FormData();
  form.append("file", new Blob([input.bytes], { type: input.contentType }), input.fileName);
  form.append("model", cfg.model);
  form.append("response_format", "json");
  const lang = (input.language ?? "").split("-")[0]?.toLowerCase();
  if (lang && /^[a-z]{2}$/.test(lang)) form.append("language", lang);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(`${cfg.url}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.key}` },
      body: form,
      signal: ac.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      log.warn("[transcription]", "provider refused", { status: res.status, body: text.slice(0, 300) });
      return { ok: false, error: `Transcription failed (${cfg.provider} ${res.status}).`, status: res.status };
    }
    let out = "";
    try {
      out = ((JSON.parse(text) as { text?: unknown }).text ?? "") as string;
    } catch {
      out = text;
    }
    return { ok: true, text: String(out ?? "").trim(), provider: cfg.provider, model: cfg.model };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    log.warn("[transcription]", aborted ? "provider timed out" : "provider call failed", { error: err });
    return { ok: false, error: aborted ? "Transcription timed out." : "Transcription failed." };
  } finally {
    clearTimeout(timer);
  }
}
