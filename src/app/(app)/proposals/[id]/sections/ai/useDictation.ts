"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DICTATION_LIMITS,
  canRecordAudio,
  describeSpeechError,
  getSpeechRecognitionCtor,
  pickRecordingMimeType,
  type SpeechRecognitionLike,
} from "@/lib/dictation";

/**
 * BL-FB-CHAT-VOICE — dictation for a text box.
 *
 * Mode "speech": the browser's own recogniser (Chrome, Edge, Safari);
 * interim words show as they are heard and finished phrases are handed
 * to `onText`. Mode "record": the microphone is recorded and the clip
 * sent to /api/ai/transcribe when the server reports a provider. Mode
 * "none": the control explains why it is unavailable.
 */
export type DictationMode = "speech" | "record" | "none";
export type DictationStatus = "idle" | "listening" | "recording" | "transcribing";

export function useDictation(onText: (text: string) => void) {
  const [mode, setMode] = useState<DictationMode | null>(null);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect once on mount; the record fallback needs the server's word.
  useEffect(() => {
    if (getSpeechRecognitionCtor(window)) {
      setMode("speech");
      return;
    }
    if (!canRecordAudio(window)) {
      setMode("none");
      return;
    }
    let cancelled = false;
    fetch("/api/ai/transcribe", { method: "GET" })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((j: { configured?: boolean }) => {
        if (!cancelled) setMode(j.configured ? "record" : "none");
      })
      .catch(() => {
        if (!cancelled) setMode("none");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      releaseStream();
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, [releaseStream]);

  const startSpeech = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor(window);
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let finals = "";
      let pending = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        if (r.isFinal) finals += `${r[0].transcript} `;
        else pending += r[0].transcript;
      }
      if (finals.trim()) onTextRef.current(finals);
      setInterim(pending.trim().slice(0, DICTATION_LIMITS.interimPreviewChars));
    };
    rec.onerror = (ev) => {
      const msg = describeSpeechError(ev.error);
      if (msg) setError(msg);
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setInterim("");
      setStatus("idle");
    };
    recognitionRef.current = rec;
    setError(null);
    setStatus("listening");
    rec.start();
  }, []);

  const transcribeClip = useCallback(async (blob: Blob, durationMs: number) => {
    if (blob.size === 0) {
      setStatus("idle");
      return;
    }
    if (blob.size > DICTATION_LIMITS.maxBytes) {
      setError("The clip is too large. Dictate in shorter pieces.");
      setStatus("idle");
      return;
    }
    setStatus("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, `clip.${blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"}`);
      form.append("durationMs", String(Math.round(durationMs)));
      form.append("language", navigator.language || "en-US");
      const res = await fetch("/api/ai/transcribe", { method: "POST", body: form });
      const j = (await res.json()) as { ok: boolean; text?: string; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `Transcription failed (${res.status}).`);
        return;
      }
      if (j.text) onTextRef.current(j.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setStatus("idle");
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || "audio/webm" });
        releaseStream();
        recorderRef.current = null;
        void transcribeClip(blob, durationMs);
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setError(null);
      setStatus("recording");
      recorder.start(1_000);
      stopTimerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      }, DICTATION_LIMITS.maxSeconds * 1000);
    } catch (err) {
      releaseStream();
      setError(
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")
          ? "Microphone access was denied. Allow it in the browser's site settings and try again."
          : "Could not start the microphone.",
      );
      setStatus("idle");
    }
  }, [releaseStream, transcribeClip]);

  const start = useCallback(() => {
    if (status !== "idle") return;
    if (mode === "speech") startSpeech();
    else if (mode === "record") void startRecording();
  }, [mode, status, startSpeech, startRecording]);

  const stop = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recognitionRef.current) recognitionRef.current.stop();
    else if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
  }, []);

  const toggle = useCallback(() => {
    if (status === "idle") start();
    else if (status !== "transcribing") stop();
  }, [status, start, stop]);

  return { mode, status, interim, error, start, stop, toggle, clearError: () => setError(null) };
}
