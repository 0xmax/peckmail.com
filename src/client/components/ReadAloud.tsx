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
import { pipeTtsErrorToServer } from "../lib/ttsClientLog.js";
import {
  TtsRenderCore,
  buildTtsChunks,
  clampV2Settings,
  getTimestampDuration,
  type LineTimestamp,
  type TtsChunk,
  type TtsPreparedChunk,
  type V2Settings,
} from "../lib/ttsCore.js";
import { Rewind, Stop, Pause, Play, SkipForward, DownloadSimple, SpeakerX, SpeakerLow, SpeakerHigh, GearSix, Warning, X, ArrowsClockwise, SpinnerGap, ListBullets } from "@phosphor-icons/react";

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

const V2_SPEED_MIN = 0.7;
const V2_SPEED_MAX = 1.2;
const DEFAULT_VOICE_ID = "pqHfZKP75CvOlQylNhV4";

const DEFAULT_V2: V2Settings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1.0,
};

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

function mergeTtsSettings(
  workspaceTts: {
    voiceId?: string;
    model?: TtsModel;
    simpleMode?: boolean;
    followAlong?: boolean;
    v2?: V2Settings;
  } | undefined,
  accountTts: {
    voiceId?: string;
    model?: TtsModel;
    simpleMode?: boolean;
    followAlong?: boolean;
    v2?: V2Settings;
  } | undefined
): { voiceId: string; model: TtsModel; simpleMode: boolean; followAlong: boolean; v2: V2Settings } {
  return {
    voiceId: workspaceTts?.voiceId ?? accountTts?.voiceId ?? DEFAULT_VOICE_ID,
    model: workspaceTts?.model ?? accountTts?.model ?? "v2",
    simpleMode: workspaceTts?.simpleMode ?? accountTts?.simpleMode ?? false,
    followAlong: workspaceTts?.followAlong ?? accountTts?.followAlong ?? true,
    v2: clampV2Settings({
      ...DEFAULT_V2,
      ...(accountTts?.v2 || {}),
      ...(workspaceTts?.v2 || {}),
    }),
  };
}

function estimateChunkDurationSeconds(chunk: TtsChunk): number {
  return Math.max(2.5, chunk.text.length / 16);
}

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

const PRECISE_SEEK_STT_WAIT_MS = 1400;
const FULL_PREP_CONCURRENCY = 6;
const PLAY_FROM_WORD_BACKOFF = 1;
const AVG_CHARS_PER_WORD = 6;

type ChunkAudioStatus =
  | "pending"
  | "preparing"
  | "ready-cached"
  | "ready-streaming"
  | "playing"
  | "error";

type ChunkTimingStatus = "pending" | "ready" | "missing";

interface ChunkRuntimeStatus {
  audio: ChunkAudioStatus;
  timing: ChunkTimingStatus;
  note?: string;
}

function audioStatusLabel(status: ChunkAudioStatus): string {
  switch (status) {
    case "pending":
      return "pending";
    case "preparing":
      return "preparing";
    case "ready-cached":
      return "cached";
    case "ready-streaming":
      return "stream";
    case "playing":
      return "playing";
    case "error":
      return "error";
  }
}

function audioStatusTone(status: ChunkAudioStatus): string {
  switch (status) {
    case "playing":
      return "text-primary";
    case "ready-cached":
      return "text-green-600 dark:text-green-400";
    case "ready-streaming":
      return "text-foreground";
    case "error":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function timingStatusTone(status: ChunkTimingStatus): string {
  switch (status) {
    case "ready":
      return "text-green-600 dark:text-green-400";
    case "missing":
      return "text-destructive";
    case "pending":
      return "text-muted-foreground";
  }
}

function getPreciseSeekStart(
  timestamps: LineTimestamp[],
  seekLine?: number,
  seekChunkChar?: number
): number | null {
  if (timestamps.length === 0) return null;

  if (typeof seekChunkChar === "number" && Number.isFinite(seekChunkChar)) {
    const backoffChars = PLAY_FROM_WORD_BACKOFF * AVG_CHARS_PER_WORD;
    const targetChar = Math.max(0, seekChunkChar - backoffChars);
    const containing = timestamps.find(
      (entry) => targetChar >= entry.fromChar && targetChar <= entry.toChar
    );
    if (containing) {
      const span = Math.max(1, containing.toChar - containing.fromChar);
      const ratio = Math.max(
        0,
        Math.min(1, (targetChar - containing.fromChar) / span)
      );
      return containing.start + ratio * (containing.end - containing.start);
    }

    const forward = timestamps.find((entry) => entry.fromChar >= targetChar);
    if (forward) return forward.start;

    let backward: LineTimestamp | null = null;
    for (const entry of timestamps) {
      if (entry.toChar <= targetChar) backward = entry;
    }
    if (backward) return backward.start;
  }

  if (seekLine && seekLine > 1) {
    const lineTarget = timestamps.find((entry) => entry.line >= seekLine);
    if (lineTarget) return lineTarget.start;
  }

  return timestamps[0]?.start ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function AudioBar({ onClose }: { onClose: () => void }) {
  const { path: openFilePath, content } = useOpenFile();
  const projectId = useProjectId();
  const dispatch = useStoreDispatch();
  const ttsFromLine = useTtsFromLine();
  const projectSettings = useProjectSettings();
  const { preferences: userPrefs } = useAuth();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const coreRef = useRef<TtsRenderCore | null>(null);
  const coreProjectIdRef = useRef<string | null>(null);
  const playbackSessionRef = useRef(0);
  const chunkPlanRef = useRef<TtsChunk[]>([]);
  const preparedChunksRef = useRef<Map<number, TtsPreparedChunk>>(new Map());
  const chunkAudioPrepRef = useRef<Map<number, Promise<TtsPreparedChunk>>>(new Map());
  const chunkDurationsRef = useRef<number[]>([]);
  const currentChunkRef = useRef<TtsChunk | null>(null);
  const currentChunkIndexRef = useRef(0);
  const forceRunRef = useRef(false);
  const fullPrepPromiseRef = useRef<Promise<void> | null>(null);
  const fullPrepKeyRef = useRef<string>("");
  const fullPrepRunIdRef = useRef(0);
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const stopPlaybackRef = useRef<() => void>(() => {});
  const playChunkRef = useRef<((chunkIndex: number, options: {
    sessionId: number;
    startAt?: number;
    force?: boolean;
    seekLine?: number;
    seekChar?: number;
    preferPreciseSeek?: boolean;
  }) => Promise<void>) | null>(null);

  const [state, setState] = useState<PlayState>("idle");
  const [progress, setProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [timingDuration, setTimingDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [model, setModel] = useState<TtsModel>("v2");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [simpleMode, setSimpleMode] = useState(false);
  const [followAlong, setFollowAlong] = useState(true);
  const [v2Settings, setV2Settings] = useState<V2Settings>(DEFAULT_V2);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [, setDetailsVersion] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const timestampsRef = useRef<LineTimestamp[]>([]);
  const applyChunkTimestampsRef = useRef<(chunkIndex: number, ts: LineTimestamp[]) => void>(
    () => {}
  );
  const missingTimingLoggedRef = useRef(false);
  const settingsHydratedRef = useRef(false);
  const skipNextSettingsSaveRef = useRef(false);
  const projectSettingsRef = useRef(projectSettings);
  const chunkStatusRef = useRef<Map<number, ChunkRuntimeStatus>>(new Map());
  const lastHighlightLine = useRef<number | null>(null);
  const forceRegenRef = useRef(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const bumpDetails = useCallback(() => {
    setDetailsVersion((v) => (v + 1) % 1000000);
  }, []);

  const setChunkStatus = useCallback(
    (chunkIndex: number, patch: Partial<ChunkRuntimeStatus>) => {
      const current = chunkStatusRef.current.get(chunkIndex) || {
        audio: "pending",
        timing: "pending",
      };
      chunkStatusRef.current.set(chunkIndex, { ...current, ...patch });
      bumpDetails();
    },
    [bumpDetails]
  );

  const mergedTts = useMemo(
    () => mergeTtsSettings(projectSettings.tts, userPrefs.tts),
    [projectSettings.tts, userPrefs.tts]
  );

  useEffect(() => {
    projectSettingsRef.current = projectSettings;
  }, [projectSettings]);

  // Workspace-level settings override account defaults per-field.
  useEffect(() => {
    setVoiceId(mergedTts.voiceId);
    setModel(mergedTts.model);
    setSimpleMode(mergedTts.simpleMode);
    setFollowAlong(mergedTts.followAlong);
    setV2Settings(clampV2Settings(mergedTts.v2));
    settingsHydratedRef.current = true;
    skipNextSettingsSaveRef.current = true;
  }, [
    mergedTts.voiceId,
    mergedTts.model,
    mergedTts.simpleMode,
    mergedTts.followAlong,
    mergedTts.v2.stability,
    mergedTts.v2.similarityBoost,
    mergedTts.v2.style,
    mergedTts.v2.speed,
  ]);

  // Close settings on outside click
  useEffect(() => {
    if (!showSettings && !showDetails) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inSettings = settingsRef.current?.contains(target);
      const inDetails = detailsRef.current?.contains(target);
      if (!inSettings && !inDetails) {
        setShowSettings(false);
        setShowDetails(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings, showDetails]);

  // Stop preview when settings panel closes
  useEffect(() => {
    if (!showSettings && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    }
  }, [showSettings]);

  // Stop all audio output when navigating away or unloading the page.
  useEffect(() => {
    const haltAudio = () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      audioRef.current = null;
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
      }
      previewAudioRef.current = null;
    };

    window.addEventListener("pagehide", haltAudio);
    window.addEventListener("beforeunload", haltAudio);
    return () => {
      window.removeEventListener("pagehide", haltAudio);
      window.removeEventListener("beforeunload", haltAudio);
      haltAudio();
    };
  }, []);

  const reportTtsClientLog = useCallback(
    (
      scope: string,
      message: string,
      options?: {
        level?: "debug" | "info" | "warn" | "error";
        error?: unknown;
        meta?: Record<string, unknown>;
      }
    ) => {
      void pipeTtsErrorToServer({
        scope,
        message,
        level: options?.level || "info",
        error: options?.error,
        meta: options?.meta,
        projectId,
      });
    },
    [projectId]
  );

  const reportTtsClientError = useCallback(
    (
      scope: string,
      message: string,
      error?: unknown,
      meta?: Record<string, unknown>
    ) => {
      reportTtsClientLog(scope, message, {
        level: "error",
        error,
        meta,
      });
    },
    [reportTtsClientLog]
  );

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

      // Preview should take over output — stop the main reader first.
      if (audioRef.current || state !== "idle") {
        reportTtsClientLog(
          "audio_bar.preview_voice.stop_main",
          "Stopping main audio before preview",
          {
            level: "info",
            meta: { currentState: state, voiceId: vid },
          }
        );
        stopPlaybackRef.current();
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
      } catch (err) {
        reportTtsClientError(
          "audio_bar.preview_voice",
          "Voice preview playback failed",
          err,
          { voiceId: vid }
        );
        setPreviewingVoice(null);
        previewAudioRef.current = null;
      }
    },
    [previewingVoice, reportTtsClientError, reportTtsClientLog, state, volume]
  );

  // Auto-save TTS settings to project when changed
  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    if (skipNextSettingsSaveRef.current) {
      skipNextSettingsSaveRef.current = false;
      return;
    }

    const settings = {
      ...projectSettingsRef.current,
      tts: {
        voiceId,
        model,
        simpleMode,
        followAlong,
        v2: clampV2Settings(v2Settings),
      },
    };
    dispatch({ type: "settings:save", settings });
  }, [voiceId, model, simpleMode, followAlong, v2Settings, dispatch]);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }, []);

  const ensureCore = useCallback(() => {
    const settings = {
      voiceId,
      model,
      v2: clampV2Settings(v2Settings),
    };
    if (!coreRef.current || coreProjectIdRef.current !== projectId) {
      coreRef.current = new TtsRenderCore({
        projectId,
        getAccessToken,
        settings,
      });
      coreProjectIdRef.current = projectId;
      return coreRef.current;
    }
    coreRef.current.updateSettings(settings);
    return coreRef.current;
  }, [getAccessToken, model, projectId, v2Settings, voiceId]);

  const clearBlobUrls = useCallback(() => {
    for (const url of blobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    blobUrlsRef.current.clear();
  }, []);

  const materializeStreamingChunk = useCallback(
    async (chunk: TtsChunk, prepared: TtsPreparedChunk): Promise<TtsPreparedChunk> => {
      if (!prepared.streamId) return prepared;
      const core = ensureCore();
      let candidate = prepared;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(candidate.audioUrl);
        if (res.ok) {
          const bytes = await res.arrayBuffer();
          const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
          blobUrlsRef.current.add(blobUrl);
          return {
            ...candidate,
            audioUrl: blobUrl,
            streamId: null,
          };
        }

        lastErr = new Error(
          `Chunk stream fetch failed (${res.status}) for chunk ${chunk.index + 1}`
        );
        core.invalidateChunk(chunk);
        await sleep(200 + attempt * 200);
        candidate = await core.prepareChunk(chunk, { force: false });
        if (!candidate.streamId) return candidate;
      }

      throw lastErr instanceof Error
        ? lastErr
        : new Error(`Chunk stream fetch failed for chunk ${chunk.index + 1}`);
    },
    [ensureCore]
  );

  const ensurePreparedChunk = useCallback(
    async (
      chunkIndex: number,
      options: {
        force?: boolean;
        waitForTimestamps?: boolean;
        reason?: string;
      } = {}
    ): Promise<TtsPreparedChunk> => {
      const { force = false, waitForTimestamps = false } = options;
      const chunk = chunkPlanRef.current[chunkIndex];
      if (!chunk) {
        throw new Error(`Chunk ${chunkIndex + 1} not found`);
      }

      if (force) {
        chunkAudioPrepRef.current.delete(chunkIndex);
      } else {
        const existing = chunkAudioPrepRef.current.get(chunkIndex);
        if (existing) {
          const prepared = await existing;
          if (!waitForTimestamps) return prepared;
          const ts = prepared.timestamps.length > 0 ? prepared.timestamps : await prepared.timestampsReady;
          prepared.timestamps = ts;
          applyChunkTimestampsRef.current(chunkIndex, ts);
          setChunkStatus(chunkIndex, {
            timing: ts.length > 0 ? "ready" : "missing",
            note: ts.length > 0 ? `timestamps ${ts.length}` : "timestamps unavailable",
          });
          return prepared;
        }
      }

      const run = (async () => {
        const core = ensureCore();
        if (force) {
          core.invalidateChunk(chunk);
          preparedChunksRef.current.delete(chunkIndex);
        }

        setChunkStatus(chunkIndex, {
          audio: "preparing",
          timing: "pending",
          note: "requesting audio",
        });

        let prepared = preparedChunksRef.current.get(chunkIndex);
        if (!prepared) {
          prepared = await core.prepareChunk(chunk, { force });
        }

        prepared = await materializeStreamingChunk(chunk, prepared);

        preparedChunksRef.current.set(chunkIndex, prepared);

        setChunkStatus(chunkIndex, {
          audio: "ready-cached",
          timing: prepared.timestamps.length > 0 ? "ready" : "pending",
          note: prepared.timestamps.length > 0 ? "ready" : "waiting timestamps",
        });

        if (prepared.timestamps.length > 0) {
          applyChunkTimestampsRef.current(chunkIndex, prepared.timestamps);
        }

        if (waitForTimestamps) {
          const ts =
            prepared.timestamps.length > 0
              ? prepared.timestamps
              : await prepared.timestampsReady;
          prepared.timestamps = ts;
          applyChunkTimestampsRef.current(chunkIndex, ts);
          setChunkStatus(chunkIndex, {
            timing: ts.length > 0 ? "ready" : "missing",
            note: ts.length > 0 ? `timestamps ${ts.length}` : "timestamps unavailable",
          });
        }

        return prepared;
      })().catch((err) => {
        chunkAudioPrepRef.current.delete(chunkIndex);
        setChunkStatus(chunkIndex, {
          audio: "error",
          timing: "missing",
          note: err instanceof Error ? err.message : "prepare failed",
        });
        throw err;
      });

      chunkAudioPrepRef.current.set(chunkIndex, run);
      return run;
    },
    [ensureCore, materializeStreamingChunk, setChunkStatus]
  );

  const warmAllChunks = useCallback(
    (chunks: TtsChunk[], force = false): Promise<void> => {
      if (chunks.length === 0) return Promise.resolve();
      const safe = clampV2Settings(v2Settings);
      const settingsKey = JSON.stringify({
        voiceId,
        model,
        stability: safe.stability,
        similarityBoost: safe.similarityBoost,
        style: safe.style,
        speed: safe.speed,
      });
      const key = `${settingsKey}:${chunks.map((chunk) => chunk.key).join(",")}:${force ? "force" : "normal"}`;
      if (!force && fullPrepPromiseRef.current && fullPrepKeyRef.current === key) {
        return fullPrepPromiseRef.current;
      }

      const runId = fullPrepRunIdRef.current + 1;
      fullPrepRunIdRef.current = runId;
      fullPrepKeyRef.current = key;

      const run = (async () => {
        let done = 0;
        let cursor = 0;
        const total = chunks.length;
        reportTtsClientLog("audio_bar.full_prep.start", "Started full-document audio + STT prep", {
          level: "info",
          meta: {
            chunkCount: total,
            force,
          },
        });
        setActivity(`Preparing full document audio (0/${total})...`);

        const worker = async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= total) return;
            const chunkIndex = chunks[idx].index;
            const prepared = await ensurePreparedChunk(chunkIndex, {
              force,
              waitForTimestamps: true,
              reason: "full-warm",
            });
            done += 1;
            reportTtsClientLog("audio_bar.full_prep.chunk", "Prepared chunk audio + STT", {
              level: "info",
              meta: {
                chunkIndex,
                done,
                total,
                timestampCount: prepared.timestamps.length,
              },
            });
            if (fullPrepRunIdRef.current === runId) {
              setActivity(`Preparing full document audio (${done}/${total})...`);
            }
          }
        };

        const workers = Math.max(1, Math.min(FULL_PREP_CONCURRENCY, total));
        await Promise.all(
          Array.from({ length: workers }, () => worker())
        );
        if (fullPrepRunIdRef.current === runId) {
          reportTtsClientLog("audio_bar.full_prep.done", "Completed full-document audio + STT prep", {
            level: "info",
            meta: {
              chunkCount: total,
            },
          });
          setActivity(null);
        }
      })().catch((err) => {
        if (fullPrepRunIdRef.current === runId) {
          reportTtsClientError(
            "audio_bar.full_prep",
            "Full-document preparation failed",
            err,
            { chunkCount: chunks.length }
          );
          setActivity(null);
        }
        throw err;
      });

      fullPrepPromiseRef.current = run;
      return run;
    },
    [ensurePreparedChunk, model, reportTtsClientError, reportTtsClientLog, v2Settings, voiceId]
  );

  const recalcTimelineDuration = useCallback(() => {
    const total = sum(chunkDurationsRef.current);
    setMediaDuration(total);
    setTimingDuration(total);
    return total;
  }, []);

  const chunkStartTime = useCallback((chunkIndex: number) => {
    let acc = 0;
    for (let i = 0; i < chunkIndex; i++) {
      acc += chunkDurationsRef.current[i] || 0;
    }
    return acc;
  }, []);

  const dispatchPlaybackFromCurrentTime = useCallback(
    (audio: HTMLAudioElement) => {
      const chunk = currentChunkRef.current;
      const ts = timestampsRef.current;
      if (!chunk) return;
      if (!followAlong) return;

      if (ts.length === 0) {
        if (!missingTimingLoggedRef.current) {
          const message =
            "Missing timing information; cursor animation disabled until real timestamps are available";
          console.error("[AudioBar]", message);
          reportTtsClientError(
            "audio_bar.missing_timestamps",
            message,
            undefined,
            {
              chunkIndex: chunk.index,
              lineOffset: chunk.lineOffset,
              lineCount: chunk.lineCount,
            }
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
      const fromChar = chunk.charOffset + best.fromChar;
      const toChar = chunk.charOffset + best.toChar;
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
    [dispatch, followAlong, reportTtsClientError, simpleMode]
  );

  const updatePlaybackFromAudio = useCallback(
    (audio: HTMLAudioElement) => {
      const total = sum(chunkDurationsRef.current);
      const start = chunkStartTime(currentChunkIndexRef.current);
      const now = start + audio.currentTime;
      setCurrentTime(now);
      if (total > 0) {
        setProgress(Math.max(0, Math.min(1, now / total)));
      } else {
        setProgress(0);
      }
      dispatchPlaybackFromCurrentTime(audio);
    },
    [chunkStartTime, dispatchPlaybackFromCurrentTime]
  );

  const applyChunkTimestamps = useCallback(
    (chunkIndex: number, ts: LineTimestamp[]) => {
      if (ts.length === 0) {
        setChunkStatus(chunkIndex, { timing: "missing" });
        return;
      }
      setChunkStatus(chunkIndex, { timing: "ready" });
      const duration = getTimestampDuration(ts);
      if (duration > 0) {
        chunkDurationsRef.current[chunkIndex] = duration;
        recalcTimelineDuration();
      }
      if (chunkIndex === currentChunkIndexRef.current) {
        timestampsRef.current = ts;
        missingTimingLoggedRef.current = false;
        const audio = audioRef.current;
        if (audio) updatePlaybackFromAudio(audio);
      }
    },
    [recalcTimelineDuration, setChunkStatus, updatePlaybackFromAudio]
  );
  applyChunkTimestampsRef.current = applyChunkTimestamps;

  const stop = useCallback(() => {
    playbackSessionRef.current += 1;
    fullPrepRunIdRef.current += 1;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    audioRef.current = null;

    chunkPlanRef.current = [];
    preparedChunksRef.current.clear();
    chunkAudioPrepRef.current.clear();
    chunkDurationsRef.current = [];
    chunkStatusRef.current.clear();
    fullPrepPromiseRef.current = null;
    fullPrepKeyRef.current = "";
    clearBlobUrls();
    currentChunkRef.current = null;
    currentChunkIndexRef.current = 0;
    forceRunRef.current = false;
    timestampsRef.current = [];
    missingTimingLoggedRef.current = false;
    lastHighlightLine.current = null;

    setState("idle");
    setProgress(0);
    setMediaDuration(0);
    setTimingDuration(0);
    setCurrentTime(0);
    setActivity(null);
    bumpDetails();
    dispatch({ type: "tts:clear" });
  }, [bumpDetails, clearBlobUrls, dispatch]);
  stopPlaybackRef.current = stop;

  const playChunk = useCallback(
    async (
      chunkIndex: number,
      options: {
        sessionId: number;
        startAt?: number;
        force?: boolean;
        seekLine?: number;
        seekChar?: number;
        preferPreciseSeek?: boolean;
      }
    ) => {
      const {
        sessionId,
        startAt = 0,
        force = false,
        seekLine,
        seekChar,
        preferPreciseSeek = false,
      } = options;
      const chunk = chunkPlanRef.current[chunkIndex];
      if (!chunk) {
        if (playbackSessionRef.current !== sessionId) return;
        setState("idle");
        setProgress(0);
        setCurrentTime(0);
        setActivity(null);
        timestampsRef.current = [];
        currentChunkRef.current = null;
        currentChunkIndexRef.current = 0;
        lastHighlightLine.current = null;
        dispatch({ type: "tts:highlight-clear" });
        dispatch({ type: "tts:playback-stop" });
        dispatch({ type: "tts:clear" });
        return;
      }

      if (playbackSessionRef.current !== sessionId) return;

      const prevAudio = audioRef.current;
      if (prevAudio) {
        prevAudio.pause();
        audioRef.current = null;
      }

      currentChunkRef.current = chunk;
      currentChunkIndexRef.current = chunkIndex;
      timestampsRef.current = [];
      missingTimingLoggedRef.current = false;
      for (const [idx, status] of chunkStatusRef.current.entries()) {
        if (status.audio === "playing") {
          const fallbackAudio =
            status.note?.includes("cache") ? "ready-cached" : "ready-streaming";
          chunkStatusRef.current.set(idx, {
            ...status,
            audio: fallbackAudio,
          });
        }
      }
      bumpDetails();
      setChunkStatus(chunkIndex, {
        audio: "preparing",
        timing: "pending",
        note: "requesting audio",
      });
      setActivity(chunkIndex === 0 ? "Preparing first segment..." : "Preparing next segment...");

      let prepared: TtsPreparedChunk;
      try {
        prepared = await ensurePreparedChunk(chunkIndex, {
          force,
          waitForTimestamps:
            Boolean(preferPreciseSeek) ||
            Boolean(seekLine) ||
            (typeof seekChar === "number" && Number.isFinite(seekChar)),
          reason: "playback",
        });
      } catch (err: any) {
        reportTtsClientError(
          "audio_bar.prepare_chunk",
          "Chunk preparation failed",
          err,
          {
            chunkIndex,
            lineOffset: chunk.lineOffset,
            lineCount: chunk.lineCount,
            force,
          }
        );
        setChunkStatus(chunkIndex, {
          audio: "error",
          timing: "missing",
          note: err?.message || "failed to prepare",
        });
        throw err;
      }

      if (playbackSessionRef.current !== sessionId) return;

      setChunkStatus(chunkIndex, {
        audio: "ready-cached",
        timing: prepared.timestamps.length > 0 ? "ready" : "pending",
        note: prepared.timestamps.length > 0 ? "ready" : "waiting timestamps",
      });

      setActivity(null);

      if (prepared.timestamps.length > 0) {
        timestampsRef.current = prepared.timestamps;
        applyChunkTimestamps(chunkIndex, prepared.timestamps);
      }

      const seekChunkChar =
        typeof seekChar === "number" && Number.isFinite(seekChar)
          ? Math.max(0, seekChar - chunk.charOffset)
          : undefined;

      if (
        preferPreciseSeek &&
        prepared.timestamps.length === 0 &&
        (seekLine || (typeof seekChunkChar === "number" && Number.isFinite(seekChunkChar)))
      ) {
        setActivity("Aligning exact word...");
        const maybeTimestamps = await Promise.race([
          prepared.timestampsReady.then((ts) => ts),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), PRECISE_SEEK_STT_WAIT_MS)
          ),
        ]);
        if (playbackSessionRef.current !== sessionId) return;
        if (maybeTimestamps && maybeTimestamps.length > 0) {
          prepared.timestamps = maybeTimestamps;
          applyChunkTimestamps(chunkIndex, maybeTimestamps);
          setChunkStatus(chunkIndex, {
            timing: "ready",
            note: `timestamps ${maybeTimestamps.length}`,
          });
          reportTtsClientLog("audio_bar.srt_ready_wait", "STT/SRT became ready during precise-seek wait", {
            level: "info",
            meta: {
              chunkIndex,
              timestampCount: maybeTimestamps.length,
            },
          });
        } else {
          reportTtsClientLog("audio_bar.srt_wait_timeout", "STT/SRT not ready before precise-seek wait timeout", {
            level: "warn",
            meta: {
              chunkIndex,
              waitMs: PRECISE_SEEK_STT_WAIT_MS,
            },
          });
        }
      }

      void prepared.timestampsReady.then((ts) => {
        if (playbackSessionRef.current !== sessionId) return;
        prepared.timestamps = ts;
        applyChunkTimestamps(chunkIndex, ts);
        if (ts.length === 0) {
          setChunkStatus(chunkIndex, { timing: "missing" });
          reportTtsClientLog("audio_bar.srt_missing", "No STT/SRT timestamps available for chunk", {
            level: "warn",
            meta: { chunkIndex },
          });
        } else {
          setChunkStatus(chunkIndex, {
            timing: "ready",
            note: `timestamps ${ts.length}`,
          });
          reportTtsClientLog("audio_bar.srt_ready", "STT/SRT timestamps ready for chunk", {
            level: "info",
            meta: {
              chunkIndex,
              timestampCount: ts.length,
            },
          });
          if (!preciseSeekApplied && chunkIndex === currentChunkIndexRef.current) {
            const preciseStart = getPreciseSeekStart(ts, seekLine, seekChunkChar);
            const activeAudio = audioRef.current;
            if (typeof preciseStart === "number" && Number.isFinite(preciseStart) && activeAudio) {
              const drift = preciseStart - activeAudio.currentTime;
              if (drift > 0.05 || activeAudio.currentTime < 0.25) {
                activeAudio.currentTime = preciseStart;
                updatePlaybackFromAudio(activeAudio);
              }
              preciseSeekApplied = true;
            }
          }
        }
        if (chunkIndex === currentChunkIndexRef.current && ts.length > 0) {
          setActivity(null);
        }
      });

      const audio = new Audio();
      audio.preload = "auto";
      audio.volume = volume;
      audioRef.current = audio;

      let seekApplied = false;
      let preciseSeekApplied = false;
      let desiredStart = Math.max(0, startAt);
      const initialPreciseStart = getPreciseSeekStart(
        prepared.timestamps,
        seekLine,
        seekChunkChar
      );
      if (typeof initialPreciseStart === "number" && Number.isFinite(initialPreciseStart)) {
        desiredStart = initialPreciseStart;
        preciseSeekApplied = true;
      }
      const applySeek = () => {
        if (seekApplied || desiredStart <= 0) return;
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        audio.currentTime = Math.min(desiredStart, Math.max(0, audio.duration - 0.05));
        seekApplied = true;
      };

      const updateChunkDuration = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          chunkDurationsRef.current[chunkIndex] = audio.duration;
          recalcTimelineDuration();
          applySeek();
        }
      };

      audio.addEventListener("loadedmetadata", () => {
        updateChunkDuration();
        updatePlaybackFromAudio(audio);
      });

      audio.addEventListener("durationchange", () => {
        updateChunkDuration();
        updatePlaybackFromAudio(audio);
      });

      audio.addEventListener("timeupdate", () => {
        updatePlaybackFromAudio(audio);
      });

      audio.addEventListener("ended", () => {
        reportTtsClientLog("audio_bar.chunk_ended", "Chunk playback ended", {
          level: "info",
          meta: {
            chunkIndex,
          },
        });
        dispatch({ type: "tts:highlight-clear" });
        dispatch({ type: "tts:playback-stop" });
        setChunkStatus(chunkIndex, {
          audio: prepared?.streamId ? "ready-streaming" : "ready-cached",
        });
        const next = chunkIndex + 1;
        if (next < chunkPlanRef.current.length) {
          void playChunkRef.current?.(next, {
            sessionId,
            startAt: 0,
            force,
          });
          return;
        }

        if (playbackSessionRef.current !== sessionId) return;
        audioRef.current = null;
        timestampsRef.current = [];
        currentChunkRef.current = null;
        currentChunkIndexRef.current = 0;
        lastHighlightLine.current = null;
        setState("idle");
        setProgress(0);
        setCurrentTime(0);
        setActivity(null);
        dispatch({ type: "tts:clear" });
      });

      audio.src = prepared.audioUrl;
      applySeek();
      try {
        await audio.play();
      } catch (err: any) {
        reportTtsClientError(
          "audio_bar.play_chunk",
          "Audio playback failed for chunk",
          err,
          {
            chunkIndex,
            lineOffset: chunk.lineOffset,
            lineCount: chunk.lineCount,
          }
        );
        setChunkStatus(chunkIndex, {
          audio: "error",
          note: err?.message || "playback failed",
        });
        throw err;
      }
      if (playbackSessionRef.current !== sessionId) {
        audio.pause();
        return;
      }

      setState("playing");
      reportTtsClientLog("audio_bar.chunk_started", "Chunk playback started", {
        level: "info",
        meta: {
          chunkIndex,
          seekLine,
          seekChar,
          startAt: desiredStart,
        },
      });
      setChunkStatus(chunkIndex, {
        audio: "playing",
      });
      setActivity(null);
      updatePlaybackFromAudio(audio);

      const nextChunk = chunkPlanRef.current[chunkIndex + 1];
      if (nextChunk) {
        void ensurePreparedChunk(nextChunk.index, {
          force: false,
          waitForTimestamps: false,
          reason: "prefetch",
        }).catch(() => {
          // Best effort prefetch only.
        });
      }
    },
    [
      applyChunkTimestamps,
      bumpDetails,
      dispatch,
      ensurePreparedChunk,
      recalcTimelineDuration,
      reportTtsClientError,
      reportTtsClientLog,
      setChunkStatus,
      updatePlaybackFromAudio,
      volume,
    ]
  );
  playChunkRef.current = playChunk;

  // Stop playback when file changes
  useEffect(() => {
    stop();
  }, [openFilePath, stop]);

  // Smart kernel: keep an always-updated full-document chunk plan and invalidate cached audio when settings change.
  const settingsKernelKey = useMemo(() => {
    const safe = clampV2Settings(v2Settings);
    return JSON.stringify({
      voiceId,
      model,
      stability: safe.stability,
      similarityBoost: safe.similarityBoost,
      style: safe.style,
      speed: safe.speed,
    });
  }, [model, v2Settings, voiceId]);
  const lastKernelContentHashRef = useRef<number>(hashStr(content || ""));
  const lastKernelSettingsKeyRef = useRef<string>(settingsKernelKey);

  useEffect(() => {
    const nextChunks = content?.trim() ? buildTtsChunks(content, 1) : [];
    const contentHash = hashStr(content || "");
    const contentChanged = lastKernelContentHashRef.current !== contentHash;
    const settingsChanged = lastKernelSettingsKeyRef.current !== settingsKernelKey;
    const needsInitialPlan =
      nextChunks.length > 0 && chunkPlanRef.current.length === 0;
    if (!contentChanged && !settingsChanged && !needsInitialPlan) return;

    lastKernelContentHashRef.current = contentHash;
    lastKernelSettingsKeyRef.current = settingsKernelKey;

    ensureCore();
    if (settingsChanged) {
      fullPrepRunIdRef.current += 1;
      fullPrepPromiseRef.current = null;
      fullPrepKeyRef.current = "";
      chunkAudioPrepRef.current.clear();
      clearBlobUrls();
    }

    if (nextChunks.length === 0) {
      fullPrepRunIdRef.current += 1;
      fullPrepPromiseRef.current = null;
      fullPrepKeyRef.current = "";
      chunkAudioPrepRef.current.clear();
      clearBlobUrls();
      chunkPlanRef.current = [];
      preparedChunksRef.current.clear();
      chunkDurationsRef.current = [];
      chunkStatusRef.current.clear();
      bumpDetails();
      if (state !== "idle") stop();
      return;
    }

    const prevChunks = chunkPlanRef.current;
    const prevPrepared = preparedChunksRef.current;
    const prevDurations = chunkDurationsRef.current;
    const prevStatus = chunkStatusRef.current;
    const prevIndexByKey = new Map<string, number>();
    for (const chunk of prevChunks) {
      prevIndexByKey.set(chunk.key, chunk.index);
    }

    const nextPrepared = new Map<number, TtsPreparedChunk>();
    const nextDurations: number[] = [];
    const nextStatus = new Map<number, ChunkRuntimeStatus>();

    for (const chunk of nextChunks) {
      const estimate = estimateChunkDurationSeconds(chunk);
      const prevIndex = prevIndexByKey.get(chunk.key);
      const reusable = prevIndex !== undefined && !settingsChanged;
      if (!reusable) {
        nextDurations[chunk.index] = estimate;
        nextStatus.set(chunk.index, {
          audio: "pending",
          timing: "pending",
          note: settingsChanged ? "settings changed" : "queued",
        });
        continue;
      }

      const prepared = prevPrepared.get(prevIndex);
      if (prepared) {
        nextPrepared.set(chunk.index, { ...prepared, chunk });
      }
      nextDurations[chunk.index] = prevDurations[prevIndex] || estimate;
      const existingStatus = prevStatus.get(prevIndex);
      if (existingStatus) {
        nextStatus.set(chunk.index, {
          ...existingStatus,
          audio:
            state === "idle" && existingStatus.audio === "playing"
              ? "ready-cached"
              : existingStatus.audio,
        });
      } else {
        nextStatus.set(chunk.index, {
          audio: prepared
            ? prepared.streamId
              ? "ready-streaming"
              : "ready-cached"
            : "pending",
          timing:
            prepared && prepared.timestamps.length > 0 ? "ready" : "pending",
          note: prepared
            ? prepared.streamId
              ? "streaming source"
              : "disk cache hit"
            : "queued",
        });
      }
    }

    chunkPlanRef.current = nextChunks;
    preparedChunksRef.current = nextPrepared;
    chunkDurationsRef.current = nextDurations;
    chunkStatusRef.current = nextStatus;
    bumpDetails();

    if (state !== "idle") {
      if (settingsChanged) {
        stop();
        return;
      }
      const activeChunk = currentChunkRef.current;
      if (activeChunk) {
        const stillExists = nextChunks.some((chunk) => chunk.key === activeChunk.key);
        if (!stillExists) stop();
      }
    }
  }, [bumpDetails, clearBlobUrls, content, ensureCore, settingsKernelKey, state, stop]);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Simple mode and follow-along toggle can disable sync state.
  useEffect(() => {
    if (simpleMode || !followAlong) {
      if (!followAlong) {
        dispatch({ type: "tts:highlight-clear" });
      }
      dispatch({ type: "tts:playback-stop" });
    }
  }, [dispatch, followAlong, simpleMode]);

  const playFrom = useCallback(
    async (
      fromTarget?: number | { fromLine: number; fromChar?: number }
    ) => {
      if (!content?.trim()) return;

      playbackSessionRef.current += 1;
      const sessionId = playbackSessionRef.current;

      ensureCore();

      const lines = content.split("\n");
      const requestedLine =
        typeof fromTarget === "number" ? fromTarget : fromTarget?.fromLine;
      const requestedChar =
        typeof fromTarget === "object" ? fromTarget.fromChar : undefined;
      const targetLine = Math.max(
        1,
        Math.min(lines.length, requestedLine && requestedLine > 1 ? requestedLine : 1)
      );
      const targetChar =
        Number.isFinite(requestedChar) && typeof requestedChar === "number"
          ? Math.max(0, Math.min(content.length - 1, requestedChar))
          : undefined;
      const hasTargetChar =
        typeof targetChar === "number" && Number.isFinite(targetChar);

      const chunks = buildTtsChunks(content, 1);
      if (chunks.length === 0) return;
      const existingPlan = chunkPlanRef.current;
      const samePlan =
        existingPlan.length === chunks.length &&
        existingPlan.every(
          (chunk, idx) =>
            chunk.key === chunks[idx].key &&
            chunk.lineOffset === chunks[idx].lineOffset &&
            chunk.lineCount === chunks[idx].lineCount
        );

      const force = forceRegenRef.current;
      forceRegenRef.current = false;
      forceRunRef.current = force;

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      chunkPlanRef.current = chunks;
      if (!samePlan || force) {
        fullPrepRunIdRef.current += 1;
        fullPrepPromiseRef.current = null;
        fullPrepKeyRef.current = "";
        preparedChunksRef.current.clear();
        chunkAudioPrepRef.current.clear();
        clearBlobUrls();
        chunkDurationsRef.current = chunks.map(estimateChunkDurationSeconds);
        chunkStatusRef.current = new Map(
          chunks.map((chunk) => [
            chunk.index,
            {
              audio: "pending",
              timing: "pending",
              note: force ? "forced regen" : "queued",
            } as ChunkRuntimeStatus,
          ])
        );
      } else {
        if (chunkDurationsRef.current.length !== chunks.length) {
          chunkDurationsRef.current = chunks.map(
            (chunk, idx) =>
              chunkDurationsRef.current[idx] || estimateChunkDurationSeconds(chunk)
          );
        }
        for (const chunk of chunks) {
          if (!chunkStatusRef.current.has(chunk.index)) {
            chunkStatusRef.current.set(chunk.index, {
              audio: "pending",
              timing: "pending",
              note: "queued",
            });
          }
        }
      }
      currentChunkRef.current = null;
      currentChunkIndexRef.current = 0;
      timestampsRef.current = [];
      missingTimingLoggedRef.current = false;
      lastHighlightLine.current = null;
      bumpDetails();

      const estimatedTotal = sum(chunkDurationsRef.current);
      setMediaDuration(estimatedTotal);
      setTimingDuration(estimatedTotal);
      setProgress(0);
      setCurrentTime(0);
      setState("loading");
      setError(null);
      setActivity(targetLine > 1 ? "Jumping to selected line..." : "Preparing first segment...");
      dispatch({ type: "tts:clear" });
      reportTtsClientLog("audio_bar.play_from.request", "Play-from requested", {
        level: "info",
        meta: {
          targetLine,
          targetChar,
          force,
          chunkCount: chunks.length,
        },
      });

      let targetChunkIndex = -1;
      if (hasTargetChar) {
        targetChunkIndex = chunks.findIndex((chunk) => {
          const chunkEnd = chunk.charOffset + chunk.text.length;
          return targetChar >= chunk.charOffset && targetChar < chunkEnd;
        });
      }
      if (targetChunkIndex === -1) {
        targetChunkIndex = chunks.findIndex(
          (chunk) =>
            targetLine >= chunk.lineOffset &&
            targetLine <= chunk.lineOffset + chunk.lineCount - 1
        );
      }
      if (targetChunkIndex === -1) targetChunkIndex = 0;
      const targetPrepared = preparedChunksRef.current.get(targetChunkIndex);
      const targetChunk = chunks[targetChunkIndex];
      const targetChunkChar =
        hasTargetChar && targetChunk
          ? targetChar - targetChunk.charOffset
          : undefined;
      const warmPromise = warmAllChunks(chunks, force);
      const startAt =
        getPreciseSeekStart(
          targetPrepared?.timestamps || [],
          targetLine > 1 ? targetLine : undefined,
          targetChunkChar
        ) ?? 0;
      const preferPreciseSeek =
        targetLine > 1 || hasTargetChar;

      try {
        if (targetChunkIndex > 0 || preferPreciseSeek) {
          setActivity("Preparing full document for precise seek...");
          await warmPromise;
        } else {
          void warmPromise.catch(() => {
            // Playback can continue even if background warmup fails.
          });
        }

        await playChunkRef.current?.(targetChunkIndex, {
          sessionId,
          startAt,
          force,
          seekLine: targetLine > 1 ? targetLine : undefined,
          seekChar: targetChar,
          preferPreciseSeek,
        });
      } catch (err: any) {
        if (playbackSessionRef.current !== sessionId) return;
        console.error("[AudioBar]", err);
        reportTtsClientError(
          "audio_bar.play_from",
          "Playback failed while starting from requested line",
          err,
          {
            fromLine: targetLine,
            fromChar: targetChar,
            targetChunkIndex,
            preferPreciseSeek,
          }
        );
        setError(err.message || "Playback failed");
        setState("idle");
        setActivity(null);
      }
    },
    [
      bumpDetails,
      clearBlobUrls,
      content,
      dispatch,
      ensureCore,
      reportTtsClientError,
      reportTtsClientLog,
      warmAllChunks,
    ]
  );

  // Handle "read from here" triggered from editor
  useEffect(() => {
    if (ttsFromLine !== null) {
      void playFrom(ttsFromLine);
    }
  }, [ttsFromLine, playFrom]);

  const play = useCallback(() => {
    const pausedAudio = audioRef.current;
    if (state === "paused" && pausedAudio) {
      pausedAudio
        .play()
        .then(() => {
          setState("playing");
          updatePlaybackFromAudio(pausedAudio);
        })
        .catch((err) => {
          reportTtsClientError(
            "audio_bar.resume_playback",
            "Resuming paused audio failed",
            err,
            {
              chunkIndex: currentChunkIndexRef.current,
            }
          );
          setError(err instanceof Error ? err.message : "Playback failed");
          setState("paused");
        });
      return;
    }
    void playFrom();
  }, [playFrom, reportTtsClientError, state, updatePlaybackFromAudio]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) updatePlaybackFromAudio(audio);
    setState("paused");
  }, [updatePlaybackFromAudio]);

  const effectiveDuration = mediaDuration > 0 ? mediaDuration : timingDuration;

  const seekToGlobalTime = useCallback(
    (targetSeconds: number) => {
      const chunks = chunkPlanRef.current;
      if (chunks.length === 0) return;

      const total = sum(chunkDurationsRef.current);
      if (total <= 0) return;

      const safeTarget = Math.max(0, Math.min(total, targetSeconds));
      let acc = 0;
      let targetChunkIndex = chunks.length - 1;
      for (let i = 0; i < chunks.length; i++) {
        const dur = chunkDurationsRef.current[i] || estimateChunkDurationSeconds(chunks[i]);
        if (safeTarget <= acc + dur || i === chunks.length - 1) {
          targetChunkIndex = i;
          break;
        }
        acc += dur;
      }

      const withinChunk = Math.max(0, safeTarget - acc);
      if (targetChunkIndex === currentChunkIndexRef.current && audioRef.current) {
        audioRef.current.currentTime = withinChunk;
        updatePlaybackFromAudio(audioRef.current);
        return;
      }

      const sessionId = playbackSessionRef.current;
      const playPromise = playChunkRef.current?.(targetChunkIndex, {
        sessionId,
        startAt: withinChunk,
        force: forceRunRef.current,
      });
      if (playPromise) {
        void playPromise.catch((err) => {
          reportTtsClientError(
            "audio_bar.seek_to_time",
            "Failed to seek across chunks",
            err,
            {
              targetChunkIndex,
              targetSeconds: safeTarget,
              withinChunk,
            }
          );
          setError(err instanceof Error ? err.message : "Playback failed");
          setState("idle");
          setActivity(null);
        });
      }
    },
    [reportTtsClientError, updatePlaybackFromAudio]
  );

  const skipBack15 = useCallback(() => {
    seekToGlobalTime(Math.max(0, currentTime - 15));
  }, [currentTime, seekToGlobalTime]);

  const skipNextChunk = useCallback(() => {
    const chunks = chunkPlanRef.current;
    if (chunks.length === 0) return;
    const currentLine = lastHighlightLine.current ?? 1;
    const logicalChunks = getChunkStartLines(content || "");
    const nextChunkLine = logicalChunks.find((line) => line > currentLine);
    if (!nextChunkLine) return;

    let targetChunkIndex = chunks.findIndex(
      (chunk) => nextChunkLine <= chunk.lineOffset + chunk.lineCount - 1
    );
    if (targetChunkIndex === -1) targetChunkIndex = chunks.length - 1;

    if (targetChunkIndex === currentChunkIndexRef.current && audioRef.current) {
      const entry = timestampsRef.current.find((ts) => ts.line >= nextChunkLine);
      if (entry) {
        audioRef.current.currentTime = entry.start;
        updatePlaybackFromAudio(audioRef.current);
      }
      return;
    }

    const prepared = preparedChunksRef.current.get(targetChunkIndex);
    const startAt = prepared?.timestamps.find((ts) => ts.line >= nextChunkLine)?.start ?? 0;
    const sessionId = playbackSessionRef.current;
    const playPromise = playChunkRef.current?.(targetChunkIndex, {
      sessionId,
      startAt,
      force: forceRunRef.current,
    });
    if (playPromise) {
      void playPromise.catch((err) => {
        reportTtsClientError(
          "audio_bar.skip_next_chunk",
          "Skipping to next chunk failed",
          err,
          {
            targetChunkIndex,
            nextChunkLine,
          }
        );
        setError(err instanceof Error ? err.message : "Playback failed");
        setState("idle");
        setActivity(null);
      });
    }
  }, [content, reportTtsClientError, updatePlaybackFromAudio]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!Number.isFinite(effectiveDuration) || !effectiveDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      seekToGlobalTime(ratio * effectiveDuration);
    },
    [effectiveDuration, seekToGlobalTime]
  );

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const downloadAudio = useCallback(async () => {
    if (!content?.trim() || downloadBusy) return;
    const voiceName = VOICES.find((v) => v.id === voiceId)?.name ?? "voice";
    const baseName = (openFilePath?.split("/").pop() ?? "audio").replace(/\.[^.]+$/, "");
    const chunks = buildTtsChunks(content, 1);
    if (chunks.length === 0) return;

    const samePlan =
      chunkPlanRef.current.length === chunks.length &&
      chunkPlanRef.current.every(
        (chunk, idx) =>
          chunk.key === chunks[idx].key &&
          chunk.lineOffset === chunks[idx].lineOffset &&
          chunk.lineCount === chunks[idx].lineCount
      );
    if (!samePlan) {
      fullPrepRunIdRef.current += 1;
      fullPrepPromiseRef.current = null;
      fullPrepKeyRef.current = "";
      chunkPlanRef.current = chunks;
      preparedChunksRef.current.clear();
      chunkAudioPrepRef.current.clear();
      clearBlobUrls();
      chunkDurationsRef.current = chunks.map(estimateChunkDurationSeconds);
      chunkStatusRef.current = new Map(
        chunks.map((chunk) => [
          chunk.index,
          { audio: "pending", timing: "pending", note: "queued" } as ChunkRuntimeStatus,
        ])
      );
      bumpDetails();
    }

    setDownloadBusy(true);
    setError(null);
    setActivity(`Preparing full audio export (0/${chunks.length})...`);

    try {
      const buffers: ArrayBuffer[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        setChunkStatus(chunk.index, {
          audio: "preparing",
          note: `export ${i + 1}/${chunks.length}`,
        });

        const prepared = await ensurePreparedChunk(chunk.index, {
          force: false,
          waitForTimestamps: false,
          reason: "export",
        });

        setChunkStatus(chunk.index, {
          audio: prepared.streamId ? "ready-streaming" : "ready-cached",
          timing: prepared.timestamps.length > 0 ? "ready" : "pending",
          note: `export ${i + 1}/${chunks.length}`,
        });

        const res = await fetch(prepared.audioUrl);
        if (!res.ok) {
          throw new Error(`Failed to export chunk ${chunk.index + 1} (${res.status})`);
        }
        const bytes = await res.arrayBuffer();
        buffers.push(bytes);

        setActivity(`Preparing full audio export (${i + 1}/${chunks.length})...`);
      }

      const blob = new Blob(buffers, { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}-${voiceName}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setActivity(null);
    } catch (err) {
      reportTtsClientError(
        "audio_bar.download_audio",
        "Full-document audio download failed",
        err,
        {
          fileName: openFilePath || "",
          chunkCount: chunks.length,
        }
      );
      setError("Download failed");
      setActivity(null);
    } finally {
      setDownloadBusy(false);
    }
  }, [
    bumpDetails,
    clearBlobUrls,
    content,
    downloadBusy,
    ensurePreparedChunk,
    openFilePath,
    reportTtsClientError,
    setChunkStatus,
    voiceId,
  ]);

  const regenerate = useCallback(() => {
    forceRegenRef.current = true;
    stop();
    void playFrom();
  }, [stop, playFrom]);

  const hasContent = !!content?.trim();
  const isActive = state !== "idle";
  const hasDuration = Number.isFinite(effectiveDuration) && effectiveDuration > 0;
  const fileName = openFilePath?.split("/").pop() ?? "No file";
  const currentVoice = VOICES.find((v) => v.id === voiceId);
  const chunkPlan = chunkPlanRef.current;
  const currentChunkNumber = currentChunkRef.current ? currentChunkRef.current.index + 1 : 0;
  const preparedChunkCount = Array.from(chunkStatusRef.current.values()).filter((status) =>
    status.audio === "ready-cached" || status.audio === "ready-streaming" || status.audio === "playing"
  ).length;
  const timestampReadyCount = Array.from(chunkStatusRef.current.values()).filter(
    (status) => status.timing === "ready"
  ).length;

  return (
    <div className="h-16 bg-card border-t border-border shrink-0 flex items-center px-4 gap-4">
      {/* Left: file info */}
      <div className="flex items-center gap-3 w-56 min-w-0">
        <div className="relative">
          <AlbumArt text={content || ""} />
          {activity && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary activity-pulse" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-foreground font-medium truncate">
            {fileName}
          </div>
          <div className="text-xs truncate">
            {error ? (
              <button
                onClick={() => setError(null)}
                className="text-destructive hover:underline"
              >
                Error &middot; Click to dismiss
              </button>
            ) : activity ? (
              <span className="text-primary">{activity}</span>
            ) : (
              <span className="text-muted-foreground">
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
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Back 15 seconds"
          >
            <Rewind size={16} />
          </button>

          <button
            onClick={stop}
            disabled={!isActive}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Stop"
          >
            <Stop size={14} weight="fill" />
          </button>

          {state === "playing" ? (
            <button
              onClick={pause}
              className="w-8 h-8 rounded-full bg-text text-surface flex items-center justify-center hover:scale-105 transition-transform"
              title="Pause"
            >
              <Pause size={14} weight="fill" />
            </button>
          ) : (
            <button
              onClick={play}
              disabled={!hasContent || state === "loading"}
              className="w-8 h-8 rounded-full bg-text text-surface flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              title="Read aloud"
            >
              {state === "loading" ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                <Play size={14} weight="fill" />
              )}
            </button>
          )}

          <button
            onClick={skipNextChunk}
            disabled={!isActive}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Skip to next paragraph"
          >
            <SkipForward size={14} weight="fill" />
          </button>
        </div>

        {/* Progress bar row: time — bar — time */}
        <div className="flex items-center gap-2 w-full">
          <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right shrink-0">
            {isActive ? fmt(currentTime) : "0:00"}
          </span>
          <div
            className="flex-1 h-1 bg-border/50 rounded-full cursor-pointer group relative"
            onClick={seek}
          >
            {state === "loading" ? (
              <div className="h-full w-full overflow-hidden rounded-full">
                <div
                  className="h-full w-1/3 bg-primary rounded-full"
                  style={{
                    animation: "indeterminate-slide 1.5s ease-in-out infinite",
                  }}
                />
              </div>
            ) : (
              <>
                <div
                  className="h-full bg-primary rounded-full transition-[width] duration-100"
                  style={{ width: `${progress * 100}%` }}
                />
                {isActive && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-primary rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow"
                    style={{ left: `${progress * 100}%`, marginLeft: "-5px" }}
                  />
                )}
              </>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums w-8 shrink-0">
            {hasDuration ? fmt(effectiveDuration) : "0:00"}
          </span>
        </div>
      </div>

      {/* Right: download + volume + settings + close */}
      <div className="flex items-center gap-3 w-56 justify-end">
        <button
          onClick={downloadAudio}
          disabled={!hasContent || downloadBusy}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          title={downloadBusy ? "Preparing full MP3..." : "Download full MP3"}
        >
          {downloadBusy ? (
            <SpinnerGap size={16} className="animate-spin" />
          ) : (
            <DownloadSimple size={16} />
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={volume > 0 ? "Mute" : "Unmute"}
          >
            {volume === 0 ? (
              <SpeakerX size={16} />
            ) : volume < 0.5 ? (
              <SpeakerLow size={16} />
            ) : (
              <SpeakerHigh size={16} />
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
        <button
          onClick={() => setFollowAlong((v) => !v)}
          aria-pressed={followAlong}
          className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
            followAlong
              ? "border-primary/40 text-primary bg-primary/15 shadow-[inset_0_0_0_1px_rgba(196,149,106,0.15)]"
              : "border-border/90 text-muted-foreground bg-muted/50 opacity-70 hover:opacity-100 hover:text-foreground"
          }`}
          title={followAlong ? "Follow-along enabled (click to disable)" : "Follow-along disabled (click to enable)"}
        >
          Follow
        </button>

        <div className="relative">
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`text-muted-foreground hover:text-foreground transition-colors ${showSettings ? "text-primary" : ""}`}
            title="Voice settings"
          >
            <GearSix size={16} />
          </button>

          {/* Error popup */}
          {error && (
            <div className="absolute right-0 bottom-full mb-2 w-72 bg-card border border-danger/30 rounded-lg shadow-lg p-4 z-50">
              <div className="flex items-start gap-3">
                <Warning size={20} className="text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground mb-1">Playback Error</div>
                  <div className="text-xs text-muted-foreground break-words">{error}</div>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {showSettings && (
            <div
              ref={settingsRef}
              className="absolute right-0 bottom-full mb-2 w-64 bg-card border border-border rounded-lg shadow-lg p-3 z-50 max-h-80 overflow-y-auto"
            >
              {/* Voice selector */}
              <div className="text-xs font-medium text-foreground mb-1.5">Voice</div>
              <div className="grid grid-cols-2 gap-1 mb-3 max-h-36 overflow-y-auto">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center justify-between gap-1 ${
                      voiceId === v.id
                        ? "bg-primary text-white"
                        : "bg-muted text-muted-foreground hover:text-foreground"
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
                        <Stop size={8} weight="fill" />
                      ) : (
                        <Play size={8} weight="fill" />
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {/* Model selector */}
              <div className="text-xs font-medium text-foreground mb-1.5">Model</div>
              <div className="flex gap-1 mb-3">
                <button
                  onClick={() => setModel("v3")}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    model === "v3"
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  v3 + AI Tags
                </button>
                <button
                  onClick={() => setModel("v2")}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${
                    model === "v2"
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  v2 Classic
                </button>
              </div>

              {/* Reading mode */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-medium text-foreground">Simple mode</div>
                  <div className="text-[10px] text-muted-foreground">
                    Highlight only the current sentence
                  </div>
                </div>
                <button
                  onClick={() => setSimpleMode((s) => !s)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    simpleMode
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:text-foreground"
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
                className="w-full text-xs py-1.5 px-2 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed mb-3 flex items-center justify-center gap-1.5"
              >
                <ArrowsClockwise size={12} />
                Regenerate audio
              </button>

              {model === "v3" && (
                <p className="text-[10px] text-muted-foreground leading-relaxed">
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
        <div className="relative" ref={detailsRef}>
          <button
            onClick={() => setShowDetails((s) => !s)}
            className={`text-muted-foreground hover:text-foreground transition-colors ${showDetails ? "text-primary" : ""}`}
            title="Chunk details"
          >
            <ListBullets size={16} />
          </button>
          {showDetails && (
            <div className="absolute right-0 bottom-full mb-2 w-80 bg-card border border-border rounded-lg shadow-lg p-3 z-50 max-h-80 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-foreground">Playback Details</div>
                <button
                  onClick={() => setShowDetails(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Close details"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] mb-2">
                <div className="text-muted-foreground">
                  Chunks: <span className="text-foreground">{chunkPlan.length}</span>
                </div>
                <div className="text-muted-foreground">
                  Active: <span className="text-foreground">{currentChunkNumber || "-"}</span>
                </div>
                <div className="text-muted-foreground">
                  Audio ready: <span className="text-foreground">{preparedChunkCount}/{chunkPlan.length}</span>
                </div>
                <div className="text-muted-foreground">
                  Timestamps: <span className="text-foreground">{timestampReadyCount}/{chunkPlan.length}</span>
                </div>
              </div>

              <div className="space-y-1">
                {chunkPlan.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground py-1">No chunk plan yet. Start playback to populate.</div>
                ) : (
                  chunkPlan.map((chunk) => {
                    const status = chunkStatusRef.current.get(chunk.index) || {
                      audio: "pending",
                      timing: "pending",
                    };
                    const lineEnd = chunk.lineOffset + chunk.lineCount - 1;
                    const duration = chunkDurationsRef.current[chunk.index] || 0;
                    const timingLabel = status.timing === "pending" ? "pending" : status.timing;
                    return (
                      <div
                        key={chunk.index}
                        className={`rounded-md border px-2 py-1 ${currentChunkRef.current?.index === chunk.index ? "border-primary/50 bg-primary/10" : "border-border bg-muted/40"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] text-foreground font-medium">#{chunk.index + 1} · L{chunk.lineOffset}-{lineEnd}</div>
                          <div className="text-[10px] text-muted-foreground">{duration > 0 ? fmt(duration) : "~"}</div>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[10px] mt-0.5">
                          <div className={audioStatusTone(status.audio)}>
                            audio: {audioStatusLabel(status.audio)}
                          </div>
                          <div className={timingStatusTone(status.timing)}>
                            stt: {timingLabel}
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {chunk.text.replace(/\s+/g, " ").trim().slice(0, 56) || "(empty chunk)"}
                        </div>
                        {status.note && (
                          <div className="text-[10px] text-muted-foreground/90 truncate">
                            {status.note}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => { stop(); onClose(); }}
          className="text-muted-foreground hover:text-foreground transition-colors ml-1"
          title="Close player"
        >
          <X size={14} />
        </button>
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
      <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
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
