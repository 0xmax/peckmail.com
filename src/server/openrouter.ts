/**
 * Thin OpenRouter client using their OpenAI-compatible API.
 * Used for email processing (summarization, tagging, extraction) with Gemini Flash.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
export const GEMINI_FLASH_MODEL = "google/gemini-3-flash-preview";

const apiKey = process.env.OPENROUTER_API_KEY;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenRouterResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function openrouterChat(opts: {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}): Promise<string> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://peckmail.com",
      "X-Title": "Peckmail",
    },
    body: JSON.stringify({
      model: opts.model ?? GEMINI_FLASH_MODEL,
      messages: opts.messages,
      max_tokens: opts.max_tokens ?? 32768,
      temperature: opts.temperature ?? 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

export function isOpenRouterConfigured(): boolean {
  return !!apiKey;
}
