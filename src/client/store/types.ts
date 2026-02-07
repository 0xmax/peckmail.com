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

export interface UserPreferences {
  tts?: {
    voiceId?: string;
    model?: "v2" | "v3";
    simpleMode?: boolean;
    v2?: {
      stability: number;
      similarityBoost: number;
      style: number;
      speed: number;
    };
  };
}

export type ItemColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export interface ProjectSettings {
  tts?: {
    voiceId?: string;
    model?: "v2" | "v3";
    simpleMode?: boolean;
    v2?: {
      stability: number;
      similarityBoost: number;
      style: number;
      speed: number;
    };
  };
  itemColors?: Record<string, ItemColor>;
}

export interface TtsPlayback {
  fromChar: number;
  toChar: number;
  duration: number;
  elapsed: number;
  dispatchedAt: number;
  playing: boolean;
}

export interface HighlightRange {
  fromLine: number;
  toLine: number;
  fromChar?: number;
  toChar?: number;
}

export interface IncomingEmail {
  id: string;
  from_address: string;
  subject: string;
  status: "received" | "processing" | "processed" | "failed";
  error: string | null;
  created_at: string;
}

export interface StoreState {
  projectId: string;
  projectName: string;
  connected: boolean;
  tree: FileNode[];
  treeLoading: boolean;
  openFilePath: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  cursorPosition: CursorPosition | null;
  highlight: HighlightRange | null;
  ttsPlayback: TtsPlayback | null;
  chatSessions: ChatSession[];
  currentSessionId: string | null;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  chatError: string | null;
  ttsFromLine: number | null;
  chatPrompt: string | null;
  projectSettings: ProjectSettings;
  incomingEmails: IncomingEmail[];
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
  | { type: "chat:send"; sessionId: string; message: string; thinking?: boolean }
  | { type: "chat:new-session" }
  | { type: "chat:delete-session"; sessionId: string }
  | { type: "chat:delta"; sessionId: string; text: string }
  | { type: "chat:tool-use"; sessionId: string; tool: string; input: any }
  | { type: "chat:done"; sessionId: string; title: string }
  | { type: "chat:error"; sessionId: string; error: string }
  | { type: "chat:streaming"; streaming: boolean }
  | { type: "chat:prompt"; message: string }
  | { type: "chat:prompt-clear" }
  // TTS
  | { type: "tts:play-from"; fromLine: number }
  | { type: "tts:clear" }
  | { type: "tts:highlight"; line: number; fromChar?: number; toChar?: number }
  | { type: "tts:highlight-clear" }
  | { type: "tts:playback"; playback: TtsPlayback }
  | { type: "tts:playback-stop" }
  // Settings
  | { type: "settings:set"; settings: ProjectSettings }
  | { type: "settings:save"; settings: ProjectSettings }
  | { type: "settings:set-item-color"; path: string; color: ItemColor | null };
