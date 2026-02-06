import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { UserAvatar } from "./UserAvatar.js";
import { SkeletonLine, SkeletonCircle } from "./Skeleton.js";

interface Member {
  user_id: string;
  role: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

const ROLE_OPTIONS = [
  { value: "viewer", label: "Read" },
  { value: "editor", label: "Read & Write" },
  { value: "owner", label: "Admin" },
];

export function MembersPanel({ projectId }: { projectId: string }) {
  const { session, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const currentUserId = user?.id;
  const isOwner = members.some(
    (m) => m.user_id === currentUserId && m.role === "owner"
  );

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    api
      .get<{ members: Member[] }>(`/api/projects/${projectId}/members`)
      .then((d) => setMembers(d.members))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, session]);

  async function changeRole(userId: string, role: string) {
    try {
      await api.put(`/api/projects/${projectId}/members/${userId}`, { role });
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role } : m))
      );
    } catch (err: any) {
      console.error("Failed to change role:", err.message);
    }
  }

  async function removeMember(userId: string) {
    try {
      await api.del(`/api/projects/${projectId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err: any) {
      console.error("Failed to remove member:", err.message);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text">Members</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <SkeletonCircle size={30} />
                <div className="flex-1 space-y-1.5">
                  <SkeletonLine className="w-2/3" />
                  <SkeletonLine className="w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-alt transition-colors group"
              >
                <UserAvatar
                  src={m.profiles?.avatar_url}
                  name={m.profiles?.display_name}
                  size={30}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">
                    {m.profiles?.display_name || "Unknown"}
                    {isSelf && (
                      <span className="text-text-muted ml-1">(you)</span>
                    )}
                  </div>
                  {isOwner && !isSelf ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.user_id, e.target.value)}
                      className="text-xs text-text-muted bg-transparent border border-border rounded px-1 py-0.5 cursor-pointer hover:border-accent/50 focus:outline-none focus:border-accent"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-text-muted">
                      {ROLE_OPTIONS.find((o) => o.value === m.role)?.label ||
                        m.role}
                    </div>
                  )}
                </div>
                {isOwner && !isSelf && (
                  <button
                    onClick={() => removeMember(m.user_id)}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all p-1"
                    title="Remove member"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
