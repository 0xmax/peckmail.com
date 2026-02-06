import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { CreateProjectModal } from "./CreateProjectModal.js";
import { InviteModal } from "./InviteModal.js";
import { GearSix, Notebook, SignOut, SpinnerGap } from "@phosphor-icons/react";
import { Skeleton, SkeletonLine, SkeletonCircle } from "./Skeleton.js";
import { UserAvatar } from "./UserAvatar.js";

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
  const menuRef = useRef<HTMLDivElement>(null);

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
        <div className="flex items-center justify-between mb-6">
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
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onOpenProject(project.id)}
                className="w-full flex items-center gap-4 bg-surface rounded-xl px-5 py-4 border border-border hover:border-accent/50 hover:shadow-sm transition-all group text-left"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-lg font-semibold"
                  style={{ background: projectColor(project.name), color: "#5a4a3a" }}
                >
                  {projectInitial(project.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-text group-hover:text-accent transition-colors">
                    {project.name}
                  </h3>
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
              </button>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            setShowCreate(false);
            onOpenProject(project.id);
          }}
        />
      )}
    </div>
  );
}
