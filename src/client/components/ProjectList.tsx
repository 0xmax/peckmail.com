import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { CreateProjectModal } from "./CreateProjectModal.js";
import { InviteModal } from "./InviteModal.js";
import { ArrowRight, DotsThree, Envelope, File, GearSix, MagnifyingGlass, Notebook, PencilSimple, Plugs, SignOut, SortAscending, SpinnerGap, Trash, UserPlus, X } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton.js";
import { UserAvatar } from "./UserAvatar.js";
import { SettingsModal } from "./SettingsModal.js";
import type { ItemColor } from "../store/types.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { ThemeToggle } from "./ThemeToggle.js";

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

const WS_COLORS_KEY = "peckmail:workspace-colors";

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
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
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
  const [creatingSample, setCreatingSample] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "a-z" | "z-a">("newest");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [wsColors, setWsColors] = useState<Record<string, ItemColor>>(loadWorkspaceColors);
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // Close color menu on outside click
  useEffect(() => {
    if (!colorMenu) return;
    const handler = () => setColorMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorMenu]);

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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo.png" alt="Peckmail" className="h-7 w-auto" />
          <h1 className="text-2xl font-semibold text-foreground -tracking-[0.01em]">Peckmail</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity"
              >
                <UserAvatar
                  src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                  name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                  size={32}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium text-foreground truncate">
                  {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                </div>
                {handle && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">@{handle}</div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {onOpenSettings && (
                <DropdownMenuItem onClick={() => onOpenSettings()}>
                  <GearSix size={16} className="text-muted-foreground" />
                  Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href="/contact">
                  <Envelope size={16} className="text-muted-foreground" />
                  Contact
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

      <div className="max-w-4xl mx-auto p-8">
        {/* Invitations */}
        {invitations.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">
              Pending invitations
            </h2>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between bg-card rounded-xl p-4 border border-border"
                >
                  <span className="text-foreground">
                    You've been invited to{" "}
                    <strong>{inv.projects.name}</strong>
                  </span>
                  <Button onClick={() => handleAcceptInvite(inv.id)}>
                    Accept
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Your workspaces
          </h2>
          <Button onClick={() => setShowCreate(true)}>
            + New workspace
          </Button>
        </div>

        {projects.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search workspaces and files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-8"
              />
              {fileSearching && (
                <SpinnerGap size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
              )}
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="w-auto gap-1.5">
                <SortAscending size={15} className="text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="a-z">A — Z</SelectItem>
                <SelectItem value="z-a">Z — A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-full flex items-center gap-4 bg-card rounded-xl px-5 py-4 border border-border"
              >
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3 rounded-full" />
                  <Skeleton className="h-3 w-1/2 rounded-full" />
                </div>
                <div className="flex -space-x-1.5">
                  <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                  <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <Notebook size={48} weight="duotone" className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground text-lg mb-2">
              No workspaces yet
            </p>
            <p className="text-muted-foreground text-sm mb-5">
              Create your first workspace to start writing!
            </p>
            <Button
              onClick={handleCreateSample}
              disabled={creatingSample}
            >
              {creatingSample ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                "Try the starter project"
              )}
            </Button>
          </div>
        ) : (
          filteredProjects.length === 0 && !fileSearching ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">No workspaces match "{search}"</p>
            </div>
          ) : (
          <>
          {fileSearching && (
            <div className="flex items-center gap-2 mb-3 px-1">
              <SpinnerGap size={14} className="text-muted-foreground animate-spin" />
              <span className="text-xs text-muted-foreground">Searching files across all workspaces…</span>
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
                    className="w-full flex items-center gap-4 bg-card rounded-xl px-5 py-4 border border-border hover:border-primary/50 hover:shadow-sm transition-all group text-left cursor-pointer"
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
                            className="font-semibold text-foreground bg-transparent border-b border-primary/50 outline-none py-0 px-0 min-w-0 flex-1"
                            autoFocus
                          />
                        ) : (
                          <>
                            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {project.name}
                            </h3>
                            {project.role === "owner" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingId(project.id);
                                  setRenameValue(project.name);
                                  setTimeout(() => renameInputRef.current?.select(), 0);
                                }}
                                className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-foreground"
                                title="Rename"
                              >
                                <PencilSimple size={13} />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                      {project.description ? (
                        <p className="text-sm text-muted-foreground truncate">{project.description}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
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
                            className="ring-2 ring-card"
                          />
                        ))}
                        {project.members.length > 4 && (
                          <div
                            className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-medium ring-2 ring-card shrink-0"
                          >
                            +{project.members.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="relative shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all"
                          >
                            <DotsThree size={20} weight="bold" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => setShareProjectId(project.id)}>
                            <UserPlus size={15} className="text-muted-foreground" />
                            Share
                          </DropdownMenuItem>
                          {project.role === "owner" && (
                            <>
                              <DropdownMenuItem onClick={() => {
                                setRenamingId(project.id);
                                setRenameValue(project.name);
                                setTimeout(() => renameInputRef.current?.select(), 0);
                              }}>
                                <PencilSimple size={15} className="text-muted-foreground" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteConfirmId(project.id)}
                              >
                                <Trash size={15} />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {hits && hits.length > 0 && (
                    <div className="ml-14 mt-1 mb-1 space-y-0.5">
                      {hits.map((hit, i) => (
                        <button
                          key={`${hit.path}:${hit.line}:${i}`}
                          onClick={() => onOpenProject(project.id)}
                          className="w-full flex items-start gap-2 px-3 py-1.5 rounded-lg text-left hover:bg-muted transition-colors"
                        >
                          <File size={13} className="text-muted-foreground shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs text-muted-foreground">{hit.path}:{hit.line}</span>
                            <p className="text-xs text-foreground truncate">
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

        {onOpenSettings && (
          <section className="mt-8">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Plugs size={18} weight="duotone" className="text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground mb-1">Connect with Claude</h2>
                    <p className="text-sm text-muted-foreground">
                      Set up Claude Desktop or Claude Code from Settings to connect directly to your workspaces.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={onOpenSettings} className="shrink-0">
                  Open settings
                  <ArrowRight size={14} className="text-muted-foreground" />
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Workspace color picker */}
      {colorMenu && (
        <div
          className="fixed bg-card border border-border rounded-xl shadow-lg py-2 px-3 z-50 flex items-center gap-1.5"
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
                  boxShadow: isActive ? `0 0 0 2px var(--color-card), 0 0 0 3.5px ${WORKSPACE_COLOR_HEX[c]}` : undefined,
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
              className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
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

      <Dialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{projects.find((p) => p.id === deleteConfirmId)?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
