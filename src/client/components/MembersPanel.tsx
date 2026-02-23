import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { UserAvatar } from "./UserAvatar.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { SignOut, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";

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

export function MembersPanel({ projectId, onLeave }: { projectId: string; onLeave?: () => void }) {
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

  async function leaveProject() {
    try {
      await api.post(`/api/projects/${projectId}/leave`);
      onLeave?.();
    } catch (err: any) {
      console.error("Failed to leave project:", err.message);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Members</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-[30px] w-[30px] rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3 rounded-full" />
                  <Skeleton className="h-3 w-1/3 rounded-full" />
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
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors group"
              >
                <UserAvatar
                  src={m.profiles?.avatar_url}
                  name={m.profiles?.display_name}
                  size={30}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-foreground truncate">
                    {m.profiles?.display_name || "Unknown"}
                    {isSelf && (
                      <span className="text-muted-foreground ml-1">(you)</span>
                    )}
                  </div>
                  {isOwner && !isSelf ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole(m.user_id, v)}
                    >
                      <SelectTrigger className="h-6 text-xs w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {ROLE_OPTIONS.find((o) => o.value === m.role)?.label ||
                        m.role}
                    </div>
                  )}
                </div>
                {isOwner && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => removeMember(m.user_id)}
                    title="Remove member"
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
      {!loading && !isOwner && currentUserId && (
        <div className="px-4 py-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={leaveProject}
          >
            <SignOut size={15} />
            Leave project
          </Button>
        </div>
      )}
    </div>
  );
}
