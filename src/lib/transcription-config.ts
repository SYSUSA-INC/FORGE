/**
 * BL-FB-CHAT-VOICE — which transcription provider the server may call.
 *
 * Any OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI, Groq,
 * a self-hosted Whisper) works: `TRANSCRIPTION_API_URL` is the API base
 * and `TRANSCRIPTION_API_KEY` its key, `TRANSCRIPTION_MODEL` the model
 * (default whisper-1). With only `OPENAI_API_KEY` set, OpenAI is used.
 * Pure; the server library and the settings status both read it.
 */

export type TranscriptionConfig = {
  /** API base without a trailing slash, e.g. https://api.openai.com/v1 */
  url: string;
  key: string;
  model: string;
  /** Host name, for the status page. */
  provider: string;
};

export const OPENAI_API_BASE = "https://api.openai.com/v1";
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

export function parseTranscriptionEnv(env: Record<string, string | undefined>): TranscriptionConfig | null {
  const explicitUrl = (env.TRANSCRIPTION_API_URL ?? "").trim();
  const explicitKey = (env.TRANSCRIPTION_API_KEY ?? "").trim();
  const openaiKey = (env.OPENAI_API_KEY ?? "").trim();
  const key = explicitKey || (explicitUrl === "" || explicitUrl.startsWith(OPENAI_API_BASE) ? openaiKey : "");
  if (!key) return null;
  const url = (explicitUrl || OPENAI_API_BASE).replace(/\/audio\/transcriptions\/?$/i, "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) return null;
  let provider = "custom";
  try {
    provider = new URL(url).host;
  } catch {
    return null;
  }
  return { url, key, model: (env.TRANSCRIPTION_MODEL ?? "").trim() || DEFAULT_TRANSCRIPTION_MODEL, provider };
}
