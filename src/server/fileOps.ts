/**
 * Shared file operations used by both the internal AI chat tools and the MCP server.
 * Each mutation broadcasts the appropriate WebSocket event so connected clients stay in sync.
 */
import { promises as fs } from "fs";
import { dirname } from "path";
import { safePath, projectDir, listTree } from "./files.js";
import { broadcast } from "./ws.js";

export async function readFile(projectId: string, path: string): Promise<string> {
  const resolved = safePath(projectId, path);
  return fs.readFile(resolved, "utf-8");
}

export async function writeFile(projectId: string, path: string, content: string): Promise<void> {
  const resolved = safePath(projectId, path);
  let isNew = false;
  try { await fs.access(resolved); } catch { isNew = true; }
  await fs.mkdir(dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");
  if (isNew) {
    broadcast(projectId, { type: "tree:add", path, nodeType: "file" });
  }
  broadcast(projectId, { type: "file:updated", path, content });
}

export async function editFile(projectId: string, path: string, oldText: string, newText: string): Promise<string> {
  const resolved = safePath(projectId, path);
  let content = await fs.readFile(resolved, "utf-8");
  if (!content.includes(oldText)) {
    throw new Error(`Could not find the specified text in "${path}"`);
  }
  content = content.replace(oldText, newText);
  await fs.writeFile(resolved, content, "utf-8");
  broadcast(projectId, { type: "file:updated", path, content });
  return content;
}

export async function appendFile(projectId: string, path: string, text: string): Promise<void> {
  const resolved = safePath(projectId, path);
  await fs.mkdir(dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, text, "utf-8");
  const content = await fs.readFile(resolved, "utf-8");
  broadcast(projectId, { type: "file:updated", path, content });
}

export async function deleteFile(projectId: string, path: string): Promise<void> {
  const resolved = safePath(projectId, path);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true });
  } else {
    await fs.unlink(resolved);
  }
  broadcast(projectId, { type: "tree:remove", path });
}

export async function moveFile(projectId: string, from: string, to: string): Promise<void> {
  const fromResolved = safePath(projectId, from);
  const toResolved = safePath(projectId, to);
  await fs.mkdir(dirname(toResolved), { recursive: true });
  await fs.rename(fromResolved, toResolved);
  broadcast(projectId, { type: "tree:rename", from, to });
}

export async function copyFile(projectId: string, from: string, to: string): Promise<void> {
  const fromResolved = safePath(projectId, from);
  const toResolved = safePath(projectId, to);
  const stat = await fs.stat(fromResolved);
  if (stat.isDirectory()) {
    throw new Error("Cannot copy directories — only files can be copied");
  }
  await fs.mkdir(dirname(toResolved), { recursive: true });
  await fs.copyFile(fromResolved, toResolved);
  broadcast(projectId, { type: "tree:add", path: to, nodeType: "file" });
}

export async function createDirectory(projectId: string, path: string): Promise<void> {
  const resolved = safePath(projectId, path);
  await fs.mkdir(resolved, { recursive: true });
  broadcast(projectId, { type: "tree:add", path, nodeType: "directory" });
}

export async function listFiles(projectId: string): Promise<any> {
  const dir = projectDir(projectId);
  return listTree(dir, dir);
}

/** Helper: read a file back and broadcast file:updated. Use after chat-specific tools that modify files directly. */
export async function notifyFileUpdated(projectId: string, path: string): Promise<void> {
  try {
    const resolved = safePath(projectId, path);
    const content = await fs.readFile(resolved, "utf-8");
    broadcast(projectId, { type: "file:updated", path, content });
  } catch {
    broadcast(projectId, { type: "file:changed", path });
  }
}
