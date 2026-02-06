import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import { UserAvatar } from "./UserAvatar.js";

interface Member {
  user_id: string;
  role: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Admin",
  editor: "Read & Write",
  viewer: "Read",
};

export function MembersPanel({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ members: Member[] }>(`/api/projects/${projectId}/members`)
      .then((d) => setMembers(d.members))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text">Members</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {loading ? (
          <p className="text-xs text-text-muted text-center py-4">Loading...</p>
        ) : (
          members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-alt transition-colors"
            >
              <UserAvatar
                src={m.profiles?.avatar_url}
                name={m.profiles?.display_name}
                size={30}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text truncate">
                  {m.profiles?.display_name || "Unknown"}
                </div>
                <div className="text-xs text-text-muted">
                  {ROLE_LABEL[m.role] || m.role}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
