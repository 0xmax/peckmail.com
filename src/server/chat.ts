import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import { join, relative, basename } from "path";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import { PROJECTS_DIR, safePath } from "./files.js";
import { broadcast, sendTo } from "./ws.js";
import * as fileOps from "./fileOps.js";

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
  ws: WebSocket
): Promise<string> {
  const dir = join(PROJECTS_DIR, projectId);

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

    default:
      return `Unknown tool: ${toolName}`;
  }
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
      // Build context-aware system prompt with caching
      const systemBlocks: Anthropic.TextBlockParam[] = [
        {
          type: "text",
          text: `You are a friendly writing assistant in Perchpad, a collaborative workspace for markdown and CSV files. Help users with their writing — editing, brainstorming, outlining, proofreading, and more. You can read and edit their files using the provided tools. You can also use the highlight tool to draw attention to specific lines in the editor. Be warm, helpful, and concise. When making edits, explain what you changed and why. Never use technical jargon — speak in plain, friendly language.

Perchpad primarily works with two file formats:
- **Markdown (.md)** — rich text documents, notes, outlines, and prose.
- **CSV (.csv)** — structured tabular data such as lists, trackers, logs, and datasets.

When working with CSV files, be especially careful to preserve the structure (consistent column counts, proper quoting of fields that contain commas or newlines). When users ask you to add, remove, or modify rows/columns, always read the file first to understand the existing structure before making edits.`,
          cache_control: { type: "ephemeral" },
        },
      ];

      if (msg.context?.openFilePath && msg.context.fileContent !== null) {
        let contextText = `\n\nThe user currently has "${msg.context.openFilePath}" open in their editor. Here is its content:\n\`\`\`\n${msg.context.fileContent}\n\`\`\``;
        if (msg.context.cursorPosition) {
          contextText += `\n\nTheir cursor is at line ${msg.context.cursorPosition.line}, column ${msg.context.cursorPosition.col}.`;
        }
        systemBlocks.push({ type: "text", text: contextText });
      }

      const streamParams: any = {
        model: "claude-opus-4-6",
        max_tokens: 16384,
        system: systemBlocks,
        tools,
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
            ws
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
