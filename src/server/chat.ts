import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import { join, relative, basename } from "path";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import { PROJECTS_DIR, safePath } from "./files.js";
import { broadcast, sendTo } from "./ws.js";
import * as fileOps from "./fileOps.js";
import {
  getProjectMemberEmails,
  getProjectMembers,
  getProjectEmail,
  getProjectMembership,
  createInvitation,
  searchProjectIncomingEmails,
  getProjectIncomingEmail,
  supabaseAdmin,
} from "./db.js";
import { sendEmail, sendInvitationEmail } from "./email.js";
import { placeHold, settleHold, releaseHold, calculateOpusCost } from "./credits.js";

const anthropic = new Anthropic();

const MAX_MESSAGES_PER_SESSION = 200;
const CHAT_DIR = ".peckmail";
const LEGACY_CHAT_DIR = ".perchpad";
const EMAIL_SEARCH_STATUSES = new Set([
  "received",
  "processing",
  "processed",
  "failed",
]);
const FILESYSTEM_TOOL_NAMES = new Set([
  "read_file",
  "edit_file",
  "create_file",
  "list_files",
  "open_file",
  "highlight",
  "grep",
  "find",
  "head",
  "tail",
  "wc",
  "sort_lines",
  "sed",
  "uniq",
  "diff",
  "append",
  "slice",
  "delete_lines",
  "outline",
  "move_file",
  "copy_file",
  "delete_file",
]);
const INTERACTIVE_CHAT_TOOL_NAMES = new Set([
  "search_emails",
  "get_email",
  "send_email",
  "get_workspace_info",
  "invite_member",
  "web_search",
  "fetch_page",
]);

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
function primaryChatDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId, CHAT_DIR, "chats");
}

function legacyChatDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId, LEGACY_CHAT_DIR, "chats");
}

function sessionPath(chatDirectory: string, sessionId: string): string {
  return join(chatDirectory, `${sessionId}.json`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveReadableChatDir(projectId: string): Promise<string> {
  const primary = primaryChatDir(projectId);
  if (await exists(primary)) return primary;

  const legacy = legacyChatDir(projectId);
  if (await exists(legacy)) return legacy;

  return primary;
}

// Session CRUD
export async function listSessions(
  projectId: string
): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
  const dir = await resolveReadableChatDir(projectId);
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
  const paths = [
    sessionPath(primaryChatDir(projectId), sessionId),
    sessionPath(legacyChatDir(projectId), sessionId),
  ];
  for (const path of paths) {
    try {
      const raw = await fs.readFile(path, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Try next location
    }
  }
  return null;
}

export async function createSession(projectId: string): Promise<ChatSession> {
  const session: ChatSession = {
    id: uuidv4(),
    title: "New conversation",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const dir = primaryChatDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    sessionPath(dir, session.id),
    JSON.stringify(session, null, 2)
  );
  return session;
}

export async function deleteSession(
  projectId: string,
  sessionId: string
): Promise<void> {
  const paths = [
    sessionPath(primaryChatDir(projectId), sessionId),
    sessionPath(legacyChatDir(projectId), sessionId),
  ];
  for (const path of paths) {
    try {
      await fs.unlink(path);
      return;
    } catch {
      // Try next location
    }
  }
}

async function saveSession(projectId: string, session: ChatSession) {
  const dir = primaryChatDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    sessionPath(dir, session.id),
    JSON.stringify(session, null, 2)
  );
}

function clampEmailContentChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 12000;
  return Math.min(Math.max(Math.floor(value), 1000), 50000);
}

function truncateEmailField(
  value: string | null | undefined,
  maxChars: number
): { value: string | null; truncated: boolean } {
  if (!value) return { value: null, truncated: false };
  if (value.length <= maxChars) return { value, truncated: false };
  return {
    value: `${value.slice(0, maxChars)}\n\n...[truncated]`,
    truncated: true,
  };
}

function getInteractiveChatTools(): Anthropic.Tool[] {
  return tools.filter((tool) => INTERACTIVE_CHAT_TOOL_NAMES.has(tool.name));
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
  {
    name: "open_file",
    description:
      "Open a file in the user's editor. Use this to navigate the user to a file you are working on — for example after creating a new file, or before making edits so the user can see the changes happen in real time.",
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
    name: "highlight",
    description:
      "Highlight a range of text in the user's editor to draw their attention to it. Use this when referring to specific lines or passages.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file (must be the currently open file)",
        },
        from_line: {
          type: "number",
          description: "Starting line number (1-based)",
        },
        to_line: {
          type: "number",
          description: "Ending line number (1-based, inclusive)",
        },
      },
      required: ["path", "from_line", "to_line"],
    },
  },
  {
    name: "grep",
    description:
      "Search for a pattern across files in the workspace. Returns matching lines with file paths and line numbers. Supports regular expressions.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description:
            "Optional file or directory path to search in (relative to project root). Defaults to entire project.",
        },
        case_insensitive: {
          type: "boolean",
          description: "Whether to ignore case. Defaults to false.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "find",
    description:
      "Find files by name pattern (glob-style). Returns a list of matching file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob-style pattern to match file names (e.g. '*.md', 'chapter-*', '*.txt')",
        },
        path: {
          type: "string",
          description:
            "Directory to search in (relative to project root). Defaults to project root.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "head",
    description:
      "Show the first N lines of a file. Useful for previewing file contents.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        lines: {
          type: "number",
          description: "Number of lines to show. Defaults to 10.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "tail",
    description:
      "Show the last N lines of a file. Useful for checking the end of a file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        lines: {
          type: "number",
          description: "Number of lines to show. Defaults to 10.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "wc",
    description:
      "Count lines, words, and characters in a file or in given text.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file relative to the project root. If omitted, counts the provided text instead.",
        },
        text: {
          type: "string",
          description: "Text to count (used when path is not provided).",
        },
      },
      required: [],
    },
  },
  {
    name: "sort_lines",
    description:
      "Sort lines in a file or text alphabetically. Can sort in reverse or remove duplicates.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file relative to the project root. If omitted, sorts the provided text.",
        },
        text: {
          type: "string",
          description: "Text to sort (used when path is not provided).",
        },
        reverse: {
          type: "boolean",
          description: "Sort in reverse order. Defaults to false.",
        },
        unique: {
          type: "boolean",
          description: "Remove duplicate lines. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "sed",
    description:
      "Find and replace using a regex pattern across a file. Like sed 's/pattern/replacement/g'. Can replace all occurrences or just the first in each line.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        pattern: {
          type: "string",
          description: "Regex pattern to find",
        },
        replacement: {
          type: "string",
          description:
            "Replacement string. Supports $1, $2 etc. for capture groups.",
        },
        global: {
          type: "boolean",
          description:
            "Replace all occurrences per line (true) or just the first (false). Defaults to true.",
        },
      },
      required: ["path", "pattern", "replacement"],
    },
  },
  {
    name: "uniq",
    description:
      "Remove or count duplicate adjacent lines in a file, like the Unix uniq command.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        count: {
          type: "boolean",
          description:
            "Prefix each line with the number of occurrences. Defaults to false.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "diff",
    description:
      "Show a simple diff between two files, line by line.",
    input_schema: {
      type: "object" as const,
      properties: {
        path_a: {
          type: "string",
          description: "Path to the first file",
        },
        path_b: {
          type: "string",
          description: "Path to the second file",
        },
      },
      required: ["path_a", "path_b"],
    },
  },
  {
    name: "append",
    description:
      "Append text to the end of a file. Creates the file if it doesn't exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        text: {
          type: "string",
          description: "Text to append",
        },
      },
      required: ["path", "text"],
    },
  },
  {
    name: "slice",
    description:
      "Extract a range of lines from a file. Returns lines with line numbers. Useful for reading a specific section without loading the entire file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        from: {
          type: "number",
          description: "Starting line number (1-based, inclusive)",
        },
        to: {
          type: "number",
          description: "Ending line number (1-based, inclusive)",
        },
      },
      required: ["path", "from", "to"],
    },
  },
  {
    name: "delete_lines",
    description:
      "Delete a range of lines from a file. The file is modified in place.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        from: {
          type: "number",
          description: "Starting line number to delete (1-based, inclusive)",
        },
        to: {
          type: "number",
          description: "Ending line number to delete (1-based, inclusive)",
        },
      },
      required: ["path", "from", "to"],
    },
  },
  {
    name: "outline",
    description:
      "Extract the markdown heading structure from a file. Returns headings with their line numbers and nesting level. Great for understanding document structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to a markdown file relative to the project root",
        },
      },
      required: ["path"],
    },
    cache_control: { type: "ephemeral" },
  },
  {
    name: "move_file",
    description:
      "Move or rename a file or directory. Parent directories of the destination are created automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Current path relative to the project root",
        },
        to: {
          type: "string",
          description: "New path relative to the project root",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "copy_file",
    description:
      "Copy a file to a new location. Parent directories of the destination are created automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description: "Source file path relative to the project root",
        },
        to: {
          type: "string",
          description: "Destination file path relative to the project root",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file or directory. Directories are deleted recursively.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file or directory relative to the project root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_emails",
    description:
      "Search inbound workspace emails by sender, recipient, subject, or content. Returns matching emails with IDs and snippets.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "General search text matched across sender, recipient, subject, and body",
        },
        from: {
          type: "string",
          description: "Filter sender email/name fragment",
        },
        to: {
          type: "string",
          description: "Filter recipient email fragment",
        },
        subject: {
          type: "string",
          description: "Filter subject text",
        },
        status: {
          type: "string",
          enum: ["received", "processing", "processed", "failed"],
          description: "Optional processing status filter",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (1-50, default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_email",
    description:
      "Fetch a single inbound workspace email by ID, including body text/html and optional raw MIME content.",
    input_schema: {
      type: "object" as const,
      properties: {
        email_id: {
          type: "string",
          description: "ID of the email to fetch (use search_emails first if needed)",
        },
        include_raw: {
          type: "boolean",
          description: "Whether to include raw MIME source. Defaults to false.",
        },
        max_chars: {
          type: "number",
          description: "Maximum characters for body/raw fields (1000-50000, default 12000)",
        },
      },
      required: ["email_id"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email to a workspace member. Can only send to email addresses of people who are members of this workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address (must be a workspace member)",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body in plain text",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "get_workspace_info",
    description:
      "Get information about the current workspace including its name, email address, and list of members with their names and emails.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "invite_member",
    description:
      "Invite someone to join this workspace by email. They will receive an invitation email with a link to accept. You can specify their role (editor by default).",
    input_schema: {
      type: "object" as const,
      properties: {
        email: {
          type: "string",
          description: "Email address of the person to invite",
        },
        role: {
          type: "string",
          enum: ["editor", "viewer"],
          description: "Role to assign. Defaults to editor.",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for information. Returns a list of results with titles, URLs, and short snippets. Use this to look up facts, find references, or research topics for the user's writing.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (1-10). Defaults to 5.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description:
      "Fetch and read the contents of a web page. Returns the page as clean markdown text. Use this to read articles, documentation, or other web content that might be useful for the user's writing.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL of the page to fetch",
        },
      },
      required: ["url"],
    },
  },
] as Anthropic.Tool[];

// Recursively collect all file paths under a directory (excluding hidden dirs)
async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

// Simple glob match (supports * and ?)
function globMatch(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i").test(name);
}

// Execute a tool call
async function executeTool(
  projectId: string,
  toolName: string,
  input: any,
  ws: WebSocket,
  userId?: string,
  opts?: { allowFilesystemTools?: boolean }
): Promise<string> {
  const dir = join(PROJECTS_DIR, projectId);
  const allowFilesystemTools = opts?.allowFilesystemTools !== false;
  if (!allowFilesystemTools && FILESYSTEM_TOOL_NAMES.has(toolName)) {
    return `Error: Tool "${toolName}" is disabled in this chat mode.`;
  }

  switch (toolName) {
    case "read_file": {
      try {
        return await fileOps.readFile(projectId, input.path);
      } catch {
        return `Error: Could not read file "${input.path}"`;
      }
    }

    case "edit_file": {
      try {
        await fileOps.editFile(projectId, input.path, input.old_text, input.new_text);
        return `Successfully edited "${input.path}"`;
      } catch (err: any) {
        if (err?.message?.includes("Could not find")) return `Error: ${err.message}`;
        return `Error: Could not edit file "${input.path}"`;
      }
    }

    case "create_file": {
      try {
        await fileOps.writeFile(projectId, input.path, input.content);
        return `Successfully created "${input.path}"`;
      } catch {
        return `Error: Could not create file "${input.path}"`;
      }
    }

    case "list_files": {
      try {
        const tree = await fileOps.listFiles(projectId);
        return JSON.stringify(tree, null, 2);
      } catch {
        return "Error: Could not list files";
      }
    }

    case "open_file": {
      sendTo(ws, {
        type: "editor:open_file",
        path: input.path,
      });
      return `Opened "${input.path}" in the editor.`;
    }

    case "highlight": {
      // Send highlight command to the client's editor
      sendTo(ws, {
        type: "editor:highlight",
        path: input.path,
        fromLine: input.from_line,
        toLine: input.to_line,
      });
      return `Highlighted lines ${input.from_line}-${input.to_line} in "${input.path}"`;
    }

    case "grep": {
      try {
        const searchDir = input.path ? safePath(projectId, input.path) : dir;
        const stat = await fs.stat(searchDir);
        const files = stat.isDirectory()
          ? await walkFiles(searchDir)
          : [searchDir];

        const flags = input.case_insensitive ? "i" : "";
        const regex = new RegExp(input.pattern, flags);
        const matches: string[] = [];

        for (const file of files) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const lines = content.split("\n");
            const relPath = relative(dir, file);
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push(`${relPath}:${i + 1}: ${lines[i]}`);
                if (matches.length >= 200) break;
              }
            }
          } catch {
            // Skip binary/unreadable files
          }
          if (matches.length >= 200) break;
        }

        if (matches.length === 0) return "No matches found.";
        const suffix = matches.length >= 200 ? "\n... (truncated at 200 matches)" : "";
        return matches.join("\n") + suffix;
      } catch {
        return `Error: Could not search "${input.path || "."}"`;
      }
    }

    case "find": {
      try {
        const searchDir = input.path ? safePath(projectId, input.path) : dir;
        const allFiles = await walkFiles(searchDir);
        const matched = allFiles
          .filter((f) => globMatch(basename(f), input.pattern))
          .map((f) => relative(dir, f));

        if (matched.length === 0) return "No files found.";
        return matched.slice(0, 200).join("\n") +
          (matched.length > 200 ? `\n... (${matched.length} total)` : "");
      } catch {
        return `Error: Could not search "${input.path || "."}"`;
      }
    }

    case "head": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const n = input.lines || 10;
        const lines = content.split("\n").slice(0, n);
        return lines.map((l: string, i: number) => `${i + 1}: ${l}`).join("\n");
      } catch {
        return `Error: Could not read file "${input.path}"`;
      }
    }

    case "tail": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const allLines = content.split("\n");
        const n = input.lines || 10;
        const start = Math.max(0, allLines.length - n);
        const lines = allLines.slice(start);
        return lines.map((l: string, i: number) => `${start + i + 1}: ${l}`).join("\n");
      } catch {
        return `Error: Could not read file "${input.path}"`;
      }
    }

    case "wc": {
      try {
        let content: string;
        if (input.path) {
          const resolved = safePath(projectId, input.path);
          content = await fs.readFile(resolved, "utf-8");
        } else if (input.text) {
          content = input.text;
        } else {
          return "Error: Provide either a path or text.";
        }
        const lines = content.split("\n").length;
        const words = content.split(/\s+/).filter(Boolean).length;
        const chars = content.length;
        return `Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}`;
      } catch {
        return `Error: Could not read "${input.path}"`;
      }
    }

    case "sort_lines": {
      try {
        let content: string;
        if (input.path) {
          const resolved = safePath(projectId, input.path);
          content = await fs.readFile(resolved, "utf-8");
        } else if (input.text) {
          content = input.text;
        } else {
          return "Error: Provide either a path or text.";
        }
        let lines = content.split("\n");
        lines.sort((a, b) => a.localeCompare(b));
        if (input.reverse) lines.reverse();
        if (input.unique) lines = [...new Set(lines)];
        return lines.join("\n");
      } catch {
        return `Error: Could not read "${input.path}"`;
      }
    }

    case "sed": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const flags = input.global !== false ? "g" : "";
        const regex = new RegExp(input.pattern, flags);
        const lines = content.split("\n");
        let changeCount = 0;
        const newLines = lines.map((line) => {
          const replaced = line.replace(regex, input.replacement);
          if (replaced !== line) changeCount++;
          return replaced;
        });
        const newContent = newLines.join("\n");
        await fs.writeFile(resolved, newContent, "utf-8");
        await fileOps.notifyFileUpdated(projectId, input.path);
        return `Replaced ${changeCount} line(s) in "${input.path}"`;
      } catch (err: any) {
        if (err?.message === "Path traversal detected") {
          return "Error: Invalid path";
        }
        return `Error: Could not process "${input.path}"`;
      }
    }

    case "uniq": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const lines = content.split("\n");

        if (input.count) {
          const result: string[] = [];
          let i = 0;
          while (i < lines.length) {
            let count = 1;
            while (i + count < lines.length && lines[i + count] === lines[i]) count++;
            result.push(`${count} ${lines[i]}`);
            i += count;
          }
          return result.join("\n");
        } else {
          const result: string[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (i === 0 || lines[i] !== lines[i - 1]) result.push(lines[i]);
          }
          return result.join("\n");
        }
      } catch {
        return `Error: Could not read "${input.path}"`;
      }
    }

    case "diff": {
      try {
        const resolvedA = safePath(projectId, input.path_a);
        const resolvedB = safePath(projectId, input.path_b);
        const contentA = await fs.readFile(resolvedA, "utf-8");
        const contentB = await fs.readFile(resolvedB, "utf-8");
        const linesA = contentA.split("\n");
        const linesB = contentB.split("\n");
        const result: string[] = [];
        const maxLen = Math.max(linesA.length, linesB.length);

        for (let i = 0; i < maxLen; i++) {
          const a = linesA[i];
          const b = linesB[i];
          if (a === undefined) {
            result.push(`+ ${i + 1}: ${b}`);
          } else if (b === undefined) {
            result.push(`- ${i + 1}: ${a}`);
          } else if (a !== b) {
            result.push(`- ${i + 1}: ${a}`);
            result.push(`+ ${i + 1}: ${b}`);
          }
        }

        if (result.length === 0) return "Files are identical.";
        return result.join("\n");
      } catch {
        return `Error: Could not diff files`;
      }
    }

    case "append": {
      try {
        await fileOps.appendFile(projectId, input.path, input.text);
        return `Appended to "${input.path}"`;
      } catch {
        return `Error: Could not append to "${input.path}"`;
      }
    }

    case "slice": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const allLines = content.split("\n");
        const from = Math.max(1, input.from);
        const to = Math.min(allLines.length, input.to);
        const sliced = allLines.slice(from - 1, to);
        return sliced.map((l: string, i: number) => `${from + i}: ${l}`).join("\n");
      } catch {
        return `Error: Could not read "${input.path}"`;
      }
    }

    case "delete_lines": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const allLines = content.split("\n");
        const from = Math.max(1, input.from);
        const to = Math.min(allLines.length, input.to);
        const deleted = to - from + 1;
        allLines.splice(from - 1, deleted);
        await fs.writeFile(resolved, allLines.join("\n"), "utf-8");
        await fileOps.notifyFileUpdated(projectId, input.path);
        return `Deleted lines ${from}-${to} (${deleted} lines) from "${input.path}"`;
      } catch {
        return `Error: Could not edit "${input.path}"`;
      }
    }

    case "outline": {
      try {
        const resolved = safePath(projectId, input.path);
        const content = await fs.readFile(resolved, "utf-8");
        const lines = content.split("\n");
        const headings: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/^(#{1,6})\s+(.+)/);
          if (match) {
            const level = match[1].length;
            const indent = "  ".repeat(level - 1);
            headings.push(`${indent}${match[1]} ${match[2]}  (line ${i + 1})`);
          }
        }
        if (headings.length === 0) return "No headings found.";
        return headings.join("\n");
      } catch {
        return `Error: Could not read "${input.path}"`;
      }
    }

    case "move_file": {
      try {
        await fileOps.moveFile(projectId, input.from, input.to);
        return `Moved "${input.from}" → "${input.to}"`;
      } catch {
        return `Error: Could not move "${input.from}" to "${input.to}"`;
      }
    }

    case "copy_file": {
      try {
        await fileOps.copyFile(projectId, input.from, input.to);
        return `Copied "${input.from}" → "${input.to}"`;
      } catch {
        return `Error: Could not copy "${input.from}" to "${input.to}"`;
      }
    }

    case "delete_file": {
      try {
        await fileOps.deleteFile(projectId, input.path);
        return `Deleted "${input.path}"`;
      } catch {
        return `Error: Could not delete "${input.path}"`;
      }
    }

    case "search_emails": {
      try {
        if (!userId) return "Error: Email search requires a logged-in user.";
        const membership = await getProjectMembership(projectId, userId);
        if (!membership) return "Error: Access denied.";

        const status = typeof input.status === "string" && EMAIL_SEARCH_STATUSES.has(input.status)
          ? input.status as "received" | "processing" | "processed" | "failed"
          : undefined;

        const emails = await searchProjectIncomingEmails({
          projectId,
          query: typeof input.query === "string" ? input.query : undefined,
          from: typeof input.from === "string" ? input.from : undefined,
          to: typeof input.to === "string" ? input.to : undefined,
          subject: typeof input.subject === "string" ? input.subject : undefined,
          status,
          limit: typeof input.limit === "number" ? input.limit : undefined,
        });

        if (emails.length === 0) return "No matching emails found.";
        return JSON.stringify({ count: emails.length, emails }, null, 2);
      } catch (err: any) {
        return `Error: Could not search emails — ${err.message || "unknown error"}`;
      }
    }

    case "get_email": {
      try {
        if (!userId) return "Error: Email fetching requires a logged-in user.";
        const membership = await getProjectMembership(projectId, userId);
        if (!membership) return "Error: Access denied.";

        const emailId = typeof input.email_id === "string" ? input.email_id.trim() : "";
        if (!emailId) return "Error: email_id is required.";

        const record = await getProjectIncomingEmail(projectId, emailId);
        if (!record) return `No email found with id "${emailId}".`;

        const includeRaw = input.include_raw === true;
        const maxChars = clampEmailContentChars(input.max_chars);
        const bodyText = truncateEmailField(record.body_text, maxChars);
        const bodyHtml = truncateEmailField(record.body_html, maxChars);
        const rawEmail = includeRaw
          ? truncateEmailField(record.raw_email, maxChars)
          : { value: null, truncated: false };

        return JSON.stringify({
          id: record.id,
          resend_email_id: record.resend_email_id,
          from_address: record.from_address,
          from_domain: record.from_domain,
          to_address: record.to_address,
          subject: record.subject,
          status: record.status,
          error: record.error,
          created_at: record.created_at,
          read_at: record.read_at,
          summary: record.summary,
          attachments_count: Array.isArray(record.attachments) ? record.attachments.length : 0,
          body_text: bodyText.value,
          body_html: bodyHtml.value,
          raw_email: rawEmail.value,
          raw_email_included: includeRaw,
          truncated: {
            body_text: bodyText.truncated,
            body_html: bodyHtml.truncated,
            raw_email: rawEmail.truncated,
          },
        }, null, 2);
      } catch (err: any) {
        return `Error: Could not fetch email — ${err.message || "unknown error"}`;
      }
    }

    case "send_email": {
      try {
        const memberEmails = await getProjectMemberEmails(projectId);
        const recipient = input.to.trim().toLowerCase();
        if (!memberEmails.includes(recipient)) {
          return `Error: "${input.to}" is not a member of this workspace. You can only send emails to workspace members.`;
        }
        await sendEmail({ to: recipient, subject: input.subject, body: input.body });
        return `Email sent to ${recipient}`;
      } catch (err: any) {
        return `Error: Could not send email — ${err.message || "unknown error"}`;
      }
    }

    case "get_workspace_info": {
      try {
        const [email, members] = await Promise.all([
          getProjectEmail(projectId),
          getProjectMembers(projectId),
        ]);
        // Look up emails for each member
        const memberDetails = await Promise.all(
          members.map(async (m) => {
            const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
            return {
              name: m.profiles?.display_name || user?.user_metadata?.full_name || null,
              email: user?.email || null,
              role: m.role,
            };
          })
        );
        // Get project name from the projects table
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("name")
          .eq("id", projectId)
          .single();
        return JSON.stringify({
          name: project?.name || "Unknown",
          email: email || "Not assigned",
          members: memberDetails,
        }, null, 2);
      } catch (err: any) {
        return `Error: Could not fetch workspace info — ${err.message || "unknown error"}`;
      }
    }

    case "invite_member": {
      try {
        if (!userId) return "Error: Cannot invite without user context.";
        const email = input.email?.trim().toLowerCase();
        if (!email) return "Error: Email address is required.";
        const role = (input.role === "viewer" ? "viewer" : "editor") as "editor" | "viewer";

        // Check that the requesting user is an owner
        const membership = await getProjectMembership(projectId, userId);
        if (!membership || membership.role !== "owner") {
          return "Error: Only workspace owners can invite new members.";
        }

        // Check for duplicate pending invitation
        const { data: existing } = await supabaseAdmin
          .from("invitations")
          .select("id")
          .eq("project_id", projectId)
          .eq("email", email)
          .eq("status", "pending")
          .maybeSingle();
        if (existing) return `An invitation is already pending for ${email}.`;

        // Check if already a member
        const memberEmails = await getProjectMemberEmails(projectId);
        if (memberEmails.includes(email)) {
          return `${email} is already a member of this workspace.`;
        }

        const invitation = await createInvitation(projectId, email, userId, role);

        // Look up project name + inviter name for the email
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("name")
          .eq("id", projectId)
          .single();
        const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
        const inviterName = authUser?.user_metadata?.display_name
          || authUser?.user_metadata?.full_name
          || authUser?.email
          || "Someone";

        // Send invitation email
        sendInvitationEmail({
          to: email,
          invitationId: invitation.id,
          projectName: project?.name ?? "Untitled",
          inviterName,
        }).catch((err) => console.error("[chat] Failed to send invitation email:", err));

        return `Invitation sent to ${email} as ${role}. They'll receive an email with a link to join.`;
      } catch (err: any) {
        return `Error: Could not send invitation — ${err.message || "unknown error"}`;
      }
    }

    case "web_search": {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) return "Error: Web search is not configured.";
      try {
        const limit = Math.min(Math.max(input.limit || 5, 1), 10);
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query: input.query, limit }),
        });
        if (!res.ok) {
          const text = await res.text();
          return `Error: Search failed (${res.status}): ${text.slice(0, 200)}`;
        }
        const data = await res.json() as {
          data?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
        };
        if (!data.data || data.data.length === 0) return "No results found.";
        return data.data
          .map((r, i) => {
            let entry = `${i + 1}. **${r.title || "Untitled"}**\n   ${r.url || ""}`;
            if (r.description) entry += `\n   ${r.description}`;
            return entry;
          })
          .join("\n\n");
      } catch (err: any) {
        return `Error: Web search failed — ${err.message || "unknown error"}`;
      }
    }

    case "fetch_page": {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) return "Error: Page fetching is not configured.";
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url: input.url,
            formats: ["markdown"],
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          return `Error: Could not fetch page (${res.status}): ${text.slice(0, 200)}`;
        }
        const data = await res.json() as {
          data?: { markdown?: string; title?: string; url?: string };
        };
        const md = data.data?.markdown || "";
        const title = data.data?.title || "";
        if (!md) return "Error: No content could be extracted from the page.";
        const truncated = md.length > 12000 ? md.slice(0, 12000) + "\n\n... (content truncated)" : md;
        return title ? `# ${title}\n\n${truncated}` : truncated;
      } catch (err: any) {
        return `Error: Could not fetch page — ${err.message || "unknown error"}`;
      }
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Non-streaming headless agent runner (for inbound email processing)
export async function runAgentHeadless(
  projectId: string,
  systemPrompt: string,
  userMessage: string,
  opts?: {
    model?: string;
    maxTokens?: number;
    userId?: string;
    allowSendEmail?: boolean;
  }
): Promise<{ sessionId: string; messages: ChatMessage[] }> {
  const session = await createSession(projectId);
  session.messages.push({ role: "user", content: userMessage });

  // No-op WebSocket stub — executeTool only uses ws for the highlight tool,
  // which safely no-ops when readyState !== 1
  const noopWs = { readyState: 0, send() {} } as unknown as WebSocket;

  const model = opts?.model ?? "claude-opus-4-6";
  const maxTokens = opts?.maxTokens ?? 16384;
  let headlessTools = tools;
  if (!opts?.allowSendEmail) {
    headlessTools = headlessTools.filter((tool) => tool.name !== "send_email");
  }
  if (!opts?.userId) {
    headlessTools = headlessTools.filter(
      (tool) => tool.name !== "search_emails" && tool.name !== "get_email"
    );
  }

  // Place credit hold if we have a userId
  let holdId: string | null = null;
  if (opts?.userId) {
    const estimatedCredits = 500; // conservative estimate for headless agent
    const holdResult = await placeHold({
      userId: opts.userId,
      amount: estimatedCredits,
      service: "chat",
      projectId,
    });
    if (!holdResult.success) {
      throw new Error("Insufficient credits");
    }
    holdId = holdResult.holdId;
  }

  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  let messages: Anthropic.MessageParam[] = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    let continueLoop = true;
    while (continueLoop) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: headlessTools,
        messages,
      });

      // Accumulate usage
      totalUsage.input_tokens += response.usage?.input_tokens ?? 0;
      totalUsage.output_tokens += response.usage?.output_tokens ?? 0;
      totalUsage.cache_read_input_tokens += (response.usage as any)?.cache_read_input_tokens ?? 0;

      const fullContent: any[] = [];
      const toolResults: Anthropic.MessageParam[] = [];
      continueLoop = false;

      for (const block of response.content) {
        if (block.type === "text" || block.type === "tool_use") {
          fullContent.push(block);
        }
        if (block.type === "tool_use") {
          const result = await executeTool(
            projectId,
            block.name,
            block.input,
            noopWs,
            opts?.userId,
            { allowFilesystemTools: true }
          );
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

      session.messages.push({ role: "assistant", content: fullContent });

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          session.messages.push({ role: "user", content: tr.content as any });
        }
        messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
        continueLoop = true;
      }
    }

    // Settle hold with actual usage
    if (holdId) {
      const actualCredits = calculateOpusCost(totalUsage);
      await settleHold(holdId, actualCredits, { usage: totalUsage });
    }
  } catch (err) {
    // Release or settle hold on error
    if (holdId) {
      const partialCredits = calculateOpusCost(totalUsage);
      if (partialCredits > 0) {
        await settleHold(holdId, partialCredits, { usage: totalUsage, error: true });
      } else {
        await releaseHold(holdId);
      }
    }
    throw err;
  }

  session.updatedAt = new Date().toISOString();
  session.title = userMessage.length > 50 ? userMessage.slice(0, 50) + "..." : userMessage;
  await saveSession(projectId, session);

  return { sessionId: session.id, messages: session.messages };
}

// Handle chat message from WebSocket
export async function handleChatMessage(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: {
    type: string;
    sessionId: string;
    message: string;
    thinking?: boolean;
    context?: {
      openFilePath: string | null;
      fileContent: string | null;
      cursorPosition: { line: number; col: number } | null;
    };
  }
) {
  const interactiveTools = getInteractiveChatTools();
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

  // Place credit hold before calling Anthropic
  let holdId: string | null = null;
  const estimatedCredits = 300; // conservative estimate for a chat turn
  try {
    const holdResult = await placeHold({
      userId,
      amount: estimatedCredits,
      service: "chat",
      projectId,
    });
    if (!holdResult.success) {
      sendTo(ws, {
        type: "chat:error",
        sessionId: session.id,
        error: "Insufficient credits",
      });
      return;
    }
    holdId = holdResult.holdId;
  } catch (holdErr) {
    console.error("[chat] Hold placement error:", holdErr);
  }

  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  // Call Anthropic with tools in a loop
  try {
    let messages: Anthropic.MessageParam[] = session.messages.map((m, i) => {
      const param: Anthropic.MessageParam = {
        role: m.role,
        content: m.content,
      };
      // Cache the second-to-last message so all prior history is cached
      if (i === session.messages.length - 2 && typeof m.content === "string") {
        param.content = [
          {
            type: "text",
            text: m.content,
            cache_control: { type: "ephemeral" },
          },
        ];
      }
      return param;
    });

    let continueLoop = true;
    while (continueLoop) {
      // Look up user profile for personalization
      const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userId);
      const userName = authUser?.user_metadata?.display_name
        || authUser?.user_metadata?.full_name
        || null;
      const userEmail = authUser?.email || null;

      let userSection = "";
      if (userName || userEmail) {
        userSection = `\n\nThe user you are speaking with is`;
        if (userName) userSection += ` ${userName}`;
        if (userName && userEmail) userSection += ` (${userEmail})`;
        else if (userEmail) userSection += ` ${userEmail}`;
        userSection += `. Use their name occasionally for a personal, friendly touch — but don't overdo it.`;
        if (userEmail) userSection += ` You can send them emails at ${userEmail} using the send_email tool if they ask.`;
      }

      // Build context-aware system prompt with caching
      const systemBlocks: Anthropic.TextBlockParam[] = [
        {
          type: "text",
          text: `You are a friendly email assistant in Peckmail, an AI inbox workspace for newsletters and inbound email.

Your default job is to help users find, filter, summarize, and analyze inbound emails, and answer questions about senders, topics, and trends.

Important constraints for this chat mode:
- You do not have filesystem tools here. Do not claim to read or edit files in this mode.
- For email discovery, use search_emails first and then get_email for full details.
- Use send_email only when the user explicitly asks to send an email.
- Keep responses concise and practical.${userSection}`,
          cache_control: { type: "ephemeral" },
        },
      ];

      const streamParams: any = {
        model: "claude-opus-4-6",
        max_tokens: 16384,
        system: systemBlocks,
        tools: interactiveTools,
        messages,
      };
      if (msg.thinking) {
        streamParams.thinking = {
          type: "enabled",
          budget_tokens: 10000,
        };
      }
      const stream = anthropic.messages.stream(streamParams);

      let fullContent: any[] = [];
      let currentText = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            currentText += event.delta.text;
            sendTo(ws, {
              type: "chat:delta",
              sessionId: session.id,
              text: event.delta.text,
            });
          } else if (event.delta.type === "thinking_delta") {
            sendTo(ws, {
              type: "chat:thinking",
              sessionId: session.id,
              text: (event.delta as any).thinking,
            });
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      // Accumulate usage for credit metering
      totalUsage.input_tokens += finalMessage.usage?.input_tokens ?? 0;
      totalUsage.output_tokens += finalMessage.usage?.output_tokens ?? 0;
      totalUsage.cache_read_input_tokens += (finalMessage.usage as any)?.cache_read_input_tokens ?? 0;

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
            block.input,
            ws,
            userId,
            { allowFilesystemTools: false }
          );

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

    // Settle credit hold with actual usage
    if (holdId) {
      const actualCredits = calculateOpusCost(totalUsage);
      await settleHold(holdId, actualCredits, { usage: totalUsage });
    }

    // Save session
    session.updatedAt = new Date().toISOString();
    await saveSession(projectId, session);

    sendTo(ws, {
      type: "chat:done",
      sessionId: session.id,
      title: session.title,
    });

    // Push updated sessions list to all clients
    const sessions = await listSessions(projectId);
    broadcast(projectId, {
      type: "chat:sessions",
      sessions,
    });
  } catch (err: any) {
    console.error("[chat] Error:", err);

    // Release or settle credit hold on error
    if (holdId) {
      const partialCredits = calculateOpusCost(totalUsage);
      if (partialCredits > 0) {
        await settleHold(holdId, partialCredits, { usage: totalUsage, error: true }).catch(() => {});
      } else {
        await releaseHold(holdId).catch(() => {});
      }
    }

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
