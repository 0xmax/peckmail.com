import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { CreateProjectModal } from "./CreateProjectModal.js";
import { InviteModal } from "./InviteModal.js";
import { DotsThree, Envelope, File, GearSix, MagnifyingGlass, Notebook, PencilSimple, SignOut, SortAscending, SpinnerGap, Trash, UserPlus, X } from "@phosphor-icons/react";
import { Skeleton, SkeletonLine, SkeletonCircle } from "./Skeleton.js";
import { UserAvatar } from "./UserAvatar.js";
import { SettingsModal } from "./SettingsModal.js";
import type { ItemColor } from "../store/types.js";

const WORKSPACE_COLOR_HEX: Record<ItemColor, string> = {
  red: "#E8A8A0",
  orange: "#E8C0A0",
  yellow: "#E0CCA0",
  green: "#A8CCA8",
  blue: "#A0B8D0",
  purple: "#C0A8D0",
  gray: "#B8AEA4",
};

const WORKSPACE_COLORS: ItemColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];

const WS_COLORS_KEY = "perchpad:workspace-colors";

function loadWorkspaceColors(): Record<string, ItemColor> {
  try {
    return JSON.parse(localStorage.getItem(WS_COLORS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWorkspaceColors(colors: Record<string, ItemColor>) {
  localStorage.setItem(WS_COLORS_KEY, JSON.stringify(colors));
}

interface ProjectMember {
  user_id: string;
  role: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Project {
  id: string;
  name: string;
  role: string;
  description: string | null;
  created_at: string;
  members?: ProjectMember[];
}

const PASTEL_COLORS = [
  "#f5d0c5", "#e8d5b7", "#d4e4c1", "#c5dde8", "#d8c5e8",
  "#f5c5d0", "#c5e8d5", "#e8e4c5", "#c5d8e8", "#e8cfc5",
];

function projectColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PASTEL_COLORS[Math.abs(h) % PASTEL_COLORS.length];
}

function projectInitial(name: string): string {
  return (name[0] || "?").toUpperCase();
}

interface Invitation {
  id: string;
  project_id: string;
  projects: { name: string };
}

interface FileMatch {
  projectId: string;
  path: string;
  line: number;
  context: string;
}

function useFileSearch(query: string) {
  const [matches, setMatches] = useState<FileMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timeout = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await api.get<{ matches: FileMatch[] }>(
          `/api/files/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!controller.signal.aborted) {
          setMatches(data.matches);
        }
      } catch {
        if (!controller.signal.aborted) setMatches([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [query]);

  return { matches, searching };
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/20 text-text rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function ProjectList({
  onOpenProject,
  onOpenSettings,
}: {
  onOpenProject: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const { user, signOut, handle } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingSample, setCreatingSample] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "a-z" | "z-a">("newest");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [wsColors, setWsColors] = useState<Record<string, ItemColor>>(loadWorkspaceColors);
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const { matches: fileMatches, searching: fileSearching } = useFileSearch(search);
  const matchesByProject = useMemo(() => {
    const map = new Map<string, FileMatch[]>();
    for (const m of fileMatches) {
      const list = map.get(m.projectId) || [];
      list.push(m);
      map.set(m.projectId, list);
    }
    return map;
  }, [fileMatches]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close color menu on outside click
  useEffect(() => {
    if (!colorMenu) return;
    const handler = () => setColorMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorMenu]);

  // Close action menu on outside click
  useEffect(() => {
    if (!actionMenuId) return;
    const handler = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionMenuId]);

  const loadData = useCallback(async () => {
    try {
      const [projData, invData] = await Promise.all([
        api.get<{ projects: Project[] }>("/api/projects"),
        api.get<{ invitations: Invitation[] }>("/api/invitations"),
      ]);
      setProjects(projData.projects);
      setInvitations(invData.invitations);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSample = async () => {
    setCreatingSample(true);
    try {
      const data = await api.post<{ project: { id: string; name: string } }>(
        "/api/projects",
        { name: "My First Project" }
      );
      onOpenProject(data.project.id);
    } catch {
      setCreatingSample(false);
    }
  };

  const handleAcceptInvite = async (invId: string) => {
    try {
      await api.post(`/api/invitations/${invId}/accept`);
      await loadData();
    } catch {
      // Ignore
    }
  };

  const handleRename = async (projectId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      try {
        await api.patch(`/api/projects/${projectId}`, { name: trimmed });
        setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, name: trimmed } : p));
      } catch {
        // Ignore
      }
    }
    setRenamingId(null);
  };

  const handleDelete = async (projectId: string) => {
    setDeleting(true);
    try {
      await api.del(`/api/projects/${projectId}`);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch {
      // Ignore
    } finally {
      setDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || matchesByProject.has(p.id)
      );
    }
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "a-z": return a.name.localeCompare(b.name);
        case "z-a": return b.name.localeCompare(a.name);
        case "oldest": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "newest":
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return list;
  }, [projects, search, sort, matchesByProject]);

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="Perchpad" className="h-7 w-auto" />
          <h1 className="font-heading text-2xl font-semibold text-text -tracking-[0.01em]">Perchpad</h1>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity"
          >
            <UserAvatar
              src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
              name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
              size={32}
            />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-surface rounded-xl border border-border shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-medium text-text truncate">
                  {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                </div>
                {handle && (
                  <div className="text-xs text-text-muted truncate mt-0.5">@{handle}</div>
                )}
              </div>
              {onOpenSettings && (
                <button
                  onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                >
                  <GearSix size={16} className="text-text-muted" />
                  Settings
                </button>
              )}
              <a
                href="/contact"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
              >
                <Envelope size={16} className="text-text-muted" />
                Contact
              </a>
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors border-t border-border"
              >
                <SignOut size={16} className="text-text-muted" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-8">
        {/* Invitations */}
        {invitations.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-text mb-3">
              Pending invitations
            </h2>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between bg-surface rounded-xl p-4 border border-border"
                >
                  <span className="text-text">
                    You've been invited to{" "}
                    <strong>{inv.projects.name}</strong>
                  </span>
                  <button
                    onClick={() => handleAcceptInvite(inv.id)}
                    className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors text-sm"
                  >
                    Accept
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">
            Your workspaces
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors text-sm font-medium"
          >
            + New workspace
          </button>
        </div>

        {projects.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search workspaces and files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-surface border border-border rounded-xl text-sm text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50 transition-colors"
              />
              {fileSearching && (
                <SpinnerGap size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
              )}
            </div>
            <div className="relative">
              <SortAscending size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="appearance-none pl-8 pr-7 py-2 bg-surface border border-border rounded-xl text-sm text-text focus:outline-none focus:border-accent/50 transition-colors cursor-pointer"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="a-z">A — Z</option>
                <option value="z-a">Z — A</option>
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5l3 3 3-3" /></svg>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-full flex items-center gap-4 bg-surface rounded-xl px-5 py-4 border border-border"
              >
                <SkeletonCircle size={40} />
                <div className="flex-1 space-y-2">
                  <SkeletonLine className="w-1/3" />
                  <SkeletonLine className="w-1/2" />
                </div>
                <div className="flex -space-x-1.5">
                  <SkeletonCircle size={24} />
                  <SkeletonCircle size={24} />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <Notebook size={48} weight="duotone" className="mx-auto mb-4 text-text-muted" />
            <p className="text-text-muted text-lg mb-2">
              No workspaces yet
            </p>
            <p className="text-text-muted text-sm mb-5">
              Create your first workspace to start writing!
            </p>
            <button
              onClick={handleCreateSample}
              disabled={creatingSample}
              className="px-5 py-2.5 bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium inline-flex items-center gap-2"
            >
              {creatingSample ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                "Try the starter project"
              )}
            </button>
          </div>
        ) : (
          filteredProjects.length === 0 && !fileSearching ? (
            <div className="text-center py-12">
              <p className="text-text-muted text-sm">No workspaces match "{search}"</p>
            </div>
          ) : (
          <>
          {fileSearching && (
            <div className="flex items-center gap-2 mb-3 px-1">
              <SpinnerGap size={14} className="text-text-muted animate-spin" />
              <span className="text-xs text-text-muted">Searching files across all workspaces…</span>
            </div>
          )}
          <div className="space-y-2">
            {filteredProjects.map((project) => {
              const hits = matchesByProject.get(project.id);
              return (
                <div key={project.id}>
                  <div
                    onClick={() => { if (renamingId !== project.id) onOpenProject(project.id); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setColorMenu({ x: e.clientX, y: e.clientY, projectId: project.id });
                    }}
                    className="w-full flex items-center gap-4 bg-surface rounded-xl px-5 py-4 border border-border hover:border-accent/50 hover:shadow-sm transition-all group text-left cursor-pointer"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg font-semibold"
                      style={{
                        background: wsColors[project.id] ? WORKSPACE_COLOR_HEX[wsColors[project.id]] : projectColor(project.name),
                        color: "#5a4a3a",
                      }}
                    >
                      {projectInitial(project.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {renamingId === project.id ? (
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRename(project.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-text bg-transparent border-b border-accent/50 outline-none py-0 px-0 min-w-0 flex-1"
                            autoFocus
                          />
                        ) : (
                          <>
                            <h3 className="font-semibold text-text group-hover:text-accent transition-colors">
                              {project.name}
                            </h3>
                            {project.role === "owner" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingId(project.id);
                                  setRenameValue(project.name);
                                  setTimeout(() => renameInputRef.current?.select(), 0);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-text transition-all"
                                title="Rename"
                              >
                                <PencilSimple size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {project.description ? (
                        <p className="text-sm text-text-muted truncate">{project.description}</p>
                      ) : (
                        <p className="text-xs text-text-muted">
                          {project.role === "owner" ? "Owner" : project.role === "editor" ? "Editor" : "Viewer"}
                          {" · "}
                          Created{" "}
                          {new Date(project.created_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {project.members && project.members.length > 1 && (
                      <div className="flex items-center shrink-0 -space-x-1.5">
                        {project.members.slice(0, 4).map((m) => (
                          <UserAvatar
                            key={m.user_id}
                            src={m.avatar_url}
                            name={m.display_name}
                            size={24}
                            className="ring-2 ring-surface"
                          />
                        ))}
                        {project.members.length > 4 && (
                          <div
                            className="w-6 h-6 rounded-full bg-surface-alt text-text-muted flex items-center justify-center text-[10px] font-medium ring-2 ring-surface shrink-0"
                          >
                            +{project.members.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="relative shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionMenuId(actionMenuId === project.id ? null : project.id);
                        }}
                        className="p-1 rounded-lg text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-alt hover:text-text transition-all"
                      >
                        <DotsThree size={20} weight="bold" />
                      </button>
                      {actionMenuId === project.id && (
                        <div
                          ref={actionMenuRef}
                          className="absolute right-0 top-full mt-1 w-44 bg-surface rounded-xl border border-border shadow-lg overflow-hidden z-50"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionMenuId(null);
                              setShareProjectId(project.id);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                          >
                            <UserPlus size={15} className="text-text-muted" />
                            Share
                          </button>
                          {project.role === "owner" && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActionMenuId(null);
                                  setRenamingId(project.id);
                                  setRenameValue(project.name);
                                  setTimeout(() => renameInputRef.current?.select(), 0);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
                              >
                                <PencilSimple size={15} className="text-text-muted" />
                                Rename
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActionMenuId(null);
                                  setDeleteConfirmId(project.id);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-surface-alt transition-colors border-t border-border"
                              >
                                <Trash size={15} />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {hits && hits.length > 0 && (
                    <div className="ml-14 mt-1 mb-1 space-y-0.5">
                      {hits.map((hit, i) => (
                        <button
                          key={`${hit.path}:${hit.line}:${i}`}
                          onClick={() => onOpenProject(project.id)}
                          className="w-full flex items-start gap-2 px-3 py-1.5 rounded-lg text-left hover:bg-surface-alt transition-colors"
                        >
                          <File size={13} className="text-text-muted shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs text-text-muted">{hit.path}:{hit.line}</span>
                            <p className="text-xs text-text truncate">
                              <HighlightMatch text={hit.context} query={search.trim()} />
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
          )
        )}
      </div>

      {/* Workspace color picker */}
      {colorMenu && (
        <div
          className="fixed bg-surface border border-border rounded-xl shadow-lg py-2 px-3 z-50 flex items-center gap-1.5"
          style={{ left: colorMenu.x, top: colorMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {WORKSPACE_COLORS.map((c) => {
            const isActive = wsColors[colorMenu.projectId] === c;
            return (
              <button
                key={c}
                title={c}
                onClick={() => {
                  const next = { ...wsColors };
                  if (isActive) {
                    delete next[colorMenu.projectId];
                  } else {
                    next[colorMenu.projectId] = c;
                  }
                  setWsColors(next);
                  saveWorkspaceColors(next);
                  setColorMenu(null);
                }}
                className="item-color-swatch"
                style={{
                  backgroundColor: WORKSPACE_COLOR_HEX[c],
                  boxShadow: isActive ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${WORKSPACE_COLOR_HEX[c]}` : undefined,
                }}
              />
            );
          })}
          {wsColors[colorMenu.projectId] && (
            <button
              title="Clear color"
              onClick={() => {
                const next = { ...wsColors };
                delete next[colorMenu.projectId];
                setWsColors(next);
                saveWorkspaceColors(next);
                setColorMenu(null);
              }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:text-text transition-colors"
            >
              <X size={10} weight="bold" />
            </button>
          )}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            setShowCreate(false);
            onOpenProject(project.id);
          }}
        />
      )}

      {shareProjectId && (
        <SettingsModal
          projectId={shareProjectId}
          onClose={() => setShareProjectId(null)}
          onLeave={() => {
            setShareProjectId(null);
            loadData();
          }}
        />
      )}

      {deleteConfirmId && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteConfirmId(null); }}
        >
          <div className="bg-surface rounded-2xl p-6 w-full max-w-sm border border-border shadow-xl">
            <h2 className="text-lg font-semibold text-text mb-2">Delete workspace</h2>
            <p className="text-sm text-text-muted mb-5">
              Are you sure you want to delete <strong>{projects.find((p) => p.id === deleteConfirmId)?.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                disabled={deleting}
                className="px-4 py-2 bg-danger text-white rounded-xl hover:bg-danger-hover disabled:opacity-50 transition-colors text-sm font-medium"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
