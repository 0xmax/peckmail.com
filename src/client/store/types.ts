export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUse?: Array<{ tool: string; input: any }>;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StoreState {
  projectId: string;
  connected: boolean;
  tree: FileNode[];
  treeLoading: boolean;
  openFilePath: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  cursorPosition: CursorPosition | null;
  highlight: { fromLine: number; toLine: number } | null;
  chatSessions: ChatSession[];
  currentSessionId: string | null;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  chatError: string | null;
}

export type StoreAction =
  // Connection
  | { type: "ws:connected" }
  | { type: "ws:disconnected" }
  // Tree
  | { type: "tree:set"; tree: FileNode[] }
  | { type: "tree:loading"; loading: boolean }
  | { type: "tree:add"; path: string; nodeType: "file" | "directory" }
  | { type: "tree:remove"; path: string }
  | { type: "tree:rename"; from: string; to: string }
  // File
  | { type: "file:open"; path: string; content: string }
  | { type: "file:close" }
  | { type: "file:loading"; loading: boolean }
  | { type: "file:content"; content: string }
  | { type: "file:write"; path: string; content: string }
  | { type: "file:live"; path: string; content: string }
  | { type: "file:create"; path: string; content: string }
  | { type: "file:mkdir"; path: string }
  | { type: "file:delete"; path: string }
  | { type: "file:rename"; from: string; to: string }
  | { type: "file:updated"; path: string; content: string }
  | { type: "file:cursor"; line: number; col: number }
  // Chat
  | { type: "chat:set-sessions"; sessions: ChatSession[] }
  | { type: "chat:load-session"; sessionId: string }
  | { type: "chat:set-messages"; messages: ChatMessage[] }
  | { type: "chat:send"; sessionId: string; message: string }
  | { type: "chat:new-session" }
  | { type: "chat:delete-session"; sessionId: string }
  | { type: "chat:delta"; sessionId: string; text: string }
  | { type: "chat:tool-use"; sessionId: string; tool: string; input: any }
  | { type: "chat:done"; sessionId: string; title: string }
  | { type: "chat:error"; sessionId: string; error: string }
  | { type: "chat:streaming"; streaming: boolean };
