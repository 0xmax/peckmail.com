import { useMemo } from "react";
import { marked } from "marked";
import { Eye, PencilSimple, FilePlus, ListBullets, Wrench } from "@phosphor-icons/react";
import type { ReactNode } from "react";

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

function toolIcon(tool: string): ReactNode {
  const props = { size: 14, className: "inline shrink-0" };
  switch (tool) {
    case "read_file":
      return <Eye {...props} />;
    case "edit_file":
      return <PencilSimple {...props} />;
    case "create_file":
      return <FilePlus {...props} />;
    case "list_files":
      return <ListBullets {...props} />;
    default:
      return <Wrench {...props} />;
  }
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const html = useMemo(() => {
    if (isUser || !message.content) return null;
    return marked.parse(message.content, { async: false }) as string;
  }, [isUser, message.content]);

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
                className="flex items-center gap-2 text-xs bg-card/60 rounded-lg px-2.5 py-1.5 border border-border"
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
          isUser ? (
            <div className="whitespace-pre-wrap break-words">
              {message.content}
            </div>
          ) : (
            <div
              className="chat-markdown break-words"
              dangerouslySetInnerHTML={{ __html: html! }}
            />
          )
        )}
      </div>
    </div>
  );
}
