import { useState } from "react";
import { useOpenFile, useConnected, useProjectId } from "../store/StoreContext.js";
import { FileTree } from "./FileTree.js";
import { Editor } from "./Editor.js";
import { ChatPanel } from "./ChatPanel.js";
import { Revisions } from "./Revisions.js";
import { InviteModal } from "./InviteModal.js";
import { ShareButton } from "./ShareButton.js";
import { AudioBar } from "./ReadAloud.js";

export function Workspace({ onBack }: { onBack: () => void }) {
  const { path: openFilePath } = useOpenFile();
  const connected = useConnected();
  const projectId = useProjectId();
  const [showChat, setShowChat] = useState(true);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [sidebarWidth] = useState(240);

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Top bar */}
      <header className="bg-surface border-b border-border px-4 py-2 flex items-center justify-between shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            ← Back
          </button>
          <div className="w-px h-5 bg-border" />
          <span className="text-sm font-medium text-text">
            {openFilePath
              ? openFilePath.split("/").pop()
              : "No file open"}
          </span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
          <img src="/assets/logo.png" alt="Perchpad" className="h-6 w-auto" />
          <span style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-medium text-text -tracking-[0.01em]">
            Perchpad
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!connected && (
            <span className="text-xs text-danger px-2 py-1 bg-red-50 rounded-full">
              Reconnecting...
            </span>
          )}
          {openFilePath && (
            <ShareButton
              projectId={projectId}
              filePath={openFilePath}
            />
          )}
          <button
            onClick={() => setShowRevisions(!showRevisions)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showRevisions
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            History
          </button>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showChat
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            Assistant
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="text-sm px-3 py-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          >
            Invite
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - File tree */}
        <div
          className="bg-surface border-r border-border flex flex-col shrink-0"
          style={{ width: sidebarWidth }}
        >
          <FileTree />
        </div>

        {/* Editor area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {openFilePath ? (
            <Editor />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl mb-3">✍️</div>
                <p className="text-text-muted">
                  Select a page to start editing
                </p>
                <p className="text-text-muted text-sm mt-1">
                  or create a new one from the sidebar
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Chat panel */}
        {showChat && (
          <div className="w-80 border-l border-border bg-surface flex flex-col shrink-0">
            <ChatPanel />
          </div>
        )}

        {/* Revisions panel */}
        {showRevisions && (
          <div className="w-72 border-l border-border bg-surface flex flex-col shrink-0">
            <Revisions projectId={projectId} />
          </div>
        )}
      </div>

      {/* Audio player bar */}
      <AudioBar />

      {showInvite && (
        <InviteModal
          projectId={projectId}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}
