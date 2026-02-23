import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  useOpenFile,
  useConnected,
  useProjectId,
  useProjectName,
  useRenameProject,
  useLoadFileContent,
  useTree,
  useChatPrompt,
} from "../store/StoreContext.js";
import type { FileNode } from "../store/types.js";
import { Editor } from "./Editor.js";
import { Preview } from "./Preview.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { ChatPanel } from "./ChatPanel.js";
import { Revisions } from "./Revisions.js";
import { ConnectPanel } from "./ConnectPanel.js";
import { SaveIndicator } from "./SaveIndicator.js";
import { UserAvatar } from "./UserAvatar.js";
import { SettingsModal } from "./SettingsModal.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { useAuth } from "../context/AuthContext.js";
import { usePresence } from "../hooks/usePresence.js";
import { ArrowLeft, ClockCounterClockwise, ChatCircle, Plugs, GearSix, SignOut, Users, Envelope, XLogo } from "@phosphor-icons/react";

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

export function Workspace({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const { path: openFilePath, content: fileContent } = useOpenFile();
  const { tree, loading: treeLoading } = useTree();
  const connected = useConnected();
  const projectId = useProjectId();
  const projectName = useProjectName();
  const renameProject = useRenameProject();
  const loadFileContent = useLoadFileContent();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [showShare, setShowShare] = useState(false);
  const chatPrompt = useChatPrompt();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { user, signOut, handle } = useAuth();
  const { onlineUsers } = usePresence(projectId, user, openFilePath);
  const editorViewRef = useRef<EditorView | null>(null);
  const modeStorageKey = useMemo(
    () => `peckmail:view-mode:${projectId}`,
    [projectId]
  );
  const [showPreview, setShowPreview] = useState(() => {
    try {
      return window.localStorage.getItem(`peckmail:view-mode:${projectId}`) === MODE_PREVIEW;
    } catch {
      return false;
    }
  });
  const [panelWidth, setPanelWidth] = useState(() => {
    try { return Number(localStorage.getItem("peckmail:panel-w")) || 320; } catch { return 320; }
  });
  const openFilePathRef = useRef<string | null>(openFilePath);
  const loadFileContentRef = useRef(loadFileContent);

  const togglePanel = (panel: Panel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

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
        window.localStorage.setItem(`peckmail:last-file:${projectId}`, openFilePath);
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
      const lastFile = window.localStorage.getItem(`peckmail:last-file:${projectId}`);
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

  // --- Resize helpers ---
  const startResize = (
    setter: (w: number) => void,
    storageKey: string,
    min: number,
    max: number,
    direction: "left" | "right",
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const el = (e.target as HTMLElement).parentElement!;
    const startW = el.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const delta = direction === "right"
        ? ev.clientX - startX
        : startX - ev.clientX;
      const next = Math.min(max, Math.max(min, startW + delta));
      setter(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(storageKey, String(el.getBoundingClientRect().width)); } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

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
          <SaveIndicator projectId={projectId} />
        </div>
        <div className="absolute left-1/2 -translate-x-1/2">
          {editingName ? (
            <input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={async () => {
                const trimmed = draftName.trim();
                if (trimmed && trimmed !== projectName) await renameProject(trimmed);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="text-sm font-medium text-text bg-transparent border-b border-accent/50 outline-none text-center px-1 py-0.5 min-w-[120px]"
            />
          ) : (
            <button
              onClick={() => { setDraftName(projectName); setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 0); }}
              className="text-sm font-medium text-text-muted hover:text-text transition-colors truncate max-w-[200px]"
              title="Click to rename workspace"
            >
              {projectName || "Untitled"}
            </button>
          )}
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
          <PresenceAvatars users={onlineUsers} />
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
              <div className="absolute right-0 top-full mt-2 w-56 bg-surface rounded-xl border border-border shadow-lg overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-border">
                  <div className="text-sm font-medium text-text truncate">
                    {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                  </div>
                  {handle && (
                    <div className="text-xs text-text-muted truncate mt-0.5">@{handle}</div>
                  )}
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); onBack(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <ArrowLeft size={16} className="text-text-muted" />
                  All workspaces
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); onOpenSettings(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <GearSix size={16} className="text-text-muted" />
                  Settings
                </button>
                <a
                  href="/contact"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <Envelope size={16} className="text-text-muted" />
                  Contact
                </a>
                <a
                  href="https://x.com/peckmail"
                  target="_blank"
                  rel="noopener"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <XLogo size={16} className="text-text-muted" />
                  Follow on X
                </a>
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
                <img src="/assets/logo.png" alt="Peckmail" className="h-10 w-auto mx-auto mb-3 opacity-40" />
                <p className="text-text-muted">
                  Select a page to start editing
                </p>
                <p className="text-text-muted text-sm mt-1">
                  create a page from chat or project settings
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Side panels — only one at a time */}
        {activePanel && (
          <div
            className="border-l border-border bg-surface flex flex-col shrink-0 relative"
            style={{ width: panelWidth }}
          >
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10"
              onMouseDown={startResize(setPanelWidth, "peckmail:panel-w", 260, 600, "left")}
            />
            {activePanel === "chat" && <ChatPanel />}
            {activePanel === "revisions" && <Revisions projectId={projectId} />}
            {activePanel === "connect" && <ConnectPanel projectId={projectId} projectName={projectName} />}
          </div>
        )}

      </div>

      {showShare && (
        <SettingsModal
          projectId={projectId}
          onClose={() => setShowShare(false)}
          onLeave={() => { setShowShare(false); onBack(); }}
        />
      )}
    </div>
  );
}
