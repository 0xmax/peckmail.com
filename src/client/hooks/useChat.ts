import { useState, useCallback, useRef, useEffect } from "react";
import { useWs } from "../context/WsContext.js";
import { useWsMessage } from "./useWebSocket.js";
import { api } from "../lib/api.js";
import { v4 as uuidv4 } from "uuid";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUse?: Array<{ tool: string; input: any }>;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

export function useChat(projectId: string) {
  const { send } = useWs();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingTextRef = useRef("");

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>(
        `/api/chat/${projectId}/sessions`
      );
      setSessions(data.sessions);
    } catch {
      // Ignore
    }
  }, [projectId]);

  // Load a specific session
  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        const data = await api.get<{ session: any }>(
          `/api/chat/${projectId}/sessions/${sessionId}`
        );
        setCurrentSessionId(sessionId);
        // Convert session messages to display format
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
        setMessages(displayMessages);
      } catch {
        // Ignore
      }
    },
    [projectId]
  );

  // Create new session
  const newSession = useCallback(async () => {
    const sessionId = uuidv4();
    setCurrentSessionId(sessionId);
    setMessages([]);
    setError(null);
    return sessionId;
  }, []);

  // Send a message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setError(null);

      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = uuidv4();
        setCurrentSessionId(sessionId);
      }

      // Add user message
      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add placeholder for assistant response
      const assistantId = uuidv4();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", toolUse: [] },
      ]);
      setStreaming(true);
      streamingTextRef.current = "";

      // Send via WebSocket
      send({
        type: "chat:send",
        sessionId,
        message: text,
      });
    },
    [currentSessionId, send]
  );

  // Handle streaming delta
  const handleDelta = useCallback(
    (msg: { text: string; sessionId: string }) => {
      if (msg.sessionId !== currentSessionId) return;
      streamingTextRef.current += msg.text;
      const text = streamingTextRef.current;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: text };
        }
        return updated;
      });
    },
    [currentSessionId]
  );

  // Handle tool use
  const handleToolUse = useCallback(
    (msg: { tool: string; input: any; sessionId: string }) => {
      if (msg.sessionId !== currentSessionId) return;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          const toolUse = [...(last.toolUse || []), { tool: msg.tool, input: msg.input }];
          updated[updated.length - 1] = { ...last, toolUse };
        }
        return updated;
      });
    },
    [currentSessionId]
  );

  // Handle done
  const handleDone = useCallback(
    (msg: { sessionId: string; title: string }) => {
      if (msg.sessionId !== currentSessionId) return;
      setStreaming(false);
      loadSessions(); // Refresh session list
    },
    [currentSessionId, loadSessions]
  );

  // Handle error
  const handleError = useCallback(
    (msg: { sessionId: string; error: string }) => {
      if (msg.sessionId !== currentSessionId) return;
      setStreaming(false);
      setError(msg.error);
    },
    [currentSessionId]
  );

  useWsMessage("chat:delta", handleDelta);
  useWsMessage("chat:tool_use", handleToolUse);
  useWsMessage("chat:done", handleDone);
  useWsMessage("chat:error", handleError);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Delete session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await api.del(`/api/chat/${projectId}/sessions/${sessionId}`);
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null);
          setMessages([]);
        }
        await loadSessions();
      } catch {
        // Ignore
      }
    },
    [projectId, currentSessionId, loadSessions]
  );

  return {
    sessions,
    currentSessionId,
    messages,
    streaming,
    error,
    sendMessage,
    loadSession,
    newSession,
    deleteSession,
    loadSessions,
  };
}
