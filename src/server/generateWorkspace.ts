import Anthropic from "@anthropic-ai/sdk";
import { placeHold, settleHold, releaseHold, calculateChatCost } from "./credits.js";
import type { TemplateFile } from "./templates.js";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a workspace generator for a markdown writing app called Peckmail. Given a user's description of what they want to use their workspace for, generate a set of files and folders that would give them a great starting point.

Rules:
- Return ONLY a JSON array of objects with "path" and "content" fields
- Paths should use forward slashes and no leading slash (e.g., "notes/intro.md")
- All files should be markdown (.md) except for .gitkeep files in empty folders
- Create 4-8 files plus folder .gitkeep files
- Always include an AGENTS.md file at the root that instructs the email agent how to handle incoming emails for this type of workspace
- Always include an inbox/ folder with a .gitkeep
- Use descriptive filenames in kebab-case
- Fill files with helpful starter content, templates, and examples relevant to the user's description
- Be creative but practical — give them something they can immediately start using
- Do NOT wrap the JSON in markdown code fences — return the raw JSON array only`;

export async function generateWorkspaceFiles(
  prompt: string,
  userId: string
): Promise<TemplateFile[]> {
  // Place a credit hold
  const hold = await placeHold({
    userId,
    amount: 200,
    service: "workspace_ai",
    metadata: { prompt: prompt.slice(0, 100) },
  });

  if (!hold.success || !hold.holdId) {
    throw new Error("Insufficient credits to generate workspace");
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Create a workspace for: ${prompt}`,
        },
      ],
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from AI");
    }

    // Calculate and settle credits
    const cost = calculateChatCost({
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
    });
    await settleHold(hold.holdId, cost, {
      service: "workspace_ai",
      prompt: prompt.slice(0, 100),
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    // Parse JSON from response — find first [ to last ]
    const raw = textBlock.text;
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response did not contain valid JSON array");
    }

    const json = raw.slice(start, end + 1);
    const files: any[] = JSON.parse(json);

    // Validate
    const validated: TemplateFile[] = [];
    for (const file of files) {
      if (
        typeof file.path !== "string" ||
        typeof file.content !== "string" ||
        file.path.includes("..") ||
        file.path.startsWith("/")
      ) {
        continue;
      }
      validated.push({ path: file.path, content: file.content });
    }

    if (validated.length === 0) {
      throw new Error("AI generated no valid files");
    }

    return validated;
  } catch (err) {
    // Release hold on error (only if we haven't already settled)
    if (hold.holdId && !(err as any)?._settled) {
      await releaseHold(hold.holdId);
    }
    throw err;
  }
}
