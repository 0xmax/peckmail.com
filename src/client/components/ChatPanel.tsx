import { useState, useRef, useEffect, useCallback } from "react";
import { useChatState, useChatPrompt, useStoreDispatch } from "../store/StoreContext.js";
import { ChatMessage } from "./ChatMessage.js";
import { Archive, Plus, Lightbulb, PaperPlaneRight, ChatCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";

export function ChatPanel() {
  const { sessions, currentSessionId, messages, streaming, error } = useChatState();
  const chatPrompt = useChatPrompt();
  const dispatch = useStoreDispatch();

  const [input, setInput] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-send prompt dispatched from context menus
  useEffect(() => {
    if (!chatPrompt || streaming) return;
    dispatch({
      type: "chat:send",
      sessionId: currentSessionId ?? "",
      message: chatPrompt,
    });
    dispatch({ type: "chat:prompt-clear" });
  }, [chatPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return;
    dispatch({
      type: "chat:send",
      sessionId: currentSessionId ?? "",
      message: input.trim(),
      thinking,
    });
    setInput("");
  }, [input, streaming, currentSessionId, dispatch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowSessions(!showSessions)}
            title="Chat history"
          >
            <Archive size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => dispatch({ type: "chat:new-session" })}
            title="New chat"
          >
            <Plus size={16} />
          </Button>
        </div>
      </div>

      {/* Sessions dropdown */}
      {showSessions && (
        <div className="border-b border-border bg-muted max-h-48 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">No conversations yet</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-border transition-colors ${
                  s.id === currentSessionId ? "bg-border" : ""
                }`}
              >
                <button
                  onClick={() => {
                    dispatch({ type: "chat:load-session", sessionId: s.id });
                    setShowSessions(false);
                  }}
                  className="flex-1 text-left text-foreground truncate"
                >
                  {s.title}
                </button>
                <button
                  onClick={() => dispatch({ type: "chat:delete-session", sessionId: s.id })}
                  className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <ChatCircle size={32} weight="duotone" className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              Ask me anything about your newsletters!
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              I can summarize, analyze, search, and more.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {streaming && (
          <div className="flex gap-1 px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
            <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
            <span className="w-2 h-2 rounded-full bg-primary pulse-dot" />
          </div>
        )}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 dark:bg-destructive/20 rounded-lg p-2">
            {error}
            <button
              onClick={() => {
                /* retry logic could go here */
              }}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something..."
            rows={1}
            className="flex-1 resize-none py-2 px-3 bg-background border border-border rounded-xl text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            style={{
              minHeight: "38px",
              maxHeight: "120px",
            }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "38px";
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
            }}
          />
          <Button
            variant={thinking ? "secondary" : "outline"}
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setThinking((t) => !t)}
            title={thinking ? "Thinking enabled" : "Enable thinking"}
          >
            <Lightbulb size={16} weight={thinking ? "duotone" : "regular"} />
          </Button>
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || streaming}
          >
            <PaperPlaneRight size={16} weight="fill" />
          </Button>
        </div>
      </div>
    </div>
  );
}
