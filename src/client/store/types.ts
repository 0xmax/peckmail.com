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
  chatSessions: ChatSession[];
  currentSessionId: string | null;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  chatError: string | null;
  chatPrompt: string | null;
  incomingEmails: IncomingEmail[];
}

export type StoreAction =
  // Connection
  | { type: "ws:connected" }
  | { type: "ws:disconnected" }
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
  | { type: "chat:prompt-clear" };
