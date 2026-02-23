import { useState, useCallback, useMemo } from "react";
import { useTree, useOpenFile, useStoreDispatch, useLoadFileContent, useProjectSettings } from "../store/StoreContext.js";
import type { FileNode, ItemColor } from "../store/types.js";
import type { PresenceUser } from "../hooks/usePresence.js";
import { File, Folder, FolderPlus, Plus, CaretRight, Play, ChatCircle, X } from "@phosphor-icons/react";

const ITEM_COLOR_HEX: Record<ItemColor, string> = {
  red: "#E8A8A0",
  orange: "#E8C0A0",
  yellow: "#E0CCA0",
  green: "#A8CCA8",
  blue: "#A0B8D0",
  purple: "#C0A8D0",
  gray: "#B8AEA4",
};

const ITEM_COLORS: ItemColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];

function joinPath(parent: string | null, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function pathExists(tree: FileNode[], path: string): boolean {
  return findNodeByPath(tree, path) !== null;
}

function findNodeByPath(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.type === "directory" && node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function makeUniqueFilePath(tree: FileNode[], parentDir: string | null): string {
  let index = 1;
  while (true) {
    const fileName = index === 1 ? "new.md" : `new-${index}.md`;
    const candidate = joinPath(parentDir, fileName);
    if (!pathExists(tree, candidate)) return candidate;
    index += 1;
  }
}

function fileContentFromPath(path: string): string {
  const fileName = path.split("/").pop() || "new.md";
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const title = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  return `# ${title}\n\n`;
}

function FileIcon({ type }: { type: "file" | "directory" }) {
  if (type === "directory") {
    return <Folder size={16} weight="duotone" className="text-primary shrink-0" />;
  }
  return <File size={16} className="text-muted-foreground shrink-0" />;
}

function TreeItem({
  node,
  depth,
  onSelect,
  selectedPath,
  onContextMenu,
  onDragFileStart,
  onDragFileEnd,
  onDragOverDirectory,
  onDropOnDirectory,
  dragOverDirectoryPath,
  presencesByFile,
  itemColors,
}: {
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onDragFileStart: (path: string) => void;
  onDragFileEnd: () => void;
  onDragOverDirectory: (path: string | null) => void;
  onDropOnDirectory: (toDirPath: string) => void;
  dragOverDirectoryPath: string | null;
  presencesByFile: Map<string, PresenceUser[]>;
  itemColors: Record<string, ItemColor>;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;
  const isDropTarget = node.type === "directory" && dragOverDirectoryPath === node.path;
  const itemColor = itemColors[node.path];

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

  const filePresence = node.type === "file" ? presencesByFile.get(node.path) : undefined;

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, node)}
        draggable={node.type === "file"}
        onDragStart={(e) => {
          if (node.type !== "file") return;
          e.dataTransfer.setData("text/plain", node.path);
          e.dataTransfer.effectAllowed = "move";
          onDragFileStart(node.path);
        }}
        onDragEnd={() => {
          onDragFileEnd();
          onDragOverDirectory(null);
        }}
        onDragOver={(e) => {
          if (node.type !== "directory") return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOverDirectory(node.path);
        }}
        onDragLeave={() => {
          if (node.type !== "directory") return;
          onDragOverDirectory(null);
        }}
        onDrop={(e) => {
          if (node.type !== "directory") return;
          e.preventDefault();
          e.stopPropagation();
          onDropOnDirectory(node.path);
          onDragOverDirectory(null);
        }}
        className={`w-full text-left flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm transition-colors ${
          isSelected
            ? "bg-muted text-primary"
            : "text-foreground hover:bg-muted"
        } ${isDropTarget ? "ring-1 ring-primary/40 bg-primary/10" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.type === "directory" ? (
          <CaretRight
            size={12}
            weight="bold"
            className={`text-muted-foreground transition-transform shrink-0 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIcon type={node.type} />
        <span className="truncate flex-1">{displayName}</span>
        {itemColor && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 ml-auto"
            style={{ backgroundColor: ITEM_COLOR_HEX[itemColor] }}
          />
        )}
        {filePresence && filePresence.length > 0 && (
          <span className="flex items-center -space-x-1 shrink-0 ml-auto">
            {filePresence.slice(0, 3).map((u) => (
              <span
                key={u.userId}
                title={u.displayName}
                className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white ring-1 ring-card"
                style={{ backgroundColor: u.color }}
              >
                {u.displayName[0]?.toUpperCase()}
              </span>
            ))}
          </span>
        )}
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
              onDragFileStart={onDragFileStart}
              onDragFileEnd={onDragFileEnd}
              onDragOverDirectory={onDragOverDirectory}
              onDropOnDirectory={onDropOnDirectory}
              dragOverDirectoryPath={dragOverDirectoryPath}
              presencesByFile={presencesByFile}
              itemColors={itemColors}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ presenceUsers = [] }: { presenceUsers?: PresenceUser[] }) {
  const { tree, loading: treeLoading } = useTree();
  const { path: openFilePath } = useOpenFile();
  const dispatch = useStoreDispatch();
  const loadFileContent = useLoadFileContent();
  const projectSettings = useProjectSettings();
  const itemColors = projectSettings.itemColors ?? {};

  const presencesByFile = useMemo(() => {
    const map = new Map<string, PresenceUser[]>();
    for (const u of presenceUsers) {
      if (!u.openFilePath) continue;
      const list = map.get(u.openFilePath);
      if (list) list.push(u);
      else map.set(u.openFilePath, [u]);
    }
    return map;
  }, [presenceUsers]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showRename, setShowRename] = useState<FileNode | null>(null);
  const [renameName, setRenameName] = useState("");
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [dragOverDirectoryPath, setDragOverDirectoryPath] = useState<string | null>(null);

  const openFile = useCallback(
    (path: string) => {
      loadFileContent(path);
    },
    [loadFileContent]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    []
  );

  const closeContextMenu = () => setContextMenu(null);

  const createNewFile = (parentDir: string | null) => {
    const path = makeUniqueFilePath(tree, parentDir);
    const content = fileContentFromPath(path);
    dispatch({ type: "file:create", path, content });
    dispatch({ type: "file:open", path, content });
  };

  const handleNewFolder = () => {
    if (!newName.trim()) return;
    dispatch({ type: "file:mkdir", path: joinPath(newFolderParent, newName.trim()) });
    setShowNewFolder(false);
    setNewFolderParent(null);
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

  const handleMoveFileToDirectory = (fromPath: string, toDirPath: string) => {
    const fileName = fromPath.split("/").pop();
    if (!fileName) return;

    const targetPath = joinPath(toDirPath, fileName);
    if (targetPath === fromPath) return;
    if (pathExists(tree, targetPath)) {
      alert(`A file named "${fileName}" already exists in that folder.`);
      return;
    }
    dispatch({ type: "file:rename", from: fromPath, to: targetPath });
  };

  return (
    <div
      className="flex flex-col h-full"
      onClick={closeContextMenu}
    >
      {/* Header with actions */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Pages
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              createNewFile(null);
            }}
            className="text-muted-foreground hover:text-primary transition-colors p-1"
            title="New page"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => {
              setShowNewFolder(true);
              setNewFolderParent(null);
              setNewName("");
            }}
            className="text-muted-foreground hover:text-primary transition-colors p-1"
            title="New folder"
          >
            <FolderPlus size={16} />
          </button>
        </div>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="p-2 border-b border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNewFolder();
            }}
          >
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                setShowNewFolder(false);
                setNewFolderParent(null);
              }}
              placeholder="Folder name..."
              className="w-full text-sm py-1.5 px-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder-muted-foreground"
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
              className="w-full text-sm py-1.5 px-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder-muted-foreground"
            />
          </form>
        </div>
      )}

      {/* File tree */}
      <div
        className="flex-1 overflow-y-auto p-2"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, node: null });
        }}
      >
        {tree.length === 0 && !treeLoading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
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
              onDragFileStart={(path) => setDraggingFilePath(path)}
              onDragFileEnd={() => {
                setDraggingFilePath(null);
                setDragOverDirectoryPath(null);
              }}
              onDragOverDirectory={setDragOverDirectoryPath}
              onDropOnDirectory={(toDirPath) => {
                if (draggingFilePath) {
                  handleMoveFileToDirectory(draggingFilePath, toDirPath);
                }
                setDraggingFilePath(null);
                setDragOverDirectoryPath(null);
              }}
              dragOverDirectoryPath={dragOverDirectoryPath}
              presencesByFile={presencesByFile}
              itemColors={itemColors}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-card border border-border rounded-xl shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(contextMenu.node === null || contextMenu.node.type === "directory") && (
            <button
              onClick={() => {
                createNewFile(contextMenu.node?.path ?? null);
                closeContextMenu();
              }}
              className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              New page
            </button>
          )}
          {(contextMenu.node === null || contextMenu.node.type === "directory") && (
            <button
              onClick={() => {
                setShowNewFolder(true);
                setNewFolderParent(contextMenu.node?.path ?? null);
                setNewName("");
                closeContextMenu();
              }}
              className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              New folder
            </button>
          )}
          {contextMenu.node?.type === "file" && (
            <>
              <button
                onClick={() => {
                  openFile(contextMenu.node.path);
                  // Small delay so file content loads before TTS triggers
                  setTimeout(() => {
                    dispatch({ type: "tts:play-from", fromLine: 1 });
                  }, 300);
                  closeContextMenu();
                }}
                className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <Play size={14} weight="fill" className="shrink-0" />
                Read aloud
              </button>
              <button
                onClick={() => {
                  dispatch({ type: "chat:prompt", message: `Summarize the ${contextMenu.node.name} file` });
                  closeContextMenu();
                }}
                className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <ChatCircle size={14} className="shrink-0" />
                Quick summary
              </button>
            </>
          )}
          {contextMenu.node && (
            <>
              <div className="px-3 py-2 flex items-center gap-1.5 border-b border-border">
                {ITEM_COLORS.map((c) => {
                  const isActive = itemColors[contextMenu.node.path] === c;
                  return (
                    <button
                      key={c}
                      title={c}
                      onClick={() => {
                        dispatch({
                          type: "settings:set-item-color",
                          path: contextMenu.node!.path,
                          color: isActive ? null : c,
                        });
                        closeContextMenu();
                      }}
                      className="item-color-swatch"
                      style={{
                        backgroundColor: ITEM_COLOR_HEX[c],
                        boxShadow: isActive ? `0 0 0 2px var(--color-card), 0 0 0 3.5px ${ITEM_COLOR_HEX[c]}` : undefined,
                      }}
                    />
                  );
                })}
                {itemColors[contextMenu.node.path] && (
                  <button
                    title="Clear color"
                    onClick={() => {
                      dispatch({
                        type: "settings:set-item-color",
                        path: contextMenu.node!.path,
                        color: null,
                      });
                      closeContextMenu();
                    }}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X size={10} weight="bold" />
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  setShowRename(contextMenu.node);
                  setRenameName(contextMenu.node!.name);
                  closeContextMenu();
                }}
                className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
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
                    handleDelete(contextMenu.node.path);
                  }
                  closeContextMenu();
                }}
                className="w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
