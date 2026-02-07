import { useState, useRef, useCallback, useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import { api } from "../lib/api.js";
import { setDictationGhostEffect } from "../components/Editor.js";

export type FormatMode = "off" | "format" | "clean" | "editorial";

interface DictationState {
  isRecording: boolean;
  elapsed: number;
  error: string | null;
  formatMode: FormatMode;
  setFormatMode: (v: FormatMode) => void;
  /** Ref that updates at ~60fps with current RMS audio level 0–1 */
  audioLevelRef: React.RefObject<number>;
  startDictation: (view: EditorView) => void;
  stopDictation: () => void;
}

export function useDictation(): DictationState {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [formatMode, setFormatMode] = useState<FormatMode>("format");

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const needsSpaceRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const formatModeRef = useRef(formatMode);
  formatModeRef.current = formatMode;
  const formatQueueRef = useRef<Promise<void>>(Promise.resolve());
  const audioLevelRef = useRef(0);

  useEffect(() => {
    return () => { cleanup(); };
  }, []);

  function clearGhost() {
    const view = viewRef.current;
    if (view) {
      view.dispatch({ effects: setDictationGhostEffect.of(null) });
    }
  }

  function showGhost(text: string) {
    const view = viewRef.current;
    if (!view || !text) return;
    const cursor = view.state.selection.main.head;
    view.dispatch({ effects: setDictationGhostEffect.of({ pos: cursor, text }) });
  }

  function startTimer() {
    startTimeRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsed(0);
  }

  function cleanup() {
    clearGhost();
    stopTimer();
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch {}
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    viewRef.current = null;
    needsSpaceRef.current = false;
    formatQueueRef.current = Promise.resolve();
    audioLevelRef.current = 0;
  }

  const stopDictation = useCallback(() => {
    cleanup();
    setIsRecording(false);
  }, []);

  const startDictation = useCallback((view: EditorView) => {
    if (isRecording) {
      stopDictation();
      return;
    }

    setError(null);
    viewRef.current = view;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;

        const { token } = await api.post<{ token: string }>("/api/tts/scribe-token");

        const params = new URLSearchParams({
          token,
          audio_format: "pcm_16000",
          commit_strategy: "vad",
          vad_silence_threshold_secs: "0.6",
          min_silence_duration_ms: "80",
        });
        const ws = new WebSocket(
          `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`
        );
        wsRef.current = ws;

        ws.onopen = () => {
          setIsRecording(true);
          startTimer();
          startAudioCapture(stream, ws);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.message_type === "partial_transcript" && msg.text) {
              showGhost(msg.text);
            } else if (msg.message_type === "committed_transcript" && msg.text?.trim()) {
              formatQueueRef.current = formatQueueRef.current.then(() =>
                formatAndInsert(msg.text.trim())
              );
            }
          } catch {}
        };

        ws.onerror = () => {
          setError("Dictation connection failed");
          cleanup();
          setIsRecording(false);
        };

        ws.onclose = () => {
          clearGhost();
          stopTimer();
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          if (ctxRef.current) {
            try { ctxRef.current.close(); } catch {}
            ctxRef.current = null;
          }
          wsRef.current = null;
          setIsRecording(false);
        };
      } catch (err: any) {
        const msg = err?.message || "Failed to start dictation";
        if (msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
          setError("Microphone access denied");
        } else {
          setError(msg);
        }
        cleanup();
        setIsRecording(false);
      }
    })();
  }, [isRecording, stopDictation]);

  function startAudioCapture(stream: MediaStream, ws: WebSocket) {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // Compute RMS for waveform visualization
      let sum = 0;
      for (let i = 0; i < float32.length; i++) {
        sum += float32[i] * float32[i];
      }
      audioLevelRef.current = Math.sqrt(sum / float32.length);

      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const bytes = new Uint8Array(pcm16.buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      ws.send(JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: btoa(binary),
      }));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
  }

  async function formatAndInsert(rawText: string) {
    const view = viewRef.current;
    if (!view) return;

    let textToInsert = rawText;
    const mode = formatModeRef.current;

    if (mode !== "off") {
      // More context for clean/editorial since they need to understand tone
      const contextLen = mode === "editorial" ? 1000 : mode === "clean" ? 750 : 500;
      const cursor = view.state.selection.main.head;
      const contextStart = Math.max(0, cursor - contextLen);
      const context = cursor > 0 ? view.state.doc.sliceString(contextStart, cursor) : undefined;

      try {
        const res = await api.post<{ formatted: string }>("/api/tts/format-dictation", {
          text: rawText,
          context,
          mode,
        });
        if (res.formatted) textToInsert = res.formatted;
      } catch {
        // LLM failed — fall back to raw text
      }
    }

    clearGhost();
    insertText(textToInsert);
  }

  function insertText(text: string) {
    const view = viewRef.current;
    if (!view) return;

    const cursor = view.state.selection.main.head;
    const charBefore = cursor > 0 ? view.state.doc.sliceString(cursor - 1, cursor) : "";

    // If text starts with a newline, don't add a space prefix
    const startsWithNewline = text.startsWith("\n");
    const prefix = !startsWithNewline && needsSpaceRef.current && charBefore && charBefore !== " " && charBefore !== "\n"
      ? " "
      : "";

    const insertStr = prefix + text;
    view.dispatch({
      changes: { from: cursor, insert: insertStr },
      selection: { anchor: cursor + insertStr.length },
    });

    needsSpaceRef.current = true;
  }

  return { isRecording, elapsed, error, formatMode, setFormatMode, audioLevelRef, startDictation, stopDictation };
}
