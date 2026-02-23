import { pipeTtsErrorToServer } from "./ttsClientLog.js";

export type TtsModel = "v2" | "v3";

export interface V2Settings {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

export interface EffectiveTtsSettings {
  voiceId: string;
  model: TtsModel;
  v2: V2Settings;
}

export interface LineTimestamp {
  start: number;
  end: number;
  line: number;
  fromChar: number;
  toChar: number;
}

export interface TtsChunk {
  index: number;
  text: string;
  lineOffset: number;
  lineCount: number;
  charOffset: number;
  key: string;
}

export interface TtsPreparedChunk {
  chunk: TtsChunk;
  audioUrl: string;
  timestamps: LineTimestamp[];
  timestampsReady: Promise<LineTimestamp[]>;
  streamId: string | null;
}

interface PrepareChunkOptions {
  force?: boolean;
}

interface CoreOptions {
  projectId: string;
  getAccessToken: () => Promise<string>;
  settings: EffectiveTtsSettings;
}

const TARGET_CHARS = 800;
const HARD_MAX_CHARS = 1100;
const SIZE_SPLIT_OVERFLOW = 180;
const FAST_POLL_STEPS_MS = [0, 200, 300, 450, 650, 900, 1200, 1500, 1800, 2200];
const MAX_POLL_ATTEMPTS = 45;

function hashString(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function parseTimestamps(raw: any): LineTimestamp[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(isValidTimestamp) as LineTimestamp[];
}

export function getTimestampDuration(timestamps: LineTimestamp[]): number {
  let maxEnd = 0;
  for (const ts of timestamps) {
    if (ts.end > maxEnd) maxEnd = ts.end;
  }
  return maxEnd;
}

export function clampV2Settings(input: V2Settings): V2Settings {
  return {
    ...input,
    speed: Math.max(0.7, Math.min(1.2, input.speed)),
  };
}

export function buildTtsChunks(content: string, fromLine = 1): TtsChunk[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const safeFromLine = Math.max(1, Math.min(fromLine, lines.length));

  const lineStarts: number[] = new Array(lines.length);
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = cursor;
    cursor += lines[i].length + 1;
  }

  const chunks: TtsChunk[] = [];
  let current = "";
  let currentStartLine = safeFromLine;
  let currentLineCount = 0;

  const pushCurrent = () => {
    if (!current.trim()) {
      current = "";
      currentLineCount = 0;
      return;
    }
    const charOffset = lineStarts[currentStartLine - 1] ?? 0;
    const key = hashString(`${currentStartLine}:${current}`);
    chunks.push({
      index: chunks.length,
      text: current,
      lineOffset: currentStartLine,
      lineCount: Math.max(1, currentLineCount),
      charOffset,
      key,
    });
    current = "";
    currentLineCount = 0;
  };

  for (let absLine = safeFromLine; absLine <= lines.length; absLine++) {
    const lineIdx = absLine - 1;
    const line = lines[lineIdx];
    const withNewline = absLine < lines.length ? `${line}\n` : line;
    const isBoundary = line.trim() === "" || /^#{1,6}\s/.test(line);

    const wouldExceedHard = current.length > 0 && current.length + withNewline.length > HARD_MAX_CHARS;
    const shouldSplitSoft = current.length >= TARGET_CHARS && isBoundary;
    const shouldSplitSize = current.length >= TARGET_CHARS + SIZE_SPLIT_OVERFLOW;

    if (wouldExceedHard || shouldSplitSoft || shouldSplitSize) {
      pushCurrent();
      currentStartLine = absLine;
    }

    if (!current) {
      currentStartLine = absLine;
    }

    current += withNewline;
    currentLineCount += 1;

    if (current.length >= HARD_MAX_CHARS) {
      pushCurrent();
      currentStartLine = absLine + 1;
    }
  }

  pushCurrent();
  return chunks;
}

function settingsSignature(settings: EffectiveTtsSettings): string {
  const v2 = clampV2Settings(settings.v2);
  return JSON.stringify({
    voiceId: settings.voiceId,
    model: settings.model,
    v2,
  });
}

export class TtsRenderCore {
  private projectId: string;
  private getAccessToken: () => Promise<string>;
  private settings: EffectiveTtsSettings;
  private signature: string;
  private cache = new Map<string, Promise<TtsPreparedChunk>>();

  constructor(options: CoreOptions) {
    this.projectId = options.projectId;
    this.getAccessToken = options.getAccessToken;
    this.settings = options.settings;
    this.signature = settingsSignature(options.settings);
  }

  updateSettings(next: EffectiveTtsSettings) {
    const nextSig = settingsSignature(next);
    this.settings = next;
    if (nextSig !== this.signature) {
      this.signature = nextSig;
      this.cache.clear();
    }
  }

  clear() {
    this.cache.clear();
  }

  invalidateChunk(chunk: TtsChunk) {
    this.cache.delete(this.cacheKey(chunk));
  }

  private cacheKey(chunk: TtsChunk): string {
    return `${this.signature}:${chunk.key}`;
  }

  prefetchChunk(chunk: TtsChunk): void {
    this.prepareChunk(chunk).catch(() => {
      // Best effort warmup only.
    });
  }

  prepareChunk(chunk: TtsChunk, options: PrepareChunkOptions = {}): Promise<TtsPreparedChunk> {
    const key = this.cacheKey(chunk);
    if (options.force) {
      this.cache.delete(key);
    } else {
      const existing = this.cache.get(key);
      if (existing) return existing;
    }

    const run = this.doPrepareChunk(chunk, options).catch((err) => {
      this.cache.delete(key);
      void pipeTtsErrorToServer({
        scope: "tts_core.prepare_chunk",
        message: "Failed to prepare TTS chunk",
        projectId: this.projectId,
        error: err,
        meta: {
          chunkIndex: chunk.index,
          lineOffset: chunk.lineOffset,
          lineCount: chunk.lineCount,
          force: Boolean(options.force),
        },
      });
      throw err;
    });

    this.cache.set(key, run);
    return run;
  }

  private async doPrepareChunk(chunk: TtsChunk, options: PrepareChunkOptions): Promise<TtsPreparedChunk> {
    const token = await this.getAccessToken();
    const safeV2 = clampV2Settings(this.settings.v2);
    const prepareStartedAt = Date.now();

    const body: Record<string, any> = {
      text: chunk.text,
      model: this.settings.model,
      voiceId: this.settings.voiceId,
      lineOffset: chunk.lineOffset,
      force: Boolean(options.force),
    };

    if (this.settings.model === "v2") {
      body.stability = safeV2.stability;
      body.similarityBoost = safeV2.similarityBoost;
      body.style = safeV2.style;
      body.speed = safeV2.speed;
    }

    const res = await fetch(`/api/tts/${this.projectId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "TTS failed" }));
      const errorMessage =
        typeof err?.error === "string" && err.error
          ? err.error
          : "TTS failed";
      throw new Error(`TTS failed (${res.status}): ${errorMessage}`);
    }

    const data = await res.json();

    if (data.cached) {
      const timestamps = parseTimestamps(data.timestamps);
      void pipeTtsErrorToServer({
        scope: "tts_core.prepare_chunk.cached",
        message: "Prepared chunk from cache",
        level: "info",
        projectId: this.projectId,
        token,
        meta: {
          chunkIndex: chunk.index,
          lineOffset: chunk.lineOffset,
          lineCount: chunk.lineCount,
          chars: chunk.text.length,
          hasTimestamps: timestamps.length > 0,
          timestampCount: timestamps.length,
          elapsedMs: Date.now() - prepareStartedAt,
        },
      });
      return {
        chunk,
        audioUrl: data.audioUrl,
        timestamps,
        timestampsReady: Promise.resolve(timestamps),
        streamId: null,
      };
    }

    const streamId = String(data.streamId || "");
    const audioUrl = `/api/tts/${this.projectId}/stream/${streamId}?token=${encodeURIComponent(token)}`;
    const timestampsReady = this.pollTimestamps(streamId, token);
    void pipeTtsErrorToServer({
      scope: "tts_core.prepare_chunk.stream",
      message: "Prepared chunk for streaming generation",
      level: "info",
      projectId: this.projectId,
      token,
      meta: {
        chunkIndex: chunk.index,
        lineOffset: chunk.lineOffset,
        lineCount: chunk.lineCount,
        chars: chunk.text.length,
        streamId,
        elapsedMs: Date.now() - prepareStartedAt,
      },
    });

    return {
      chunk,
      audioUrl,
      timestamps: [],
      timestampsReady,
      streamId,
    };
  }

  private async pollTimestamps(streamId: string, token: string): Promise<LineTimestamp[]> {
    let networkError: unknown = null;
    let nonOkCount = 0;
    const statusSamples: number[] = [];
    const startedAt = Date.now();

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const delay = FAST_POLL_STEPS_MS[Math.min(attempt, FAST_POLL_STEPS_MS.length - 1)] ?? 2200;
      if (delay > 0) await sleep(delay);

      try {
        const res = await fetch(`/api/tts/${this.projectId}/timestamps/${streamId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          nonOkCount += 1;
          if (statusSamples.length < 6) statusSamples.push(res.status);
          continue;
        }

        const data = await res.json();
        if (data.ready) {
          const parsed = parseTimestamps(data.timestamps);
          void pipeTtsErrorToServer({
            scope: "tts_core.srt_ready",
            message: "STT/SRT timestamps ready",
            level: "info",
            projectId: this.projectId,
            token,
            meta: {
              streamId,
              attempts: attempt + 1,
              timestampCount: parsed.length,
              elapsedMs: Date.now() - startedAt,
            },
          });
          return parsed;
        }
      } catch (err) {
        if (!networkError) networkError = err;
        // keep retrying
      }
    }

    void pipeTtsErrorToServer({
      scope: "tts_core.srt_timeout",
      message: "STT/SRT polling exhausted before timestamps became available",
      level: networkError ? "error" : "warn",
      projectId: this.projectId,
      token,
      error: networkError,
      meta: {
        streamId,
        attempts: MAX_POLL_ATTEMPTS,
        nonOkCount,
        statusSamples,
        elapsedMs: Date.now() - startedAt,
      },
    });

    return [];
  }
}
