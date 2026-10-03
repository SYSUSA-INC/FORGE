/**
 * BL-FB-CHAT-VOICE — dictation, pure parts: text merge, recorder type
 * choice, feature detection with injected globals, provider config.
 */
import { describe, expect, it } from "vitest";
import {
  DICTATION_LIMITS,
  TRANSCRIBE_ACCEPTED,
  canRecordAudio,
  describeSpeechError,
  getSpeechRecognitionCtor,
  mergeTranscript,
  pickRecordingMimeType,
} from "@/lib/dictation";
import { OPENAI_API_BASE, parseTranscriptionEnv } from "@/lib/transcription-config";

describe("dictation", () => {
  it("merges dictated pieces into prose", () => {
    expect(mergeTranscript("", "we staff ten analysts")).toBe("We staff ten analysts");
    expect(mergeTranscript("We staff ten analysts", "on three shifts.")).toBe("We staff ten analysts on three shifts.");
    expect(mergeTranscript("We staff ten analysts.", "the lead is named.")).toBe("We staff ten analysts. The lead is named.");
    expect(mergeTranscript("First line\n", "second line")).toBe("First line\nSecond line");
    expect(mergeTranscript("Keep this  ", "  ")).toBe("Keep this  ");
    expect(mergeTranscript("/shrink-by", "30 percent")).toBe("/shrink-by 30 percent");
  });

  it("picks the first recordable container and accepts the usual audio types", () => {
    expect(pickRecordingMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickRecordingMimeType(() => false)).toBeNull();
    expect(TRANSCRIBE_ACCEPTED.test("audio/webm;codecs=opus")).toBe(true);
    expect(TRANSCRIBE_ACCEPTED.test("audio/mp4")).toBe(true);
    expect(TRANSCRIBE_ACCEPTED.test("video/webm")).toBe(false);
    expect(TRANSCRIBE_ACCEPTED.test("application/octet-stream")).toBe(false);
    expect(DICTATION_LIMITS.maxBytes).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("detects the browser's capabilities from injected globals", () => {
    class Fake {}
    expect(getSpeechRecognitionCtor({ SpeechRecognition: Fake })).toBe(Fake);
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
    expect(getSpeechRecognitionCtor({})).toBeNull();
    expect(getSpeechRecognitionCtor(undefined)).toBeNull();
    expect(canRecordAudio({ MediaRecorder: Fake, navigator: { mediaDevices: { getUserMedia: () => undefined } } })).toBe(true);
    expect(canRecordAudio({ MediaRecorder: Fake, navigator: {} })).toBe(false);
    expect(canRecordAudio(null)).toBe(false);
    expect(describeSpeechError("not-allowed")).toMatch(/Microphone access was denied/);
    expect(describeSpeechError("no-speech")).toBeNull();
    expect(describeSpeechError("odd")).toBe("Dictation stopped (odd).");
  });

  it("reads the transcription provider from the environment", () => {
    expect(parseTranscriptionEnv({})).toBeNull();
    expect(parseTranscriptionEnv({ TRANSCRIPTION_API_URL: "https://api.groq.com/openai/v1" })).toBeNull();
    expect(parseTranscriptionEnv({ OPENAI_API_KEY: "sk-test" })).toEqual({
      url: OPENAI_API_BASE,
      key: "sk-test",
      model: "whisper-1",
      provider: "api.openai.com",
    });
    expect(
      parseTranscriptionEnv({
        TRANSCRIPTION_API_URL: "https://api.groq.com/openai/v1/audio/transcriptions/",
        TRANSCRIPTION_API_KEY: "gsk-test",
        TRANSCRIPTION_MODEL: "whisper-large-v3",
        OPENAI_API_KEY: "sk-other",
      }),
    ).toEqual({ url: "https://api.groq.com/openai/v1", key: "gsk-test", model: "whisper-large-v3", provider: "api.groq.com" });
    // A non-OpenAI URL never borrows the OpenAI key; a plain-http URL is refused.
    expect(parseTranscriptionEnv({ TRANSCRIPTION_API_URL: "https://whisper.internal/v1", OPENAI_API_KEY: "sk-test" })).toBeNull();
    expect(parseTranscriptionEnv({ TRANSCRIPTION_API_URL: "http://whisper.internal/v1", TRANSCRIPTION_API_KEY: "k" })).toBeNull();
  });
});
