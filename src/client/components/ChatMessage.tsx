interface ToolUse {
  tool: string;
  input: any;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUse?: ToolUse[];
}

function toolLabel(tool: string, input: any): string {
  switch (tool) {
    case "read_file":
      return `Read "${input.path}"`;
    case "edit_file":
      return `Edited "${input.path}"`;
    case "create_file":
      return `Created "${input.path}"`;
    case "list_files":
      return "Listed files";
    default:
      return tool;
  }
}

function toolIcon(tool: string): string {
  switch (tool) {
    case "read_file":
      return "👀";
    case "edit_file":
      return "✏️";
    case "create_file":
      return "📝";
    case "list_files":
      return "📋";
    default:
      return "🔧";
  }
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-chat-user text-text rounded-br-md"
            : "bg-chat-ai text-text rounded-bl-md"
        }`}
      >
        {/* Tool use cards */}
        {message.toolUse && message.toolUse.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {message.toolUse.map((tu, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs bg-white/60 rounded-lg px-2.5 py-1.5 border border-border"
              >
                <span>{toolIcon(tu.tool)}</span>
                <span className="text-text-muted">
                  {toolLabel(tu.tool, tu.input)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Message text */}
        {message.content && (
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}
