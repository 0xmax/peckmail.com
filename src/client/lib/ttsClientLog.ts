import { supabase } from "./supabase.js";

interface TtsClientErrorShape {
  name?: string;
  message: string;
  stack?: string;
}

export type TtsClientLogLevel = "debug" | "info" | "warn" | "error";

export interface TtsClientLogPayload {
  scope: string;
  message: string;
  level?: TtsClientLogLevel;
  projectId?: string;
  token?: string;
  error?: unknown;
  meta?: Record<string, unknown>;
}

const MAX_TEXT = 4000;
const MAX_SCOPE = 160;
const MAX_STACK = 12000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function normalizeError(error: unknown): TtsClientErrorShape | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(error.message || "Unknown error", MAX_TEXT),
      stack: error.stack ? truncate(error.stack, MAX_STACK) : undefined,
    };
  }

  if (typeof error === "string") {
    return { message: truncate(error, MAX_TEXT) };
  }

  try {
    return { message: truncate(JSON.stringify(error), MAX_TEXT) };
  } catch {
    return { message: "Unserializable client error" };
  }
}

export async function pipeTtsErrorToServer(payload: TtsClientLogPayload): Promise<void> {
  const level: TtsClientLogLevel =
    payload.level ||
    (payload.error ? "error" : "info");
  const body = {
    scope: truncate(payload.scope || "tts.client", MAX_SCOPE),
    message: truncate(payload.message || "Client TTS error", MAX_TEXT),
    level,
    projectId: payload.projectId,
    meta: payload.meta || {},
    error: normalizeError(payload.error),
  };

  try {
    const token =
      payload.token ||
      (await supabase.auth.getSession()).data.session?.access_token ||
      "";
    if (!token) return;

    await fetch("/api/tts/client-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      keepalive: true,
      body: JSON.stringify(body),
    });
  } catch {
    // Never throw while logging an error path.
  }
}
