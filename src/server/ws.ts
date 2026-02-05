import { watch, type FSWatcher } from "fs";
import { promises as fs } from "fs";
import type { WebSocket } from "ws";
import { join, dirname } from "path";
import { PROJECTS_DIR, safePath } from "./files.js";
import { handleChatMessage } from "./chat.js";
import { startGitManager, stopGitManager } from "./git.js";
import { getProjectMembership } from "./db.js";

interface ClientInfo {
  ws: WebSocket;
  userId: string;
}

// Track connected clients per project
const projectClients = new Map<string, Set<ClientInfo>>();
// Track file watchers per project
const projectWatchers = new Map<string, FSWatcher>();
// Suppress set: paths recently mutated by a client (skip watcher events)
const suppressedPaths = new Map<string, Set<string>>();

export function addClient(projectId: string, ws: WebSocket, userId: string) {
  if (!projectClients.has(projectId)) {
    projectClients.set(projectId, new Set());
  }
  const clients = projectClients.get(projectId)!;
  const client: ClientInfo = { ws, userId };
  clients.add(client);

  // Start file watcher if this is the first client
  if (clients.size === 1) {
    startWatcher(projectId);
    startGitManager(projectId);
  }

  // Handle incoming messages
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await routeMessage(projectId, userId, ws, msg);
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    if (clients.size === 0) {
      stopWatcher(projectId);
      stopGitManager(projectId);
      projectClients.delete(projectId);
      suppressedPaths.delete(projectId);
    }
  });
}

// Suppress a path from watcher events for a short time
function suppressPath(projectId: string, path: string) {
  if (!suppressedPaths.has(projectId)) {
    suppressedPaths.set(projectId, new Set());
  }
  const set = suppressedPaths.get(projectId)!;
  set.add(path);
  setTimeout(() => set.delete(path), 500);
}

function startWatcher(projectId: string) {
  const dir = join(PROJECTS_DIR, projectId);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const changedPaths = new Set<string>();

  try {
    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // Ignore .git and .perchpad directories
      if (filename.startsWith(".git") || filename.startsWith(".perchpad"))
        return;

      // Skip if this path was recently mutated by a client
      const suppressed = suppressedPaths.get(projectId);
      if (suppressed?.has(filename)) return;

      changedPaths.add(filename);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const path of changedPaths) {
          broadcast(projectId, {
            type: "file:changed",
            path,
          });
        }
        changedPaths.clear();
      }, 100);
    });

    projectWatchers.set(projectId, watcher);
  } catch {
    // Directory may not exist yet — that's fine
  }
}

function stopWatcher(projectId: string) {
  const watcher = projectWatchers.get(projectId);
  if (watcher) {
    watcher.close();
    projectWatchers.delete(projectId);
  }
}

// Broadcast a message to all clients in a project
export function broadcast(
  projectId: string,
  msg: object,
  excludeWs?: WebSocket
) {
  const clients = projectClients.get(projectId);
  if (!clients) return;
  const payload = JSON.stringify(msg);
  for (const client of clients) {
    if (client.ws !== excludeWs && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

// Send to a specific client
export function sendTo(ws: WebSocket, msg: object) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

// Route incoming WS messages to appropriate handlers
async function routeMessage(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: any
) {
  switch (msg.type) {
    case "chat:send":
      await handleChatMessage(projectId, userId, ws, msg);
      break;

    case "file:live":
      // Broadcast live content to other clients — no disk write
      broadcast(projectId, {
        type: "file:live",
        path: msg.path,
        content: msg.content,
      }, ws);
      break;

    case "file:write":
      await handleFileWrite(projectId, userId, ws, msg);
      break;

    case "file:create":
      await handleFileCreate(projectId, userId, ws, msg);
      break;

    case "file:mkdir":
      await handleFileMkdir(projectId, userId, ws, msg);
      break;

    case "file:delete":
      await handleFileDelete(projectId, userId, ws, msg);
      break;

    case "file:rename":
      await handleFileRename(projectId, userId, ws, msg);
      break;

    case "ping":
      sendTo(ws, { type: "pong" });
      break;

    default:
      sendTo(ws, {
        type: "error",
        message: `Unknown message type: ${msg.type}`,
      });
  }
}

// --- File mutation handlers ---

async function checkWriteAccess(projectId: string, userId: string): Promise<boolean> {
  const membership = await getProjectMembership(projectId, userId);
  return !!membership && ["owner", "editor"].includes(membership.role);
}

async function handleFileWrite(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { path: string; content: string }
) {
  if (!(await checkWriteAccess(projectId, userId))) {
    sendTo(ws, { type: "mutation:nack", reason: "Access denied" });
    return;
  }

  try {
    const resolved = safePath(projectId, msg.path);
    suppressPath(projectId, msg.path);
    await fs.mkdir(dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, msg.content, "utf-8");
    sendTo(ws, { type: "mutation:ack", path: msg.path });
    // Broadcast file:updated to others with content
    broadcast(projectId, {
      type: "file:updated",
      path: msg.path,
      content: msg.content,
    }, ws);
  } catch {
    sendTo(ws, { type: "mutation:nack", path: msg.path, reason: "Write failed" });
  }
}

async function handleFileCreate(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { path: string; content: string }
) {
  if (!(await checkWriteAccess(projectId, userId))) {
    sendTo(ws, { type: "mutation:nack", reason: "Access denied" });
    return;
  }

  try {
    const resolved = safePath(projectId, msg.path);
    suppressPath(projectId, msg.path);
    await fs.mkdir(dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, msg.content ?? "", "utf-8");
    sendTo(ws, { type: "mutation:ack", path: msg.path });
    // Broadcast tree:add to others
    broadcast(projectId, {
      type: "tree:add",
      path: msg.path,
      nodeType: "file",
    }, ws);
  } catch {
    sendTo(ws, { type: "mutation:nack", path: msg.path, reason: "Create failed" });
  }
}

async function handleFileMkdir(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { path: string }
) {
  if (!(await checkWriteAccess(projectId, userId))) {
    sendTo(ws, { type: "mutation:nack", reason: "Access denied" });
    return;
  }

  try {
    const resolved = safePath(projectId, msg.path);
    suppressPath(projectId, msg.path);
    await fs.mkdir(resolved, { recursive: true });
    sendTo(ws, { type: "mutation:ack", path: msg.path });
    broadcast(projectId, {
      type: "tree:add",
      path: msg.path,
      nodeType: "directory",
    }, ws);
  } catch {
    sendTo(ws, { type: "mutation:nack", path: msg.path, reason: "Mkdir failed" });
  }
}

async function handleFileDelete(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { path: string }
) {
  if (!(await checkWriteAccess(projectId, userId))) {
    sendTo(ws, { type: "mutation:nack", reason: "Access denied" });
    return;
  }

  try {
    const resolved = safePath(projectId, msg.path);
    suppressPath(projectId, msg.path);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
    sendTo(ws, { type: "mutation:ack", path: msg.path });
    broadcast(projectId, {
      type: "tree:remove",
      path: msg.path,
    }, ws);
  } catch {
    sendTo(ws, { type: "mutation:nack", path: msg.path, reason: "Delete failed" });
  }
}

async function handleFileRename(
  projectId: string,
  userId: string,
  ws: WebSocket,
  msg: { from: string; to: string }
) {
  if (!(await checkWriteAccess(projectId, userId))) {
    sendTo(ws, { type: "mutation:nack", reason: "Access denied" });
    return;
  }

  try {
    const fromResolved = safePath(projectId, msg.from);
    const toResolved = safePath(projectId, msg.to);
    suppressPath(projectId, msg.from);
    suppressPath(projectId, msg.to);
    await fs.mkdir(dirname(toResolved), { recursive: true });
    await fs.rename(fromResolved, toResolved);
    sendTo(ws, { type: "mutation:ack", from: msg.from, to: msg.to });
    broadcast(projectId, {
      type: "tree:rename",
      from: msg.from,
      to: msg.to,
    }, ws);
  } catch {
    sendTo(ws, { type: "mutation:nack", from: msg.from, to: msg.to, reason: "Rename failed" });
  }
}

export function getActiveProjects(): string[] {
  return Array.from(projectClients.keys());
}

export function getProjectClientCount(projectId: string): number {
  return projectClients.get(projectId)?.size ?? 0;
}
