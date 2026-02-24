import { v4 as uuidv4 } from "uuid";
import type { StoreState, StoreAction, ChatMessage, ChatSession, IncomingEmail } from "./types.js";
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
      projectName: "",
      connected: false,
      chatSessions: [],
      currentSessionId: null,
      chatMessages: [],
      chatStreaming: false,
      chatError: null,
      chatPrompt: null,
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

      case "email:classified":
        this.setState({
          incomingEmails: this.state.incomingEmails.map((e) =>
            e.id === msg.emailId
              ? {
                  ...e,
                  tags: Array.isArray(msg.tags) ? msg.tags : e.tags,
                  summary: typeof msg.summary === "string" ? msg.summary : e.summary,
                }
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
    if (this.deltaFlushTimer) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    this.flushDeltaBuffer();
    this.setState({ chatStreaming: false });
    this.loadChatSessions();
  }

  private handleChatError(msg: { sessionId: string; error: string }) {
    if (msg.sessionId !== this.state.currentSessionId) return;
    this.setState({ chatStreaming: false, chatError: msg.error });
  }

  // --- Dispatch (public API) ---

  dispatch = (action: StoreAction) => {
    switch (action.type) {
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
          context: {},
        });
        break;
      }

      case "chat:new-session": {
        this.deltaBuffer = "";
        this.setState({
          currentSessionId: uuidv4(),
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

  async loadProjectName() {
    try {
      const data = await api.get<{ projects: { id: string; name: string }[] }>("/api/projects");
      const project = data.projects.find((p) => p.id === this.state.projectId);
      if (project) this.setState({ projectName: project.name });
    } catch {
      // Ignore
    }
  }

  async renameProject(name: string): Promise<boolean> {
    try {
      await api.patch(`/api/projects/${this.state.projectId}`, { name });
      this.setState({ projectName: name });
      return true;
    } catch {
      return false;
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
