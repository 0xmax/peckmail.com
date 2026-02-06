import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { CreateProjectModal } from "./CreateProjectModal.js";
import { InviteModal } from "./InviteModal.js";
import { UserAvatar } from "./UserAvatar.js";

interface Project {
  id: string;
  name: string;
  role: string;
  created_at: string;
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
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

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
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-2xl font-semibold text-text -tracking-[0.01em]">Perchpad</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <UserAvatar
              src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
              name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
              size={26}
            />
            <span className="text-sm text-text-muted">
              {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
            </span>
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="text-text-muted hover:text-text transition-colors"
              title="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          )}
          <button
            onClick={signOut}
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            Sign out
          </button>
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
          <div className="text-center text-text-muted py-12">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📝</div>
            <p className="text-text-muted text-lg mb-2">
              No workspaces yet
            </p>
            <p className="text-text-muted text-sm">
              Create your first workspace to start writing!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onOpenProject(project.id)}
                className="text-left bg-surface rounded-xl p-5 border border-border hover:border-accent hover:shadow-md transition-all group"
              >
                <h3 className="font-semibold text-text group-hover:text-accent transition-colors mb-1">
                  {project.name}
                </h3>
                <p className="text-xs text-text-muted">
                  {project.role === "owner" ? "Owner" : project.role === "editor" ? "Editor" : "Viewer"}
                  {" · "}
                  Created{" "}
                  {new Date(project.created_at).toLocaleDateString()}
                </p>
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
