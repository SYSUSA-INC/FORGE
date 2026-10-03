/**
 * BL-FB-CHAT-VOICE — dictation in the section chat, pure parts.
 *
 * Where the browser transcribes speech itself (Chrome, Edge, Safari:
 * the Web Speech API), dictation never leaves the device. Elsewhere the
 * microphone is recorded and the clip is transcribed by the server when
 * a transcription provider is configured. This module holds the limits,
 * the feature detection (with the globals injected, so it is testable)
 * and the text merge the hook uses. Client-safe.
 */

export const DICTATION_LIMITS = {
  /** A clip stops recording here; the route refuses longer declared durations. */
  maxSeconds: 120,
  /** Vercel caps request bodies at 4.5 MB; stay under it. */
  maxBytes: 4 * 1024 * 1024,
  /** Characters of interim speech shown under the box. */
  interimPreviewChars: 240,
} as const;

/** Container types MediaRecorder may offer, most compact first. */
export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
] as const;

/** Audio the transcription route accepts. */
export const TRANSCRIBE_ACCEPTED = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac|flac)(;|$)/i;

/** The first candidate the browser can record, or null. */
export function pickRecordingMimeType(isSupported: (type: string) => boolean): string | null {
  for (const t of RECORDING_MIME_CANDIDATES) if (isSupported(t)) return t;
  return null;
}

/**
 * Append dictated text to what is already in the box: one space (or
 * the existing line break) between them, and a capital after a sentence
 * end or at the very start, so dictation in pieces reads as prose.
 */
export function mergeTranscript(base: string, addition: string): string {
  const add = addition.replace(/\s+/g, " ").trim();
  if (!add) return base;
  const head = base.replace(/[ \t]+$/g, "");
  const capitalise = head === "" || /[.!?]\s*$/.test(head) || /\n$/.test(head);
  const text = capitalise ? add.charAt(0).toUpperCase() + add.slice(1) : add;
  if (head === "") return text;
  if (/\n$/.test(head)) return head + text;
  return `${head} ${text}`;
}

export type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
export type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's speech recogniser, standard or WebKit-prefixed, or null. */
export function getSpeechRecognitionCtor(w: unknown): SpeechRecognitionCtor | null {
  if (!w || typeof w !== "object") return null;
  const g = w as Record<string, unknown>;
  const ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

/** Microphone capture is possible: MediaRecorder plus getUserMedia. */
export function canRecordAudio(w: unknown): boolean {
  if (!w || typeof w !== "object") return false;
  const g = w as { MediaRecorder?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } } };
  return typeof g.MediaRecorder === "function" && typeof g.navigator?.mediaDevices?.getUserMedia === "function";
}

/** Friendly text for the Web Speech API's error codes. */
export function describeSpeechError(code: string | undefined): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow it in the browser's site settings and try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "The browser's speech service is unreachable right now.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return code ? `Dictation stopped (${code}).` : "Dictation stopped.";
  }
}
