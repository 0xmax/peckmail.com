import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useOpenFile,
  useConnected,
  useProjectId,
  useLoadFileContent,
} from "../store/StoreContext.js";
import { FileTree } from "./FileTree.js";
import { Editor } from "./Editor.js";
import { Preview } from "./Preview.js";
import { ChatPanel } from "./ChatPanel.js";
import { Revisions } from "./Revisions.js";
import { InviteModal } from "./InviteModal.js";
import { MembersPanel } from "./MembersPanel.js";
import { ShareButton } from "./ShareButton.js";
import { AudioBar } from "./ReadAloud.js";
import { SaveIndicator } from "./SaveIndicator.js";
import { UserAvatar } from "./UserAvatar.js";
import { GitPanel } from "./GitPanel.js";
import { EmailPanel } from "./EmailPanel.js";
import { useAuth } from "../context/AuthContext.js";

const MODE_PREVIEW = "preview";
const MODE_EDIT = "edit";
const FILE_PARAM = "file";

export function Workspace({ onBack }: { onBack: () => void }) {
  const { path: openFilePath, content: fileContent } = useOpenFile();
  const connected = useConnected();
  const projectId = useProjectId();
  const loadFileContent = useLoadFileContent();
  const [showChat, setShowChat] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const { user } = useAuth();
  const modeStorageKey = useMemo(
    () => `perchpad:view-mode:${projectId}`,
    [projectId]
  );
  const [showPreview, setShowPreview] = useState(() => {
    try {
      return window.localStorage.getItem(`perchpad:view-mode:${projectId}`) === MODE_PREVIEW;
    } catch {
      return false;
    }
  });
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarWidth] = useState(240);
  const openFilePathRef = useRef<string | null>(openFilePath);
  const loadFileContentRef = useRef(loadFileContent);

  useEffect(() => {
    openFilePathRef.current = openFilePath;
  }, [openFilePath]);

  useEffect(() => {
    loadFileContentRef.current = loadFileContent;
  }, [loadFileContent]);

  const applyStateFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const fileParam = params.get(FILE_PARAM);
    if (fileParam && fileParam !== openFilePathRef.current) {
      loadFileContentRef.current(fileParam);
    }
  }, []);

  // Initialize workspace state from URL and keep it in sync on browser navigation.
  useEffect(() => {
    applyStateFromUrl();
    const onPopState = () => applyStateFromUrl();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyStateFromUrl]);

  // Persist current mode per project.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        modeStorageKey,
        showPreview ? MODE_PREVIEW : MODE_EDIT
      );
    } catch {
      // Ignore storage access issues
    }
  }, [modeStorageKey, showPreview]);

  // Keep workspace URL shareable with current file + mode.
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    let changed = false;

    if (openFilePath && params.get(FILE_PARAM) !== openFilePath) {
      params.set(FILE_PARAM, openFilePath);
      changed = true;
    }

    if (!changed) return;
    const next = `${url.pathname}?${params.toString()}${url.hash}`;
    window.history.replaceState(null, "", next);
  }, [openFilePath]);

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
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showSidebar
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            Pages
          </button>
          <div className="w-px h-5 bg-border" />
          <span className="text-sm font-medium text-text">
            {openFilePath
              ? openFilePath.split("/").pop()
              : "No file open"}
          </span>
          <SaveIndicator projectId={projectId} />
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
            <>
              <ShareButton
                projectId={projectId}
                filePath={openFilePath}
              />
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  showPreview
                    ? "bg-surface-alt text-accent"
                    : "text-text-muted hover:text-text hover:bg-surface-alt"
                }`}
                title={showPreview ? "Edit mode" : "Preview mode"}
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            </>
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
            onClick={() => setShowMembers(!showMembers)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showMembers
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            Members
          </button>
          <button
            onClick={() => setShowGit(!showGit)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showGit
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            Git
          </button>
          <button
            onClick={() => setShowEmail(!showEmail)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              showEmail
                ? "bg-surface-alt text-accent"
                : "text-text-muted hover:text-text hover:bg-surface-alt"
            }`}
          >
            Email
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="text-sm px-3 py-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          >
            Invite
          </button>
          <div className="w-px h-5 bg-border" />
          <UserAvatar
            src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
            name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
            size={26}
          />
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - File tree */}
        {showSidebar && (
          <div
            className="bg-surface border-r border-border flex flex-col shrink-0"
            style={{ width: sidebarWidth }}
          >
            <FileTree />
          </div>
        )}

        {/* Editor / Preview area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {openFilePath ? (
            showPreview ? (
              <Preview content={fileContent ?? ""} filePath={openFilePath} />
            ) : (
              <Editor />
            )
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

        {/* Members panel */}
        {showMembers && (
          <div className="w-64 border-l border-border bg-surface flex flex-col shrink-0">
            <MembersPanel projectId={projectId} />
          </div>
        )}

        {/* Git panel */}
        {showGit && (
          <div className="w-72 border-l border-border bg-surface flex flex-col shrink-0">
            <GitPanel projectId={projectId} />
          </div>
        )}

        {/* Email panel */}
        {showEmail && (
          <div className="w-72 border-l border-border bg-surface flex flex-col shrink-0">
            <EmailPanel projectId={projectId} />
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
