import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { authMiddleware, getUser } from "./auth.js";
import { getProjectMembership } from "./db.js";
import { PROJECTS_DIR } from "./files.js";
import { deductCredits, calculateTtsCost, calculateChatCost, calculateWhisperCost } from "./credits.js";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TTS_DIR = ".tts"; // hidden folder inside each project

// Audiobook-quality voices
export const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Warm, calm narrator" },
  { id: "29vD33N1CtxCmqQRPOHJ", name: "Drew", desc: "Well-rounded, confident" },
  { id: "2EiwWnXFnvU5JabPnv8n", name: "Clyde", desc: "War veteran, deep" },
  { id: "5Q0t7uMcjvnagumLfvZi", name: "Paul", desc: "Ground news, authoritative" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", desc: "Strong, assertive" },
  { id: "CYw3kZ02Hs0563khs1Fj", name: "Dave", desc: "Conversational, friendly" },
  { id: "D38z5RcWu1voky8WS1ja", name: "Fin", desc: "Older, Irish accent" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Soft, young narrator" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "Well-rounded, calm" },
  { id: "GBv7mTt0atIp3Br8iCZE", name: "Thomas", desc: "Calm, collected" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", desc: "Natural Australian" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "Warm British narrator" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", desc: "Intense, transatlantic" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", desc: "Articulate, authoritative" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "Seductive, calm" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", desc: "Confident British" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "Warm, friendly" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", desc: "Friendly, young" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", desc: "Casual, conversational" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", desc: "Deep, authoritative" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "Deep, authoritative British" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "Warm, British narrator" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", desc: "Trustworthy American" },
  { id: "t0jbNlBVZ17f02VDIeMI", name: "Austin", desc: "Warm, grounded narrator" },
  { id: "z9fAnlkpzviPz146aGWa", name: "Glinda", desc: "Witchy, animated" },
];

const DEFAULT_VOICE_ID = "pqHfZKP75CvOlQylNhV4"; // Bill

const anthropic = new Anthropic();

export const ttsRouter = new Hono();

// --- In-memory stores for streaming jobs + async timestamps ---

interface TtsJob {
  text: string;
  originalText: string;
  voiceId: string;
  model: string;
  userId: string;
  projectId: string;
  lineOffset: number;
  cacheFile: string;
  v2Settings?: { stability: number; similarityBoost: number; style: number; speed: number };
  createdAt: number;
}

interface TimestampResult {
  timestamps: Array<{ start: number; end: number; line: number; fromChar: number; toChar: number }>;
  lineOffset: number;
  createdAt: number;
}

const pendingJobs = new Map<string, TtsJob>();
const completedTimestamps = new Map<string, TimestampResult>();

// Cleanup stale entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of pendingJobs) {
    if (now - job.createdAt > 5 * 60 * 1000) pendingJobs.delete(id);
  }
  for (const [id, data] of completedTimestamps) {
    if (now - data.createdAt > 10 * 60 * 1000) completedTimestamps.delete(id);
  }
}, 60 * 1000);

// --- Helpers ---

function ttsDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId, TTS_DIR);
}

async function ensureTtsDir(projectId: string): Promise<string> {
  const dir = ttsDir(projectId);
  await fs.mkdir(dir, { recursive: true });

  // Ensure .tts/ is in the project's .gitignore (handles existing projects)
  const gitignorePath = join(PROJECTS_DIR, projectId, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (!content.includes(".tts/")) {
      await fs.writeFile(gitignorePath, content.trimEnd() + "\n.tts/\n", "utf-8");
    }
  } catch {
    // No .gitignore yet — create one
    await fs.writeFile(gitignorePath, ".tts/\n", "utf-8");
  }

  return dir;
}

function makeCacheFilename(
  text: string,
  model: string,
  voiceId: string,
  settings?: Record<string, number>
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ text: text.slice(0, 5000), model, voiceId, settings }))
    .digest("hex")
    .slice(0, 16);
  return `${hash}.mp3`;
}

async function enhanceWithAudioTags(text: string): Promise<{ text: string; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } }> {
  const res = await anthropic.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: `You are an audio director enhancing text for ElevenLabs Eleven v3 text-to-speech. Add audio tags in square brackets to make the narration expressive and engaging.

Available tags: [whispers], [laughs], [sighs], [exhales], [excited], [sarcastic], [curious], [crying], [mischievously], [applause], [sings], [strong X accent]

Guidelines:
- Add tags sparingly — only where they genuinely enhance the reading
- Place tags immediately before the text they modify
- Don't over-tag: most sentences need no tags at all
- Use emotional tags for passages with clear sentiment
- Return ONLY the enhanced text, nothing else`,
    messages: [
      {
        role: "user",
        content: `Enhance this text with audio tags for expressive narration:\n\n${text}`,
      },
    ],
  });

  const usage = {
    input_tokens: res.usage?.input_tokens ?? 0,
    output_tokens: res.usage?.output_tokens ?? 0,
    cache_read_input_tokens: (res.usage as any)?.cache_read_input_tokens ?? 0,
  };

  const block = res.content[0];
  if (block.type === "text") return { text: block.text, usage };
  return { text, usage };
}

async function transcribeWithWhisper(
  audioData: ArrayBuffer | Uint8Array
): Promise<Array<{ start: number; end: number; text: string }>> {
  if (!OPENAI_API_KEY) return [];

  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([audioData], { type: "audio/mpeg" }),
      "audio.mp3"
    );
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    const resp = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      }
    );

    if (!resp.ok) {
      console.error("[tts] Whisper error:", resp.status);
      return [];
    }

    const data: any = await resp.json();
    return (data.segments || []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));
  } catch (err) {
    console.error("[tts] Whisper transcription failed:", err);
    return [];
  }
}

function mapSegmentsToLines(
  originalText: string,
  segments: Array<{ start: number; end: number; text: string }>
): Array<{ start: number; end: number; line: number; fromChar: number; toChar: number }> {
  const lines = originalText.split("\n");
  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStarts.push(lineStarts[i] + lines[i].length + 1);
  }

  function lineAtOffset(offset: number): number {
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (offset >= lineStarts[i]) return i + 1;
    }
    return 1;
  }

  const lowerOriginal = originalText.toLowerCase();
  let cursor = 0;
  const result: Array<{ start: number; end: number; line: number; fromChar: number; toChar: number }> = [];

  for (const seg of segments) {
    const clean = seg.text.trim().toLowerCase();
    if (!clean) continue;

    const searchKey = clean.substring(0, Math.min(40, clean.length));
    let idx = lowerOriginal.indexOf(searchKey, cursor);
    if (idx === -1) idx = lowerOriginal.indexOf(searchKey);
    if (idx === -1) idx = cursor;

    const fromChar = idx;
    const toChar = Math.min(idx + clean.length, originalText.length);

    result.push({ start: seg.start, end: seg.end, line: lineAtOffset(idx), fromChar, toChar });
    cursor = toChar;
  }

  return result;
}

function buildElevenLabsBody(job: TtsJob): Record<string, any> {
  if (job.model === "v3") {
    return { text: job.text, model_id: "eleven_v3" };
  }
  return {
    text: job.text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: job.v2Settings!.stability,
      similarity_boost: job.v2Settings!.similarityBoost,
      style: job.v2Settings!.style,
      speed: job.v2Settings!.speed,
    },
  };
}

interface TtsRequest {
  text: string;
  voiceId?: string;
  model?: "v2" | "v3";
  lineOffset?: number; // 1-based absolute line number where this text starts
  force?: boolean; // skip cache, regenerate audio
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- Routes ---

// List voices
ttsRouter.get("/tts/voices", authMiddleware, async (c) => {
  return c.json({ voices: VOICES });
});

// Preview a voice sample (proxied from ElevenLabs)
const previewCache = new Map<string, { url: string; expiresAt: number }>();

ttsRouter.get("/tts/preview/:voiceId", authMiddleware, async (c) => {
  if (!ELEVENLABS_API_KEY) return c.json({ error: "TTS not configured" }, 500);

  const vid = c.req.param("voiceId");
  if (!VOICES.some((v) => v.id === vid)) return c.json({ error: "Unknown voice" }, 404);

  // Check cache (preview URLs are stable but let's refresh hourly)
  const cached = previewCache.get(vid);
  if (cached && cached.expiresAt > Date.now()) {
    return c.redirect(cached.url);
  }

  const resp = await fetch(`https://api.elevenlabs.io/v1/voices/${vid}`, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
  });
  if (!resp.ok) return c.json({ error: "Failed to fetch voice info" }, 502);

  const data: any = await resp.json();
  const previewUrl = data.preview_url;
  if (!previewUrl) return c.json({ error: "No preview available" }, 404);

  previewCache.set(vid, { url: previewUrl, expiresAt: Date.now() + 60 * 60 * 1000 });
  return c.redirect(previewUrl);
});

// Prepare TTS: check disk cache or create streaming job
ttsRouter.post("/tts/:projectId", authMiddleware, async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  if (!ELEVENLABS_API_KEY) {
    return c.json({ error: "TTS not configured" }, 500);
  }

  const body = await c.req.json<TtsRequest>();
  const { text, voiceId, model = "v3", lineOffset = 1, force = false } = body;

  if (!text?.trim()) {
    return c.json({ error: "Text is required" }, 400);
  }

  // Client already slices text from lineOffset; just apply char limit
  const originalText = text.slice(0, 5000);

  const voice = voiceId || DEFAULT_VOICE_ID;
  const v2Settings =
    model === "v2"
      ? {
          stability: body.stability ?? 0.5,
          similarityBoost: body.similarityBoost ?? 0.75,
          style: body.style ?? 0,
          speed: clamp(body.speed ?? 1.0, 0.7, 1.2),
        }
      : undefined;

  const filename = makeCacheFilename(originalText, model, voice, v2Settings);
  const dir = await ensureTtsDir(projectId);
  const cachePath = join(dir, filename);

  // Force regeneration: delete cached files
  if (force) {
    const tsPath = cachePath.replace(/\.mp3$/, ".ts.json");
    await fs.unlink(cachePath).catch(() => {});
    await fs.unlink(tsPath).catch(() => {});
  }

  // Check disk cache
  try {
    const audioBuffer = await fs.readFile(cachePath);
    const tsPath = cachePath.replace(/\.mp3$/, ".ts.json");
    let timestamps: Array<{ start: number; end: number; line: number }>;
    try {
      // Read cached timestamps
      const tsRaw = await fs.readFile(tsPath, "utf-8");
      const base = JSON.parse(tsRaw) as Array<{ start: number; end: number; line: number }>;
      timestamps = base;
    } catch {
      // No cached timestamps — generate with Whisper and save
      const segments = await transcribeWithWhisper(audioBuffer);
      timestamps = mapSegmentsToLines(originalText, segments).map((t) => ({
        ...t,
        line: t.line + (lineOffset - 1),
      }));
      fs.writeFile(tsPath, JSON.stringify(timestamps), "utf-8").catch(() => {});
    }
    const base64 = audioBuffer.toString("base64");
    return c.json({
      cached: true,
      audioUrl: `data:audio/mpeg;base64,${base64}`,
      timestamps,
      lineOffset,
    });
  } catch {
    // Cache miss — continue to streaming
  }

  // Deduct credits for TTS generation (cache miss only)
  const ttsCost = calculateTtsCost(originalText.length);
  const deductResult = await deductCredits({
    userId: user.id,
    amount: ttsCost,
    service: "tts",
    projectId,
    metadata: { chars: originalText.length, model, voiceId: voice },
  });
  if (!deductResult.success) {
    return c.json({ error: "Insufficient credits" }, 402);
  }

  // Enhance text for v3
  let ttsText = originalText;
  if (model === "v3") {
    try {
      const enhanceRes = await enhanceWithAudioTags(ttsText);
      ttsText = enhanceRes.text;
      // Meter the Claude call for enhancement separately
      if (enhanceRes.usage) {
        const enhanceCost = calculateChatCost(enhanceRes.usage);
        if (enhanceCost > 0) {
          deductCredits({
            userId: user.id,
            amount: enhanceCost,
            service: "tts_enhance",
            projectId,
            metadata: { usage: enhanceRes.usage },
          }).catch((err) => console.error("[tts] Enhance credit deduction error:", err));
        }
      }
    } catch (err) {
      console.error("[tts] Audio tag enhancement failed:", err);
    }
  }

  const streamId = randomUUID();
  pendingJobs.set(streamId, {
    text: ttsText,
    originalText,
    voiceId: voice,
    model,
    userId: user.id,
    projectId,
    lineOffset,
    cacheFile: cachePath,
    v2Settings,
    createdAt: Date.now(),
  });

  return c.json({
    cached: false,
    streamId,
    lineOffset,
  });
});

// Stream audio (auth middleware accepts ?token= query param for audio elements)
ttsRouter.get("/tts/:projectId/stream/:streamId", authMiddleware, async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const streamId = c.req.param("streamId");
  const job = pendingJobs.get(streamId);
  if (!job || job.userId !== user.id) {
    return c.json({ error: "Stream not found or expired" }, 404);
  }
  pendingJobs.delete(streamId);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${job.voiceId}/stream`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: JSON.stringify(buildElevenLabsBody(job)),
  });

  if (!resp.ok || !resp.body) {
    const err = await resp.text().catch(() => "Unknown error");
    console.error("[tts] ElevenLabs error:", resp.status, err);
    return c.json({ error: "TTS generation failed" }, 502);
  }

  // Pipe ElevenLabs stream to client, buffer chunks for disk cache + Whisper
  const chunks: Uint8Array[] = [];
  const reader = resp.body.getReader();

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          // Background: save to disk + Whisper transcription
          const fullBuffer = Buffer.concat(chunks);
          fs.writeFile(job.cacheFile, fullBuffer).catch((err) => {
            console.error("[tts] Cache write error:", err);
          });
          transcribeWithWhisper(fullBuffer)
            .then((segments) => {
              const timestamps = mapSegmentsToLines(job.originalText, segments).map((t) => ({
                ...t,
                line: t.line + (job.lineOffset - 1),
              }));
              completedTimestamps.set(streamId, {
                timestamps,
                lineOffset: job.lineOffset,
                createdAt: Date.now(),
              });
              // Cache timestamps to disk
              const tsPath = job.cacheFile.replace(/\.mp3$/, ".ts.json");
              fs.writeFile(tsPath, JSON.stringify(timestamps), "utf-8").catch(() => {});

              // Deduct credits for Whisper transcription
              // Estimate duration: ~16kbps MP3 ≈ 2000 bytes/sec
              if (segments.length > 0) {
                const lastSeg = segments[segments.length - 1];
                const durationSec = lastSeg?.end ?? fullBuffer.length / 2000;
                const whisperCost = calculateWhisperCost(durationSec);
                if (whisperCost > 0) {
                  deductCredits({
                    userId: job.userId,
                    amount: whisperCost,
                    service: "whisper",
                    projectId: job.projectId,
                    metadata: { durationSec },
                  }).catch((err) => console.error("[tts] Whisper credit deduction error:", err));
                }
              }
            })
            .catch((err) => {
              console.error("[tts] Whisper background error:", err);
            });
          return;
        }
        chunks.push(new Uint8Array(value));
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    },
  });
});

// Poll for timestamps after streaming completes
ttsRouter.get("/tts/:projectId/timestamps/:streamId", authMiddleware, async (c) => {
  const streamId = c.req.param("streamId");
  const data = completedTimestamps.get(streamId);
  if (!data) return c.json({ ready: false });
  completedTimestamps.delete(streamId);
  return c.json({ ready: true, timestamps: data.timestamps, lineOffset: data.lineOffset });
});

// List cached audio files for a project
ttsRouter.get("/tts/:projectId/library", authMiddleware, async (c) => {
  const user = getUser(c);
  const projectId = c.req.param("projectId");

  const membership = await getProjectMembership(projectId, user.id);
  if (!membership) return c.json({ error: "Access denied" }, 403);

  const dir = ttsDir(projectId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".mp3"))
        .map(async (e) => {
          const stat = await fs.stat(join(dir, e.name));
          return { name: e.name, size: stat.size, createdAt: stat.birthtime.toISOString() };
        })
    );
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ files });
  } catch {
    return c.json({ files: [] });
  }
});
