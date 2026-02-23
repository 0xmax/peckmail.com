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
import { ConnectPanel } from "./ConnectPanel.js";
import { UserAvatar } from "./UserAvatar.js";
import { SettingsModal } from "./SettingsModal.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { useAuth } from "../context/AuthContext.js";
import { usePresence } from "../hooks/usePresence.js";
import { ArrowLeft, ChatCircle, Plugs, GearSix, SignOut, Users, Envelope, XLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu.js";
import { ThemeToggle } from "./ThemeToggle.js";

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

type Panel = "connect" | "chat" | null;

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
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="bg-card border-b border-border px-4 py-2 flex items-center justify-between shrink-0 relative">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft size={14} weight="bold" className="inline" /> Back
          </Button>
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
              className="text-sm font-medium text-foreground bg-transparent border-b border-primary/50 outline-none text-center px-1 py-0.5 min-w-[120px]"
            />
          ) : (
            <button
              onClick={() => { setDraftName(projectName); setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 0); }}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
              title="Click to rename workspace"
            >
              {projectName || "Untitled"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!connected && (
            <span className="text-xs text-destructive px-2 py-1 bg-red-50 dark:bg-red-950 rounded-full">
              Reconnecting...
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowShare(true)}
            title="Share workspace"
          >
            <Users size={16} />
          </Button>
          <PresenceAvatars users={onlineUsers} />
          {/* Panel toggle buttons */}
          <div className="flex items-center gap-px bg-muted/50 rounded-xl p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 rounded-lg ${
                activePanel === "connect"
                  ? "text-primary hover:text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => togglePanel("connect")}
              title="Connect"
            >
              <Plugs size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 rounded-lg ${
                activePanel === "chat"
                  ? "text-primary hover:text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => togglePanel("chat")}
              title="Assistant"
            >
              <ChatCircle size={16} />
            </Button>
          </div>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full hover:opacity-80 transition-opacity">
                <UserAvatar
                  src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                  name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                  size={26}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-sm font-medium text-foreground truncate">
                  {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                </div>
                {handle && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5 font-normal">@{handle}</div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onBack()}>
                <ArrowLeft size={16} className="text-muted-foreground" />
                All workspaces
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenSettings()}>
                <GearSix size={16} className="text-muted-foreground" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/contact">
                  <Envelope size={16} className="text-muted-foreground" />
                  Contact
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="https://x.com/peckmail" target="_blank" rel="noopener">
                  <XLogo size={16} className="text-muted-foreground" />
                  Follow on X
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()}>
                <SignOut size={16} className="text-muted-foreground" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                <p className="text-muted-foreground">
                  Select a page to start editing
                </p>
                <p className="text-muted-foreground text-sm mt-1">
                  create a page from chat or project settings
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Side panels — only one at a time */}
        {activePanel && (
          <div
            className="border-l border-border bg-card flex flex-col shrink-0 relative"
            style={{ width: panelWidth }}
          >
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
              onMouseDown={startResize(setPanelWidth, "peckmail:panel-w", 260, 600, "left")}
            />
            {activePanel === "chat" && <ChatPanel />}
            {activePanel === "connect" && <ConnectPanel projectId={projectId} />}
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
