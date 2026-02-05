import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import { join, dirname } from "path";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import { PROJECTS_DIR, safePath, listTree } from "./files.js";
import { broadcast, sendTo } from "./ws.js";

const anthropic = new Anthropic();

const MAX_MESSAGES_PER_SESSION = 200;

interface ChatMessage {
  role: "user" | "assistant";
  content: string | any[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// Chat directory for a project
function chatDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId, ".perchpad", "chats");
}

function sessionPath(projectId: string, sessionId: string): string {
  return join(chatDir(projectId), `${sessionId}.json`);
}

// Session CRUD
export async function listSessions(
  projectId: string
): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
  const dir = chatDir(projectId);
  try {
    const files = await fs.readdir(dir);
    const sessions: Array<{ id: string; title: string; updatedAt: string }> =
      [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(join(dir, file), "utf-8");
        const session: ChatSession = JSON.parse(raw);
        sessions.push({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
        });
      } catch {
        // Skip malformed files
      }
    }
    return sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch {
    return [];
  }
}

export async function getSession(
  projectId: string,
  sessionId: string
): Promise<ChatSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(projectId, sessionId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function createSession(projectId: string): Promise<ChatSession> {
  const session: ChatSession = {
    id: uuidv4(),
    title: "New conversation",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(chatDir(projectId), { recursive: true });
  await fs.writeFile(
    sessionPath(projectId, session.id),
    JSON.stringify(session, null, 2)
  );
  return session;
}

export async function deleteSession(
  projectId: string,
  sessionId: string
): Promise<void> {
  try {
    await fs.unlink(sessionPath(projectId, sessionId));
  } catch {
    // Already gone
  }
}

async function saveSession(projectId: string, session: ChatSession) {
  await fs.writeFile(
    sessionPath(projectId, session.id),
    JSON.stringify(session, null, 2)
  );
}

// Tool definitions for the AI
const tools: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file in the workspace. Use this to understand what the user has written.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace specific text in a file. Provide the exact old text to find and the new text to replace it with.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        old_text: {
          type: "string",
          description: "The exact text to find and replace",
        },
        new_text: {
          type: "string",
          description: "The new text to replace it with",
        },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given content.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path for the new file relative to the project root",
        },
        content: {
          type: "string",
          description: "Content of the new file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List all files and folders in the workspace.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// Execute a tool call
async function executeTool(
  projectId: string,
  toolName: string,
  input: any
): Promise<string> {
  const dir = join(PROJECTS_DIR, projectId);

  switch (toolName) {
    case "read_file": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        return content;
      } catch {
        return `Error: Could not read file "${input.path}"`;
      }
    }

    case "edit_file": {
      try {
        const resolved = safePath(projectId, input.path);
        let content = await fs.readFile(resolved, "utf-8");
        if (!content.includes(input.old_text)) {
          return `Error: Could not find the specified text in "${input.path}"`;
        }
        content = content.replace(input.old_text, input.new_text);
        await fs.writeFile(resolved, content, "utf-8");
        return `Successfully edited "${input.path}"`;
      } catch {
        return `Error: Could not edit file "${input.path}"`;
      }
    }

    case "create_file": {
      try {
        const resolved = safePath(projectId, input.path);
        await fs.mkdir(dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, input.content, "utf-8");
        return `Successfully created "${input.path}"`;
      } catch {
        return `Error: Could not create file "${input.path}"`;
      }
    }

    case "list_files": {
      try {
        const tree = await listTree(dir, dir);
        return JSON.stringify(tree, null, 2);
      } catch {
        return "Error: Could not list files";
      }
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Handle chat message from WebSocket
export async function handleChatMessage(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { type: string; sessionId: string; message: string }
) {
  let session = await getSession(projectId, msg.sessionId);
  if (!session) {
    session = await createSession(projectId);
    session.id = msg.sessionId; // Use client-provided ID
    await saveSession(projectId, session);
  }

  // Add user message
  session.messages.push({ role: "user", content: msg.message });

  // Trim to max messages
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
  }

  // Generate title from first message if it's the default
  if (session.title === "New conversation" && session.messages.length === 1) {
    session.title =
      msg.message.length > 50
        ? msg.message.slice(0, 50) + "..."
        : msg.message;
  }

  // Call Anthropic with tools in a loop
  try {
    let messages: Anthropic.MessageParam[] = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let continueLoop = true;
    while (continueLoop) {
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        system:
          "You are a friendly writing assistant in Perchpad, a collaborative markdown workspace. Help users with their writing — editing, brainstorming, outlining, proofreading, and more. You can read and edit their files using the provided tools. Be warm, helpful, and concise. When making edits, explain what you changed and why. Never use technical jargon — speak in plain, friendly language.",
        tools,
        messages,
      });

      let fullContent: any[] = [];
      let currentText = "";

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          currentText += event.delta.text;
          sendTo(ws, {
            type: "chat:delta",
            sessionId: session.id,
            text: event.delta.text,
          });
        }
      }

      const finalMessage = await stream.finalMessage();

      // Process the response
      continueLoop = false;
      const toolResults: Anthropic.MessageParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type === "text") {
          fullContent.push(block);
        } else if (block.type === "tool_use") {
          fullContent.push(block);
          // Execute tool
          sendTo(ws, {
            type: "chat:tool_use",
            sessionId: session.id,
            tool: block.name,
            input: block.input,
          });

          const result = await executeTool(
            projectId,
            block.name,
            block.input
          );

          // Broadcast file change if a file was modified
          if (
            block.name === "edit_file" ||
            block.name === "create_file"
          ) {
            broadcast(projectId, {
              type: "file:changed",
              path: (block.input as any).path,
            });
          }

          toolResults.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              },
            ],
          });
        }
      }

      // Add assistant response to messages
      session.messages.push({ role: "assistant", content: fullContent });

      if (toolResults.length > 0) {
        // Add tool results and continue the loop
        messages = [
          ...messages.slice(0, -0 || messages.length),
          ...session.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          ...toolResults,
        ];
        // Also add to session messages
        for (const tr of toolResults) {
          session.messages.push({ role: "user", content: tr.content as any });
        }
        continueLoop = true;
      }
    }

    // Save session
    session.updatedAt = new Date().toISOString();
    await saveSession(projectId, session);

    sendTo(ws, {
      type: "chat:done",
      sessionId: session.id,
      title: session.title,
    });
  } catch (err: any) {
    console.error("[chat] Error:", err);
    sendTo(ws, {
      type: "chat:error",
      sessionId: session.id,
      error: err.message || "Something went wrong",
    });
    // Still save session with whatever we have
    session.updatedAt = new Date().toISOString();
    await saveSession(projectId, session);
  }
}
