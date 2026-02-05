import { watch, type FSWatcher } from "fs";
import type { WebSocket } from "ws";
import { join } from "path";
import { PROJECTS_DIR } from "./files.js";
import { handleChatMessage } from "./chat.js";
import { startGitManager, stopGitManager } from "./git.js";

interface ClientInfo {
  ws: WebSocket;
  userId: string;
}

// Track connected clients per project
const projectClients = new Map<string, Set<ClientInfo>>();
// Track file watchers per project
const projectWatchers = new Map<string, FSWatcher>();

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
    }
  });
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

export function getActiveProjects(): string[] {
  return Array.from(projectClients.keys());
}

export function getProjectClientCount(projectId: string): number {
  return projectClients.get(projectId)?.size ?? 0;
}
