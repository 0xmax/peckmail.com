import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  useOpenFile,
  useConnected,
  useProjectId,
  useLoadFileContent,
  useTree,
  useTtsFromLine,
  useChatPrompt,
} from "../store/StoreContext.js";
import type { FileNode } from "../store/types.js";
import { FileTree } from "./FileTree.js";
import { Editor } from "./Editor.js";
import { Preview } from "./Preview.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { ChatPanel } from "./ChatPanel.js";
import { Revisions } from "./Revisions.js";
import { ConnectPanel } from "./ConnectPanel.js";
import { AudioBar } from "./ReadAloud.js";
import { SaveIndicator } from "./SaveIndicator.js";
import { UserAvatar } from "./UserAvatar.js";
import { SettingsModal } from "./SettingsModal.js";
import { useAuth } from "../context/AuthContext.js";
import { ArrowLeft, Sidebar, ClockCounterClockwise, ChatCircle, Plugs, GearSix, SignOut, Users } from "@phosphor-icons/react";

function fileExistsInTree(tree: FileNode[], path: string): boolean {
  for (const node of tree) {
    if (node.path === path) return true;
    if (node.children && fileExistsInTree(node.children, path)) return true;
  }
  return false;
}

const MODE_PREVIEW = "preview";
const MODE_EDIT = "edit";
const FILE_PARAM = "file";

type Panel = "connect" | "revisions" | "chat" | null;

export function Workspace({ onBack }: { onBack: () => void }) {
  const { path: openFilePath, content: fileContent } = useOpenFile();
  const { tree, loading: treeLoading } = useTree();
  const connected = useConnected();
  const projectId = useProjectId();
  const loadFileContent = useLoadFileContent();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [showShare, setShowShare] = useState(false);
  const [showAudioBar, setShowAudioBar] = useState(false);
  const ttsFromLine = useTtsFromLine();
  const chatPrompt = useChatPrompt();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user, signOut } = useAuth();
  const editorViewRef = useRef<EditorView | null>(null);
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

  const togglePanel = (panel: Panel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  // Show audio bar when TTS is triggered from any source
  useEffect(() => {
    if (ttsFromLine !== null) setShowAudioBar(true);
  }, [ttsFromLine]);

  // Open chat panel when a prompt is dispatched from context menus
  useEffect(() => {
    if (chatPrompt) setActivePanel("chat");
  }, [chatPrompt]);

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

  // Save last open file to localStorage.
  useEffect(() => {
    if (openFilePath) {
      try {
        window.localStorage.setItem(`perchpad:last-file:${projectId}`, openFilePath);
      } catch {}
    }
  }, [openFilePath, projectId]);

  // Restore last open file when tree finishes loading (if nothing is open).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (treeLoading || tree.length === 0 || restoredRef.current) return;
    restoredRef.current = true;
    // Don't override URL param
    const params = new URLSearchParams(window.location.search);
    if (params.get(FILE_PARAM)) return;
    // Don't override if a file is already open
    if (openFilePathRef.current) return;

    try {
      const lastFile = window.localStorage.getItem(`perchpad:last-file:${projectId}`);
      if (lastFile && fileExistsInTree(tree, lastFile)) {
        loadFileContentRef.current(lastFile);
        return;
      }
    } catch {}
    // Fallback: open welcome.md if it exists
    if (fileExistsInTree(tree, "welcome.md")) {
      loadFileContentRef.current("welcome.md");
    }
  }, [treeLoading, tree, projectId]);

  // Close user menu on outside click.
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

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

  const panelBtnClass = (panel: Panel) =>
    `p-2 rounded-lg transition-colors ${
      activePanel === panel
        ? "text-accent hover:text-accent"
        : "text-text-muted hover:text-text"
    }`;

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Top bar */}
      <header className="bg-surface border-b border-border px-4 py-2 flex items-center justify-between shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            <ArrowLeft size={14} weight="bold" className="inline" /> Back
          </button>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            title="Pages"
            className={`p-2 rounded-lg transition-colors ${
              showSidebar
                ? "text-accent hover:text-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            <Sidebar size={16} />
          </button>
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
          <button
            onClick={() => setShowShare(true)}
            title="Share workspace"
            className="p-2 rounded-lg transition-colors text-text-muted hover:text-text"
          >
            <Users size={16} />
          </button>
          {/* Panel toggle pill */}
          <div className="flex items-center gap-px bg-surface-alt/50 rounded-xl p-0.5">
            <button
              onClick={() => togglePanel("connect")}
              title="Connect"
              className={panelBtnClass("connect")}
            >
              <Plugs size={16} />
            </button>
            <button
              onClick={() => togglePanel("revisions")}
              title="History"
              className={panelBtnClass("revisions")}
            >
              <ClockCounterClockwise size={16} />
            </button>
            <button
              onClick={() => togglePanel("chat")}
              title="Assistant"
              className={panelBtnClass("chat")}
            >
              <ChatCircle size={16} />
            </button>
          </div>
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="rounded-full hover:opacity-80 transition-opacity"
            >
              <UserAvatar
                src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                size={26}
              />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-surface rounded-xl border border-border shadow-lg overflow-hidden z-50">
                <div className="px-4 py-2.5 border-b border-border">
                  <div className="text-sm font-medium text-text truncate">
                    {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                  </div>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); onBack(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <ArrowLeft size={16} className="text-text-muted" />
                  All workspaces
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); signOut(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors border-t border-border"
                >
                  <SignOut size={16} className="text-text-muted" />
                  Sign out
                </button>
              </div>
            )}
          </div>
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
            <div className="border-t border-border px-3 py-2 shrink-0">
              <button
                onClick={() => setShowShare(true)}
                className="flex items-center gap-2 w-full text-sm px-2 py-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
              >
                <GearSix size={15} />
                Settings
              </button>
            </div>
          </div>
        )}

        {/* Editor / Preview area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {openFilePath ? (
            <>
              <EditorToolbar
                editorViewRef={editorViewRef}
                showPreview={showPreview}
                onTogglePreview={() => setShowPreview(!showPreview)}
                projectId={projectId}
                filePath={openFilePath}
                onPlay={() => setShowAudioBar(true)}
              />
              {showPreview ? (
                <Preview content={fileContent ?? ""} filePath={openFilePath} />
              ) : (
                <Editor editorViewRef={editorViewRef} />
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <img src="/assets/logo.png" alt="Perchpad" className="h-10 w-auto mx-auto mb-3 opacity-40" />
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

        {/* Side panels — only one at a time */}
        {activePanel === "chat" && (
          <div className="w-80 border-l border-border bg-surface flex flex-col shrink-0">
            <ChatPanel />
          </div>
        )}

        {activePanel === "revisions" && (
          <div className="w-72 border-l border-border bg-surface flex flex-col shrink-0">
            <Revisions projectId={projectId} />
          </div>
        )}

        {activePanel === "connect" && (
          <div className="w-80 border-l border-border bg-surface flex flex-col shrink-0">
            <ConnectPanel projectId={projectId} />
          </div>
        )}

      </div>

      {/* Audio player bar */}
      {showAudioBar && <AudioBar onClose={() => setShowAudioBar(false)} />}

      {showShare && (
        <SettingsModal
          projectId={projectId}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
