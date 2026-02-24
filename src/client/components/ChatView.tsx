import { ChatPanel } from "./ChatPanel.js";

export function ChatView() {
  return (
    <div className="flex-1 flex justify-center min-h-0">
      <div className="w-full max-w-3xl flex flex-col">
        <ChatPanel />
      </div>
    </div>
  );
}
