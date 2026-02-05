import { useState, useCallback } from "react";
import { useTree, useOpenFile, useStoreDispatch, useLoadFileContent } from "../store/StoreContext.js";
import type { FileNode } from "../store/types.js";

function FileIcon({ type }: { type: "file" | "directory" }) {
  if (type === "directory") {
    return <span className="text-accent">📁</span>;
  }
  return <span className="text-text-muted">📄</span>;
}

function TreeItem({
  node,
  depth,
  onSelect,
  selectedPath,
  onContextMenu,
}: {
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;

  const handleClick = () => {
    if (node.type === "directory") {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  // Display name without extension for files
  const displayName =
    node.type === "file" ? node.name.replace(/\.[^.]+$/, "") : node.name;

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        className={`w-full text-left flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm transition-colors ${
          isSelected
            ? "bg-surface-alt text-accent"
            : "text-text hover:bg-surface-alt"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.type === "directory" && (
          <span
            className={`text-xs text-text-muted transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
        )}
        <FileIcon type={node.type} />
        <span className="truncate">{displayName}</span>
      </button>
      {node.type === "directory" && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { tree, loading: treeLoading } = useTree();
  const { path: openFilePath } = useOpenFile();
  const dispatch = useStoreDispatch();
  const loadFileContent = useLoadFileContent();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState("");
  const [showRename, setShowRename] = useState<FileNode | null>(null);
  const [renameName, setRenameName] = useState("");

  const openFile = useCallback(
    (path: string) => {
      loadFileContent(path);
    },
    [loadFileContent]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    []
  );

  const closeContextMenu = () => setContextMenu(null);

  const handleNewFile = () => {
    if (!newName.trim()) return;
    const name = newName.trim().endsWith(".md")
      ? newName.trim()
      : `${newName.trim()}.md`;
    const content = `# ${newName.trim().replace(/\.md$/, "")}\n\n`;
    dispatch({ type: "file:create", path: name, content });
    setShowNewFile(false);
    setNewName("");
    // Open the newly created file
    dispatch({ type: "file:open", path: name, content });
  };

  const handleNewFolder = () => {
    if (!newName.trim()) return;
    dispatch({ type: "file:mkdir", path: newName.trim() });
    setShowNewFolder(false);
    setNewName("");
  };

  const handleRename = () => {
    if (!showRename || !renameName.trim()) return;
    const newPath =
      showRename.path.includes("/")
        ? showRename.path.replace(/[^/]+$/, renameName.trim())
        : renameName.trim();
    dispatch({ type: "file:rename", from: showRename.path, to: newPath });
    setShowRename(null);
    setRenameName("");
  };

  const handleDelete = (path: string) => {
    dispatch({ type: "file:delete", path });
  };

  return (
    <div
      className="flex flex-col h-full"
      onClick={closeContextMenu}
    >
      {/* Header with actions */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Pages
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              setShowNewFile(true);
              setShowNewFolder(false);
              setNewName("");
            }}
            className="text-text-muted hover:text-accent transition-colors p-1"
            title="New page"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => {
              setShowNewFolder(true);
              setShowNewFile(false);
              setNewName("");
            }}
            className="text-text-muted hover:text-accent transition-colors p-1"
            title="New folder"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* New file/folder input */}
      {(showNewFile || showNewFolder) && (
        <div className="p-2 border-b border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              showNewFile ? handleNewFile() : handleNewFolder();
            }}
          >
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                setShowNewFile(false);
                setShowNewFolder(false);
              }}
              placeholder={showNewFile ? "Page name..." : "Folder name..."}
              className="w-full text-sm py-1.5 px-2 bg-bg border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-text placeholder-text-muted"
            />
          </form>
        </div>
      )}

      {/* Rename input */}
      {showRename && (
        <div className="p-2 border-b border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRename();
            }}
          >
            <input
              autoFocus
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={() => setShowRename(null)}
              placeholder="New name..."
              className="w-full text-sm py-1.5 px-2 bg-bg border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent text-text placeholder-text-muted"
            />
          </form>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 && !treeLoading ? (
          <div className="text-center py-6 text-text-muted text-sm">
            <p>No pages yet</p>
            <p className="mt-1">Create your first one!</p>
          </div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              onSelect={openFile}
              selectedPath={openFilePath}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && contextMenu.node && (
        <div
          className="fixed bg-surface border border-border rounded-xl shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.node!.type === "file" && (
            <button
              onClick={() => {
                openFile(contextMenu.node!.path);
                // Small delay so file content loads before TTS triggers
                setTimeout(() => {
                  dispatch({ type: "tts:play-from", fromLine: 1 });
                }, 300);
                closeContextMenu();
              }}
              className="w-full text-left px-4 py-2 text-sm text-text hover:bg-surface-alt transition-colors flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                <path d="M4.5 2v12l9-6z" />
              </svg>
              Read aloud
            </button>
          )}
          <button
            onClick={() => {
              setShowRename(contextMenu.node);
              setRenameName(contextMenu.node!.name);
              closeContextMenu();
            }}
            className="w-full text-left px-4 py-2 text-sm text-text hover:bg-surface-alt transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  `Delete "${contextMenu.node!.name}"?`
                )
              ) {
                handleDelete(contextMenu.node!.path);
              }
              closeContextMenu();
            }}
            className="w-full text-left px-4 py-2 text-sm text-danger hover:bg-surface-alt transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
