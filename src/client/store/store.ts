import { v4 as uuidv4 } from "uuid";
import type { StoreState, StoreAction, FileNode, ChatMessage, ChatSession, ProjectSettings, IncomingEmail } from "./types.js";
import { treeAddNode, treeRemoveNode, treeRenameNode } from "./tree-ops.js";
import { api } from "../lib/api.js";

type Listener = () => void;

export class WorkspaceStore {
  private state: StoreState;
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private queue: object[] = [];
  private retryDelay = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private accessToken: string | null = null;
  private deltaBuffer = "";
  private deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(projectId: string) {
    this.state = {
      projectId,
      connected: false,
      tree: [],
      treeLoading: true,
      openFilePath: null,
      fileContent: null,
      fileLoading: false,
      cursorPosition: null,
      highlight: null,
      ttsPlayback: null,
      chatSessions: [],
      currentSessionId: null,
      chatMessages: [],
      chatStreaming: false,
      chatError: null,
      ttsFromLine: null,
      chatPrompt: null,
      projectSettings: {},
      incomingEmails: [],
    };
  }

  // --- useSyncExternalStore API ---

  getState = (): StoreState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setState(partial: Partial<StoreState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  // --- WebSocket ---

  connect(accessToken: string) {
    this.accessToken = accessToken;
    this.doConnect();
  }

  private doConnect() {
    if (this.disposed || !this.accessToken) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/${this.state.projectId}?token=${this.accessToken}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.setState({ connected: true });
      this.retryDelay = 1000;
      for (const msg of this.queue) {
        ws.send(JSON.stringify(msg));
      }
      this.queue = [];
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleWsMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.setState({ connected: false });
      this.ws = null;
      if (!this.disposed) {
        const delay = this.retryDelay;
        this.retryDelay = Math.min(delay * 2, 30000);
        this.retryTimer = setTimeout(() => this.doConnect(), delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  private handleWsMessage(msg: any) {
    switch (msg.type) {
      case "tree:add":
        this.setState({
          tree: treeAddNode(this.state.tree, msg.path, msg.nodeType),
        });
        break;

      case "tree:remove":
        this.setState({
          tree: treeRemoveNode(this.state.tree, msg.path),
        });
        // Close file if it was deleted
        if (this.state.openFilePath === msg.path) {
          this.setState({ openFilePath: null, fileContent: null });
        }
        break;

      case "tree:rename":
        this.setState({
          tree: treeRenameNode(this.state.tree, msg.from, msg.to),
        });
        // Update open file path if renamed
        if (this.state.openFilePath === msg.from) {
          this.setState({ openFilePath: msg.to });
        }
        break;

      case "file:live":
      case "file:updated":
        if (msg.path === this.state.openFilePath && msg.content !== undefined) {
          this.setState({ fileContent: msg.content });
        }
        break;

      case "file:changed":
        // Legacy: full tree refresh for unhandled fs changes
        this.loadTree();
        if (msg.path === this.state.openFilePath) {
          this.loadFileContent(msg.path);
        }
        break;

      case "editor:highlight":
        if (msg.path === this.state.openFilePath) {
          this.setState({ highlight: { fromLine: msg.fromLine, toLine: msg.toLine } });
          // Auto-clear highlight after 4 seconds
          setTimeout(() => {
            if (this.state.highlight?.fromLine === msg.fromLine && this.state.highlight?.toLine === msg.toLine) {
              this.setState({ highlight: null });
            }
          }, 4000);
        }
        break;

      case "mutation:ack":
        // Server confirmed our mutation — no action needed (optimistic update already applied)
        break;

      case "mutation:nack":
        // Server rejected our mutation — reload tree to get correct state
        this.loadTree();
        break;

      case "chat:delta":
        this.handleChatDelta(msg);
        break;

      case "chat:tool_use":
        this.handleChatToolUse(msg);
        break;

      case "chat:done":
        this.handleChatDone(msg);
        break;

      case "chat:error":
        this.handleChatError(msg);
        break;

      case "chat:sessions":
        this.setState({ chatSessions: msg.sessions });
        break;

      case "email:received":
        this.setState({
          incomingEmails: [msg.email, ...this.state.incomingEmails],
        });
        break;

      case "email:status":
        this.setState({
          incomingEmails: this.state.incomingEmails.map((e) =>
            e.id === msg.emailId
              ? { ...e, status: msg.status, error: msg.error ?? null }
              : e
          ),
        });
        break;

      case "pong":
        break;
    }
  }

  // --- Chat delta batching ---

  private handleChatDelta(msg: { sessionId: string; text: string }) {
    if (msg.sessionId !== this.state.currentSessionId) return;
    this.deltaBuffer += msg.text;

    if (!this.deltaFlushTimer) {
      this.deltaFlushTimer = setTimeout(() => {
        this.flushDeltaBuffer();
        this.deltaFlushTimer = null;
      }, 50);
    }
  }

  private flushDeltaBuffer() {
    if (!this.deltaBuffer) return;
    const text = this.deltaBuffer;
    // Don't clear buffer here — accumulate for full content
    const messages = [...this.state.chatMessages];
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      messages[messages.length - 1] = { ...last, content: text };
    }
    this.setState({ chatMessages: messages });
  }

  private handleChatToolUse(msg: { sessionId: string; tool: string; input: any }) {
    if (msg.sessionId !== this.state.currentSessionId) return;
    const messages = [...this.state.chatMessages];
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      const toolUse = [...(last.toolUse || []), { tool: msg.tool, input: msg.input }];
      messages[messages.length - 1] = { ...last, toolUse };
    }
    this.setState({ chatMessages: messages });
  }

  private handleChatDone(msg: { sessionId: string; title: string }) {
    if (msg.sessionId !== this.state.currentSessionId) return;
    // Flush any remaining delta
    if (this.deltaFlushTimer) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    this.flushDeltaBuffer();
    this.setState({ chatStreaming: false });
    // Refresh sessions list
    this.loadChatSessions();
  }

  private handleChatError(msg: { sessionId: string; error: string }) {
    if (msg.sessionId !== this.state.currentSessionId) return;
    this.setState({ chatStreaming: false, chatError: msg.error });
  }

  // --- Dispatch (public API) ---

  dispatch = (action: StoreAction) => {
    switch (action.type) {
      // File mutations — optimistic update + WS send
      case "file:create": {
        this.setState({
          tree: treeAddNode(this.state.tree, action.path, "file"),
        });
        this.send({ type: "file:create", path: action.path, content: action.content });
        break;
      }

      case "file:mkdir": {
        this.setState({
          tree: treeAddNode(this.state.tree, action.path, "directory"),
        });
        this.send({ type: "file:mkdir", path: action.path });
        break;
      }

      case "file:delete": {
        this.setState({
          tree: treeRemoveNode(this.state.tree, action.path),
        });
        if (this.state.openFilePath === action.path) {
          this.setState({ openFilePath: null, fileContent: null });
        }
        this.send({ type: "file:delete", path: action.path });
        break;
      }

      case "file:rename": {
        this.setState({
          tree: treeRenameNode(this.state.tree, action.from, action.to),
        });
        if (this.state.openFilePath === action.from) {
          this.setState({ openFilePath: action.to });
        }
        this.send({ type: "file:rename", from: action.from, to: action.to });
        break;
      }

      case "file:write": {
        this.send({ type: "file:write", path: action.path, content: action.content });
        break;
      }

      case "file:live": {
        this.send({ type: "file:live", path: action.path, content: action.content });
        break;
      }

      // File open/close (REST-based)
      case "file:open": {
        this.setState({
          openFilePath: action.path,
          fileContent: action.content,
          fileLoading: false,
        });
        break;
      }

      case "file:close": {
        this.setState({ openFilePath: null, fileContent: null });
        break;
      }

      case "file:loading": {
        this.setState({ fileLoading: action.loading });
        break;
      }

      case "file:content": {
        this.setState({ fileContent: action.content });
        break;
      }

      case "file:cursor": {
        this.setState({ cursorPosition: { line: action.line, col: action.col } });
        break;
      }

      // Tree
      case "tree:set": {
        this.setState({ tree: action.tree, treeLoading: false });
        break;
      }

      case "tree:loading": {
        this.setState({ treeLoading: action.loading });
        break;
      }

      case "tree:add": {
        this.setState({
          tree: treeAddNode(this.state.tree, action.path, action.nodeType),
        });
        break;
      }

      case "tree:remove": {
        this.setState({
          tree: treeRemoveNode(this.state.tree, action.path),
        });
        break;
      }

      case "tree:rename": {
        this.setState({
          tree: treeRenameNode(this.state.tree, action.from, action.to),
        });
        break;
      }

      // Chat
      case "chat:send": {
        let sessionId = action.sessionId || this.state.currentSessionId;
        if (!sessionId) {
          sessionId = uuidv4();
          this.setState({ currentSessionId: sessionId });
        }

        const userMsg: ChatMessage = {
          id: uuidv4(),
          role: "user",
          content: action.message,
        };
        const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: "",
          toolUse: [],
        };
        this.deltaBuffer = "";
        this.setState({
          chatMessages: [...this.state.chatMessages, userMsg, assistantMsg],
          chatStreaming: true,
          chatError: null,
        });

        this.send({
          type: "chat:send",
          sessionId,
          message: action.message,
          thinking: action.thinking || false,
          context: {
            openFilePath: this.state.openFilePath,
            fileContent: this.state.fileContent,
            cursorPosition: this.state.cursorPosition,
          },
        });
        break;
      }

      case "chat:new-session": {
        const sessionId = uuidv4();
        this.deltaBuffer = "";
        this.setState({
          currentSessionId: sessionId,
          chatMessages: [],
          chatError: null,
          chatStreaming: false,
        });
        break;
      }

      case "chat:load-session": {
        this.loadSession(action.sessionId);
        break;
      }

      case "chat:delete-session": {
        this.deleteSession(action.sessionId);
        break;
      }

      case "chat:set-sessions": {
        this.setState({ chatSessions: action.sessions });
        break;
      }

      case "chat:set-messages": {
        this.setState({ chatMessages: action.messages });
        break;
      }

      case "chat:streaming": {
        this.setState({ chatStreaming: action.streaming });
        break;
      }

      case "chat:prompt": {
        this.setState({ chatPrompt: action.message });
        break;
      }

      case "chat:prompt-clear": {
        this.setState({ chatPrompt: null });
        break;
      }

      // TTS
      case "tts:play-from": {
        this.setState({ ttsFromLine: action.fromLine });
        break;
      }

      case "tts:clear": {
        this.setState({ ttsFromLine: null, highlight: null, ttsPlayback: null });
        break;
      }

      case "tts:highlight": {
        const cur = this.state.highlight;
        const next = {
          fromLine: action.line,
          toLine: action.line,
          fromChar: action.fromChar,
          toChar: action.toChar,
        };
        if (
          !cur ||
          cur.fromLine !== next.fromLine ||
          cur.toLine !== next.toLine ||
          cur.fromChar !== next.fromChar ||
          cur.toChar !== next.toChar
        ) {
          this.setState({ highlight: next });
        }
        break;
      }

      case "tts:highlight-clear": {
        this.setState({ highlight: null });
        break;
      }

      case "tts:playback": {
        this.setState({ ttsPlayback: action.playback });
        break;
      }

      case "tts:playback-stop": {
        this.setState({ ttsPlayback: null });
        break;
      }

      // Settings
      case "settings:set": {
        this.setState({ projectSettings: action.settings });
        break;
      }

      case "settings:save": {
        this.setState({ projectSettings: action.settings });
        api.put(`/api/projects/${this.state.projectId}/settings`, action.settings).catch(() => {});
        break;
      }

      // Connection
      case "ws:connected": {
        this.setState({ connected: true });
        break;
      }

      case "ws:disconnected": {
        this.setState({ connected: false });
        break;
      }
    }
  };

  // --- REST helpers ---

  async loadTree() {
    this.setState({ treeLoading: true });
    try {
      const data = await api.get<{ tree: FileNode[] }>(
        `/api/files/${this.state.projectId}/tree`
      );
      this.setState({ tree: data.tree, treeLoading: false });
    } catch {
      this.setState({ treeLoading: false });
    }
  }

  async loadFileContent(path: string) {
    this.setState({ fileLoading: true });
    try {
      const data = await api.get<{ content: string }>(
        `/api/files/${this.state.projectId}/read?path=${encodeURIComponent(path)}`
      );
      this.setState({
        openFilePath: path,
        fileContent: data.content,
        fileLoading: false,
      });
    } catch {
      this.setState({ fileLoading: false });
    }
  }

  async loadChatSessions() {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>(
        `/api/chat/${this.state.projectId}/sessions`
      );
      this.setState({ chatSessions: data.sessions });
    } catch {
      // Ignore
    }
  }

  async loadEmails() {
    try {
      const data = await api.get<{ emails: IncomingEmail[] }>(
        `/api/projects/${this.state.projectId}/emails`
      );
      this.setState({ incomingEmails: data.emails });
    } catch {
      // Ignore
    }
  }

  async loadSettings() {
    try {
      const data = await api.get<ProjectSettings>(
        `/api/projects/${this.state.projectId}/settings`
      );
      this.setState({ projectSettings: data });
    } catch {
      // Ignore — defaults to {}
    }
  }

  private async loadSession(sessionId: string) {
    try {
      const data = await api.get<{ session: any }>(
        `/api/chat/${this.state.projectId}/sessions/${sessionId}`
      );
      this.setState({ currentSessionId: sessionId });

      const displayMessages: ChatMessage[] = [];
      for (const msg of data.session.messages) {
        if (msg.role === "user" && typeof msg.content === "string") {
          displayMessages.push({
            id: uuidv4(),
            role: "user",
            content: msg.content,
          });
        } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const toolParts = msg.content
            .filter((b: any) => b.type === "tool_use")
            .map((b: any) => ({ tool: b.name, input: b.input }));
          if (textParts || toolParts.length > 0) {
            displayMessages.push({
              id: uuidv4(),
              role: "assistant",
              content: textParts,
              toolUse: toolParts.length > 0 ? toolParts : undefined,
            });
          }
        }
      }
      this.setState({ chatMessages: displayMessages });
    } catch {
      // Ignore
    }
  }

  private async deleteSession(sessionId: string) {
    try {
      await api.del(
        `/api/chat/${this.state.projectId}/sessions/${sessionId}`
      );
      if (this.state.currentSessionId === sessionId) {
        this.setState({
          currentSessionId: null,
          chatMessages: [],
        });
      }
      await this.loadChatSessions();
    } catch {
      // Ignore
    }
  }

  // --- Cleanup ---

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.deltaFlushTimer) clearTimeout(this.deltaFlushTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }
}
