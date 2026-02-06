import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useOpenFile,
  useProjectId,
  useProjectSettings,
  useStoreDispatch,
  useTtsFromLine,
} from "../store/StoreContext.js";
import { useAuth } from "../context/AuthContext.js";
import { supabase } from "../lib/supabase.js";

// Pastel palette for generative art
const PASTELS = [
  ["#f5e6d3", "#e8d5c4", "#dbc4b0", "#c4956a"],
  ["#e5eed8", "#d4e0c8", "#c3d2b8", "#93b573"],
  ["#e0daf5", "#d0c8eb", "#c0b6e0", "#9a85c9"],
  ["#f5d6d6", "#ebc4c4", "#e0b0b0", "#c97a7a"],
  ["#d6eef5", "#c4e0eb", "#b0d0e0", "#7ab0c9"],
  ["#f5ecd6", "#ebdec4", "#e0d0b0", "#c9b07a"],
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function drawAlbumArt(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const h = hashStr(text);
  const palette = PASTELS[h % PASTELS.length];

  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);

  let seed = h;
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const blobCount = 4 + (h % 4);
  for (let i = 0; i < blobCount; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * 0.15 + rand() * size * 0.25;
    const color = palette[1 + (i % (palette.length - 1))];
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color + "aa");
    gradient.addColorStop(1, color + "00");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette[3] + "44";
  for (let l = 0; l < 3; l++) {
    ctx.beginPath();
    let lx = rand() * size;
    let ly = rand() * size;
    ctx.moveTo(lx, ly);
    for (let s = 0; s < 6; s++) {
      const cx1 = lx + (rand() - 0.5) * size * 0.5;
      const cy1 = ly + (rand() - 0.5) * size * 0.3;
      lx = rand() * size;
      ly = rand() * size;
      ctx.quadraticCurveTo(cx1, cy1, lx, ly);
    }
    ctx.stroke();
  }

  for (let d = 0; d < 12; d++) {
    const dx = rand() * size;
    const dy = rand() * size;
    const dr = 1 + rand() * 2;
    ctx.fillStyle = palette[3] + "55";
    ctx.beginPath();
    ctx.arc(dx, dy, dr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function AlbumArt({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = useMemo(() => hashStr(text || ""), [text]);

  useEffect(() => {
    if (canvasRef.current) drawAlbumArt(canvasRef.current, text || "");
  }, [key, text]);

  return (
    <canvas
      ref={canvasRef}
      width={80}
      height={80}
      className="w-10 h-10 rounded-md shrink-0"
    />
  );
}

// --- Voice data (mirrored from server) ---
const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Warm, calm narrator" },
  { id: "29vD33N1CtxCmqQRPOHJ", name: "Drew", desc: "Well-rounded, confident" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Soft, young narrator" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "Well-rounded, calm" },
  { id: "GBv7mTt0atIp3Br8iCZE", name: "Thomas", desc: "Calm, collected" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "Warm British narrator" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", desc: "Articulate, authoritative" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "Warm, friendly" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "Deep, authoritative British" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "Warm, British narrator" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", desc: "Trustworthy American" },
  { id: "t0jbNlBVZ17f02VDIeMI", name: "Austin", desc: "Warm, grounded narrator" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", desc: "Deep, authoritative" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", desc: "Confident British" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "Seductive, calm" },
];

type PlayState = "idle" | "loading" | "playing" | "paused";
type TtsModel = "v3" | "v2";

interface LineTimestamp {
  start: number;
  end: number;
  line: number;
  fromChar: number;
  toChar: number;
}

interface V2Settings {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

const V2_SPEED_MIN = 0.7;
const V2_SPEED_MAX = 1.2;

const DEFAULT_V2: V2Settings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1.0,
};

function clampV2Settings(input: V2Settings): V2Settings {
  return {
    ...input,
    speed: Math.max(V2_SPEED_MIN, Math.min(V2_SPEED_MAX, input.speed)),
  };
}

function isValidTimestamp(x: any): x is LineTimestamp {
  return (
    x &&
    Number.isFinite(x.start) &&
    Number.isFinite(x.end) &&
    Number.isFinite(x.line) &&
    Number.isFinite(x.fromChar) &&
    Number.isFinite(x.toChar) &&
    x.end > x.start &&
    x.toChar > x.fromChar
  );
}

function getTimestampDuration(timestamps: LineTimestamp[]): number {
  let maxEnd = 0;
  for (const ts of timestamps) {
    if (Number.isFinite(ts.end) && ts.end > maxEnd) {
      maxEnd = ts.end;
    }
  }
  return maxEnd;
}

/** Find 1-indexed line numbers where new chunks (paragraphs / headings) start */
function getChunkStartLines(content: string): number[] {
  const lines = content.split("\n");
  const starts: number[] = [1];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    if ((prev.trim() === "" && cur.trim() !== "") || /^#{1,6}\s/.test(cur)) {
      const lineNum = i + 1; // 1-indexed
      if (starts[starts.length - 1] !== lineNum) starts.push(lineNum);
    }
  }
  return starts;
}

export function AudioBar() {
  const { path: openFilePath, content } = useOpenFile();
  const projectId = useProjectId();
  const dispatch = useStoreDispatch();
  const ttsFromLine = useTtsFromLine();
  const projectSettings = useProjectSettings();
  const { preferences: userPrefs } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeStreamId = useRef<string | null>(null);
  const [state, setState] = useState<PlayState>("idle");
  const [progress, setProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [timingDuration, setTimingDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [model, setModel] = useState<TtsModel>("v2");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [simpleMode, setSimpleMode] = useState(false);
  const [v2Settings, setV2Settings] = useState<V2Settings>(DEFAULT_V2);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const timestampsRef = useRef<LineTimestamp[]>([]);
  const missingTimingLoggedRef = useRef(false);
  const settingsInitialized = useRef(false);
  const lastHighlightLine = useRef<number | null>(null);
  const charOffsetRef = useRef(0);
  const forceRegenRef = useRef(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize from project settings, falling back to user preferences
  useEffect(() => {
    if (settingsInitialized.current) return;
    const tts = projectSettings.tts || userPrefs.tts;
    if (!tts) return;
    settingsInitialized.current = true;
    if (tts.voiceId) setVoiceId(tts.voiceId);
    if (tts.model) setModel(tts.model);
    if (typeof tts.simpleMode === "boolean") setSimpleMode(tts.simpleMode);
    if (tts.v2) setV2Settings(clampV2Settings(tts.v2));
  }, [projectSettings, userPrefs]);

  // Close settings on outside click
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings]);

  // Stop preview when settings panel closes
  useEffect(() => {
    if (!showSettings && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    }
  }, [showSettings]);

  const previewVoice = useCallback(
    async (vid: string, e: React.MouseEvent) => {
      e.stopPropagation();

      // Toggle off if same voice
      if (previewingVoice === vid && previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
        setPreviewingVoice(null);
        return;
      }

      // Stop any existing preview
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }

      setPreviewingVoice(vid);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const audio = new Audio();
        audio.src = `/api/tts/preview/${vid}?token=${encodeURIComponent(token)}`;
        audio.volume = volume;
        audio.addEventListener("ended", () => {
          setPreviewingVoice(null);
          previewAudioRef.current = null;
        });
        previewAudioRef.current = audio;
        await audio.play();
      } catch {
        setPreviewingVoice(null);
        previewAudioRef.current = null;
      }
    },
    [previewingVoice, volume]
  );

  // Auto-save TTS settings to project when changed
  useEffect(() => {
    if (!settingsInitialized.current) return;
    const settings = {
      ...projectSettings,
      tts: {
        voiceId,
        model,
        simpleMode,
        v2: v2Settings,
      },
    };
    dispatch({ type: "settings:save", settings });
  }, [voiceId, model, simpleMode, v2Settings]); // intentionally omit dispatch/projectSettings to avoid loops

  const cleanup = useCallback(() => {
    activeStreamId.current = null;
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;
    timestampsRef.current = [];
    missingTimingLoggedRef.current = false;
    cleanup();
    setState("idle");
    setProgress(0);
    setMediaDuration(0);
    setTimingDuration(0);
    setCurrentTime(0);
    setActivity(null);
    dispatch({ type: "tts:clear" });
  }, [dispatch, cleanup]);

  // Stop playback when file changes
  useEffect(() => {
    stop();
  }, [openFilePath, stop]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Poll for real Whisper timestamps (required for cursor animation).
  const pollTimestamps = useCallback(
    async (streamId: string, token: string) => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (activeStreamId.current !== streamId) return;
        if (i === 2) setActivity("Refining timestamps...");
        try {
          const res = await fetch(
            `/api/tts/${projectId}/timestamps/${streamId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) {
            console.warn("[AudioBar] Timestamp poll failed", {
              streamId,
              attempt: i + 1,
              status: res.status,
            });
            continue;
          }
          const data = await res.json();
          if (data.ready) {
            const tsRaw = Array.isArray(data.timestamps) ? data.timestamps : [];
            const ts = tsRaw.filter(isValidTimestamp) as LineTimestamp[];
            if (ts.length > 0) {
              timestampsRef.current = ts;
              setTimingDuration(getTimestampDuration(ts));
              missingTimingLoggedRef.current = false;
            } else {
              timestampsRef.current = [];
              setTimingDuration(0);
              console.error(
                "[AudioBar] Timestamp refinement returned no valid segments; cursor animation disabled",
                { streamId, count: tsRaw.length }
              );
            }
            setActivity(null);
            return;
          }
        } catch (err) {
          console.error("[AudioBar] Timestamp poll error", {
            streamId,
            attempt: i + 1,
            error: err,
          });
        }
      }
      // Poll timed out — keep playback, but disable cursor animation.
      if (activeStreamId.current === streamId) {
        console.error(
          "[AudioBar] Timestamp refinement timed out; cursor animation disabled",
          { streamId }
        );
        timestampsRef.current = [];
        setTimingDuration(0);
        setActivity(null);
      }
    },
    [projectId]
  );

  const dispatchPlaybackFromCurrentTime = useCallback(
    (audio: HTMLAudioElement) => {
      const ts = timestampsRef.current;
      if (ts.length === 0) {
        if (!missingTimingLoggedRef.current) {
          console.error(
            "[AudioBar] Missing timing information; cursor animation disabled until real timestamps are available"
          );
          missingTimingLoggedRef.current = true;
          dispatch({ type: "tts:highlight-clear" });
          dispatch({ type: "tts:playback-stop" });
        }
        return;
      }

      missingTimingLoggedRef.current = false;

      const t = audio.currentTime;
      let best: LineTimestamp | null = null;
      for (const s of ts) {
        if (t >= s.start) best = s;
        else break;
      }
      if (!best) {
        dispatch({ type: "tts:playback-stop" });
        return;
      }

      const segmentDuration = Math.max(0.001, best.end - best.start);
      const segmentElapsed = Math.max(
        0,
        Math.min(segmentDuration, t - best.start)
      );
      const charOffset = charOffsetRef.current;
      const fromChar = charOffset + best.fromChar;
      const toChar = charOffset + best.toChar;
      lastHighlightLine.current = best.line;

      dispatch({
        type: "tts:highlight",
        line: best.line,
        fromChar,
        toChar,
      });
      if (simpleMode) {
        return;
      }
      dispatch({
        type: "tts:playback",
        playback: {
          fromChar,
          toChar,
          duration: segmentDuration,
          elapsed: segmentElapsed,
          dispatchedAt: Date.now(),
          playing: !audio.paused,
        },
      });
    },
    [dispatch, simpleMode]
  );

  // Simple mode disables cursor animation state entirely.
  useEffect(() => {
    if (simpleMode) {
      dispatch({ type: "tts:playback-stop" });
    }
  }, [dispatch, simpleMode]);

  const playFrom = useCallback(
    async (fromLine?: number) => {
      if (!content?.trim()) return;

      setState("loading");
      setError(null);
      setActivity(model === "v3" ? "Enhancing text with AI..." : "Preparing audio...");
      dispatch({ type: "tts:clear" });
      setProgress(0);
      setCurrentTime(0);
      setMediaDuration(0);
      setTimingDuration(0);

      // Stop existing playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      cleanup();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";

        // Slice text from target line — don't send/process earlier content
        let textToSend = content;
        const lineOffset = fromLine && fromLine > 1 ? fromLine : 1;
        let charOff = 0;
        if (lineOffset > 1) {
          const lines = content.split("\n");
          for (let i = 0; i < lineOffset - 1 && i < lines.length; i++) {
            charOff += lines[i].length + 1;
          }
          textToSend = lines.slice(lineOffset - 1).join("\n");
        }
        charOffsetRef.current = charOff;
        timestampsRef.current = [];
        missingTimingLoggedRef.current = false;

        const body: Record<string, any> = {
          text: textToSend,
          model,
          voiceId,
          lineOffset, // tells server which absolute line this text starts at
          force: forceRegenRef.current,
        };
        forceRegenRef.current = false;
        if (model === "v2") {
          const safeV2 = clampV2Settings(v2Settings);
          body.stability = v2Settings.stability;
          body.similarityBoost = v2Settings.similarityBoost;
          body.style = v2Settings.style;
          body.speed = safeV2.speed;
        }

        // Step 1: POST to prepare (cache check + Claude enhancement)
        const res = await fetch(`/api/tts/${projectId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "TTS failed" }));
          throw new Error(err.error || "TTS failed");
        }

        const data = await res.json();
        let audioUrl: string;

        if (data.cached) {
          // Cache hit: audio + timestamps available immediately
          audioUrl = data.audioUrl;
          const tsRaw = Array.isArray(data.timestamps) ? data.timestamps : [];
          const ts = tsRaw.filter(isValidTimestamp) as LineTimestamp[];
          timestampsRef.current = ts;
          setTimingDuration(getTimestampDuration(ts));
          if (ts.length === 0) {
            console.error(
              "[AudioBar] Cached audio has no valid timestamps; cursor animation disabled",
              { count: tsRaw.length }
            );
          }
          setActivity(null);
        } else {
          // Streaming: point audio.src at the stream URL directly
          const streamId = data.streamId;
          activeStreamId.current = streamId;
          audioUrl = `/api/tts/${projectId}/stream/${streamId}?token=${encodeURIComponent(token)}`;
          setActivity("Generating audio...");

          // Poll for real Whisper timestamps in background
          pollTimestamps(streamId, token);
        }

        // Step 2: Play the audio
        const audio = new Audio();
        audio.preload = "auto";
        audio.volume = volume;
        audioRef.current = audio;

        const updateMediaDuration = () => {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setMediaDuration(audio.duration);
          }
        };

        const updateProgress = () => {
          const total =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : getTimestampDuration(timestampsRef.current);
          if (total > 0) {
            setProgress(Math.max(0, Math.min(1, audio.currentTime / total)));
          } else {
            setProgress(0);
          }
        };

        audio.addEventListener("loadedmetadata", updateMediaDuration);
        // Duration may update as more data streams in
        audio.addEventListener("durationchange", () => {
          updateMediaDuration();
          updateProgress();
          dispatchPlaybackFromCurrentTime(audio);
        });
        audio.addEventListener("timeupdate", () => {
          setCurrentTime(audio.currentTime);
          updateProgress();
          dispatchPlaybackFromCurrentTime(audio);
        });
        audio.addEventListener("ended", () => {
          setState("idle");
          setProgress(0);
          setMediaDuration(0);
          setTimingDuration(0);
          setCurrentTime(0);
          setActivity(null);
          cleanup();
          timestampsRef.current = [];
          lastHighlightLine.current = null;
          dispatch({ type: "tts:highlight-clear" });
          dispatch({ type: "tts:playback-stop" });
        });

        // Set src after listeners are attached, then play
        audio.src = audioUrl;
        await audio.play();
        setState("playing");
        dispatchPlaybackFromCurrentTime(audio);
      } catch (err: any) {
        console.error("[AudioBar]", err);
        setError(err.message || "Playback failed");
        setState("idle");
        setActivity(null);
      }
    },
    [content, projectId, model, voiceId, v2Settings, volume, dispatch, cleanup, pollTimestamps, dispatchPlaybackFromCurrentTime]
  );

  // Handle "read from here" triggered from editor
  useEffect(() => {
    if (ttsFromLine !== null) {
      playFrom(ttsFromLine);
    }
  }, [ttsFromLine]); // intentionally omit playFrom to avoid loops

  const play = useCallback(() => {
    if (state === "paused" && audioRef.current) {
      audioRef.current.play();
      setState("playing");
      dispatchPlaybackFromCurrentTime(audioRef.current);
      return;
    }
    playFrom();
  }, [state, playFrom, dispatchPlaybackFromCurrentTime]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) dispatchPlaybackFromCurrentTime(audio);
    setState("paused");
  }, [dispatchPlaybackFromCurrentTime]);

  const effectiveDuration = mediaDuration > 0 ? mediaDuration : timingDuration;

  const skipBack15 = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, audio.currentTime - 15);
    dispatchPlaybackFromCurrentTime(audio);
  }, [dispatchPlaybackFromCurrentTime]);

  const skipNextChunk = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const ts = timestampsRef.current;
    if (ts.length === 0) return;

    const currentLine = lastHighlightLine.current ?? 1;
    const chunks = getChunkStartLines(content || "");
    const nextChunkLine = chunks.find((l) => l > currentLine);
    if (!nextChunkLine) return;

    const entry = ts.find((t) => t.line >= nextChunkLine);
    if (entry) {
      audio.currentTime = entry.start;
      dispatchPlaybackFromCurrentTime(audio);
    }
  }, [content, dispatchPlaybackFromCurrentTime]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(effectiveDuration) || !effectiveDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      audio.currentTime = ratio * effectiveDuration;
      dispatchPlaybackFromCurrentTime(audio);
    },
    [effectiveDuration, dispatchPlaybackFromCurrentTime]
  );

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const downloadAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    try {
      const res = await fetch(audio.src);
      const blob = await res.blob();
      const voiceName = VOICES.find((v) => v.id === voiceId)?.name ?? "voice";
      const baseName = (openFilePath?.split("/").pop() ?? "audio").replace(/\.[^.]+$/, "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}-${voiceName}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed");
    }
  }, [voiceId, openFilePath]);

  const regenerate = useCallback(() => {
    forceRegenRef.current = true;
    stop();
    playFrom();
  }, [stop, playFrom]);

  const hasContent = !!content?.trim();
  const isActive = state !== "idle";
  const hasDuration = Number.isFinite(effectiveDuration) && effectiveDuration > 0;
  const hasAudio = !!audioRef.current?.src;
  const fileName = openFilePath?.split("/").pop() ?? "No file";
  const currentVoice = VOICES.find((v) => v.id === voiceId);

  return (
    <div className="h-16 bg-surface border-t border-border shrink-0 flex items-center px-4 gap-4">
      {/* Left: file info */}
      <div className="flex items-center gap-3 w-56 min-w-0">
        <div className="relative">
          <AlbumArt text={content || ""} />
          {activity && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent activity-pulse" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-text font-medium truncate">
            {fileName}
          </div>
          <div className="text-xs truncate">
            {error ? (
              <button
                onClick={() => setError(null)}
                className="text-danger hover:underline"
              >
                Error &middot; Click to dismiss
              </button>
            ) : activity ? (
              <span className="text-accent">{activity}</span>
            ) : (
              <span className="text-text-muted">
                {currentVoice?.name ?? "Rachel"} &middot;{" "}
                {model === "v3" ? "v3" : "v2"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Center: transport + progress */}
      <div className="flex-1 flex flex-col items-center gap-0.5 max-w-lg mx-auto">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={skipBack15}
            disabled={!isActive}
            className="text-text-muted hover:text-text transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Back 15 seconds"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 105.64-11.36L1 10" />
              <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="bold">15</text>
            </svg>
          </button>

          <button
            onClick={stop}
            disabled={!isActive}
            className="text-text-muted hover:text-text transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Stop"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5" />
            </svg>
          </button>

          {state === "playing" ? (
            <button
              onClick={pause}
              className="w-8 h-8 rounded-full bg-text text-surface flex items-center justify-center hover:scale-105 transition-transform"
              title="Pause"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="3.5" height="12" rx="1" />
                <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={play}
              disabled={!hasContent || state === "loading"}
              className="w-8 h-8 rounded-full bg-text text-surface flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              title="Read aloud"
            >
              {state === "loading" ? (
                <svg width="14" height="14" viewBox="0 0 16 16" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="5" strokeDasharray="20" strokeDashoffset="5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.5 2v12l9-6z" />
                </svg>
              )}
            </button>
          )}

          <button
            onClick={skipNextChunk}
            disabled={!isActive}
            className="text-text-muted hover:text-text transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Skip to next paragraph"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2v12l7-6z" />
              <rect x="11" y="2" width="3" height="12" rx="0.5" />
            </svg>
          </button>
        </div>

        {/* Progress bar row: time — bar — time */}
        <div className="flex items-center gap-2 w-full">
          <span className="text-[10px] text-text-muted tabular-nums w-8 text-right shrink-0">
            {isActive ? fmt(currentTime) : "0:00"}
          </span>
          <div
            className="flex-1 h-1 bg-border/50 rounded-full cursor-pointer group relative"
            onClick={seek}
          >
            {state === "loading" ? (
              <div className="h-full w-full overflow-hidden rounded-full">
                <div
                  className="h-full w-1/3 bg-accent rounded-full"
                  style={{
                    animation: "indeterminate-slide 1.5s ease-in-out infinite",
                  }}
                />
              </div>
            ) : (
              <>
                <div
                  className="h-full bg-accent rounded-full transition-[width] duration-100"
                  style={{ width: `${progress * 100}%` }}
                />
                {isActive && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow"
                    style={{ left: `${progress * 100}%`, marginLeft: "-5px" }}
                  />
                )}
              </>
            )}
          </div>
          <span className="text-[10px] text-text-muted tabular-nums w-8 shrink-0">
            {hasDuration ? fmt(effectiveDuration) : "0:00"}
          </span>
        </div>
      </div>

      {/* Right: download + volume + settings */}
      <div className="flex items-center gap-3 w-56 justify-end">
        <button
          onClick={downloadAudio}
          disabled={!hasAudio}
          className="text-text-muted hover:text-text transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          title="Download audio"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            className="text-text-muted hover:text-text transition-colors"
            title={volume > 0 ? "Mute" : "Unmute"}
          >
            {volume === 0 ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : volume < 0.5 ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 010 7.07" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20 h-1 bg-border rounded-full appearance-none cursor-pointer accent-accent"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`text-text-muted hover:text-text transition-colors ${showSettings ? "text-accent" : ""}`}
            title="Voice settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>

          {/* Error popup */}
          {error && (
            <div className="absolute right-0 bottom-full mb-2 w-72 bg-surface border border-danger/30 rounded-lg shadow-lg p-4 z-50">
              <div className="flex items-start gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-danger shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text mb-1">Playback Error</div>
                  <div className="text-xs text-text-muted break-words">{error}</div>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-text-muted hover:text-text transition-colors shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {showSettings && (
            <div
              ref={settingsRef}
              className="absolute right-0 bottom-full mb-2 w-64 bg-surface border border-border rounded-lg shadow-lg p-3 z-50 max-h-80 overflow-y-auto"
            >
              {/* Voice selector */}
              <div className="text-xs font-medium text-text mb-1.5">Voice</div>
              <div className="grid grid-cols-2 gap-1 mb-3 max-h-36 overflow-y-auto">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center justify-between gap-1 ${
                      voiceId === v.id
                        ? "bg-accent text-white"
                        : "bg-surface-alt text-text-muted hover:text-text"
                    }`}
                    title={v.desc}
                  >
                    <span className="truncate">{v.name}</span>
                    <span
                      onClick={(e) => previewVoice(v.id, e)}
                      className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-full transition-colors ${
                        voiceId === v.id
                          ? "hover:bg-white/20"
                          : "hover:bg-border"
                      }`}
                      title={previewingVoice === v.id ? "Stop preview" : `Preview ${v.name}`}
                    >
                      {previewingVoice === v.id ? (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                          <rect x="1" y="1" width="6" height="6" rx="1" />
                        </svg>
                      ) : (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M2 1v6l5-3z" />
                        </svg>
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {/* Model selector */}
              <div className="text-xs font-medium text-text mb-1.5">Model</div>
              <div className="flex gap-1 mb-3">
                <button
                  onClick={() => setModel("v3")}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    model === "v3"
                      ? "bg-accent text-white"
                      : "bg-surface-alt text-text-muted hover:text-text"
                  }`}
                >
                  v3 + AI Tags
                </button>
                <button
                  onClick={() => setModel("v2")}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    model === "v2"
                      ? "bg-accent text-white"
                      : "bg-surface-alt text-text-muted hover:text-text"
                  }`}
                >
                  v2 Classic
                </button>
              </div>

              {/* Reading mode */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-text">Simple mode</div>
                  <div className="text-[10px] text-text-muted">
                    Highlight only the current sentence
                  </div>
                </div>
                <button
                  onClick={() => setSimpleMode((s) => !s)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    simpleMode
                      ? "bg-accent text-white"
                      : "bg-surface-alt text-text-muted hover:text-text"
                  }`}
                >
                  {simpleMode ? "On" : "Off"}
                </button>
              </div>

              {/* Regenerate */}
              <button
                onClick={() => {
                  setShowSettings(false);
                  regenerate();
                }}
                disabled={!hasContent}
                className="w-full text-xs py-1.5 px-2 rounded-md bg-surface-alt text-text-muted hover:text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-3 flex items-center justify-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4v6h6" />
                  <path d="M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
                </svg>
                Regenerate audio
              </button>

              {model === "v3" && (
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Uses Claude to add expressive audio tags before synthesis.
                </p>
              )}

              {model === "v2" && (
                <div className="space-y-2.5">
                  <SliderSetting
                    label="Stability"
                    value={v2Settings.stability}
                    onChange={(v) =>
                      setV2Settings((s) => ({ ...s, stability: v }))
                    }
                  />
                  <SliderSetting
                    label="Similarity"
                    value={v2Settings.similarityBoost}
                    onChange={(v) =>
                      setV2Settings((s) => ({ ...s, similarityBoost: v }))
                    }
                  />
                  <SliderSetting
                    label="Style"
                    value={v2Settings.style}
                    onChange={(v) => setV2Settings((s) => ({ ...s, style: v }))}
                  />
                  <SliderSetting
                    label="Speed"
                    value={v2Settings.speed}
                    min={V2_SPEED_MIN}
                    max={V2_SPEED_MAX}
                    step={0.1}
                    onChange={(v) =>
                      setV2Settings((s) =>
                        clampV2Settings({ ...s, speed: v })
                      )
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SliderSetting({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-border rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
}
