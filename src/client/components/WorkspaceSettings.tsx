import { useState, useEffect, useCallback } from "react";
import { useProjectId } from "../store/StoreContext.js";
import { useIncomingEmails } from "../store/StoreContext.js";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { UserAvatar } from "./UserAvatar.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Plus,
  X,
  SignOut,
  Tag,
  ArrowsClockwise,
  CircleNotch,
  Pencil,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { TAG_COLORS } from "../lib/presets.js";

// --- Types ---

interface Member {
  user_id: string;
  role: string;
  email: string | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

interface ProjectTag {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  condition: string;
}

const ROLE_OPTIONS = [
  { value: "viewer", label: "Read" },
  { value: "editor", label: "Read & Write" },
  { value: "owner", label: "Admin" },
];

// --- Members Section ---

function MembersSection({ projectId }: { projectId: string }) {
  const { session, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      await api.post(`/api/projects/${projectId}/invite`, {
        email: inviteEmail.trim(),
        role: "editor",
      });
      setInviteMsg({ type: "success", text: "Invitation sent!" });
      setInviteEmail("");
    } catch (err: any) {
      setInviteMsg({ type: "error", text: err.message || "Failed to invite" });
    } finally {
      setInviting(false);
    }
  };

  async function changeRole(userId: string, role: string) {
    try {
      await api.put(`/api/projects/${projectId}/members/${userId}`, { role });
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role } : m))
      );
    } catch {}
  }

  async function removeMember(userId: string) {
    try {
      await api.del(`/api/projects/${projectId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {}
  }

  async function leaveProject() {
    try {
      await api.post(`/api/projects/${projectId}/leave`);
      window.location.reload();
    } catch {}
  }

  return (
    <section>
      <h2 className="text-base font-semibold text-foreground mb-4">Members</h2>
      <Card>
        <CardContent className="p-5 space-y-4">
          {/* Invite input */}
          <form onSubmit={handleInvite} className="flex items-center gap-2">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteMsg(null);
              }}
              placeholder="Invite by email..."
              className="flex-1"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!inviteEmail.trim() || inviting}
            >
              {inviting ? "Sending..." : "Invite"}
            </Button>
          </form>
          {inviteMsg && (
            <p
              className={`text-xs ${inviteMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
            >
              {inviteMsg.text}
            </p>
          )}

          {/* Member list */}
          <div className="space-y-1">
            {loading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
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
                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted transition-colors group"
                  >
                    <UserAvatar
                      src={m.profiles?.avatar_url}
                      name={m.profiles?.display_name}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground truncate">
                        {m.profiles?.display_name || "Unknown"}
                        {isSelf && (
                          <span className="text-muted-foreground ml-1">
                            (you)
                          </span>
                        )}
                      </div>
                      {m.email && (
                        <div className="text-xs text-muted-foreground truncate">
                          {m.email}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isOwner && !isSelf ? (
                        <div className="flex items-center gap-1">
                          <Select
                            value={m.role}
                            onValueChange={(v) => changeRole(m.user_id, v)}
                          >
                            <SelectTrigger className="h-7 text-xs w-auto">
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100"
                            onClick={() => removeMember(m.user_id)}
                            title="Remove member"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {ROLE_OPTIONS.find((o) => o.value === m.role)
                            ?.label || m.role}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {!loading && !isOwner && currentUserId && (
            <div className="pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={leaveProject}
              >
                <SignOut size={15} />
                Leave workspace
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// --- Stats Section ---

function StatsSection() {
  const emails = useIncomingEmails();
  const total = emails.length;
  const unread = emails.filter((e) => e.status === "received").length;
  const lastEmail = emails.length > 0 ? emails[0] : null;

  return (
    <section>
      <h2 className="text-base font-semibold text-foreground mb-4">Stats</h2>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {total}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Total emails
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {unread}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Unread</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-sm font-medium text-foreground truncate">
              {lastEmail
                ? new Date(lastEmail.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "\u2014"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Last received
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// --- Tags Section ---

function TagRow({
  tag,
  onUpdate,
  onDelete,
}: {
  tag: ProjectTag;
  onUpdate: (id: string, updates: Partial<ProjectTag>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [condition, setCondition] = useState(tag.condition);
  const [color, setColor] = useState(tag.color);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(tag.id, { name, condition, color });
      setEditing(false);
    } catch {}
    setSaving(false);
  };

  const handleCancel = () => {
    setName(tag.name);
    setCondition(tag.condition);
    setColor(tag.color);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tag name"
            className="flex-1 h-8 text-sm"
          />
          <div className="flex items-center gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-colors ${color === c ? "border-foreground" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <Input
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="Condition (e.g. 'newsletters about tech')"
          className="h-8 text-sm"
        />
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || !condition.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors group">
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: tag.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground">{tag.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {tag.condition}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={tag.enabled}
          onCheckedChange={(checked) =>
            onUpdate(tag.id, { enabled: !!checked })
          }
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100"
          onClick={() => setEditing(true)}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive"
          onClick={() => onDelete(tag.id)}
        >
          <Trash size={14} />
        </Button>
      </div>
    </div>
  );
}

function TagsSection({ projectId }: { projectId: string }) {
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCondition, setNewCondition] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[5]);
  const [creating, setCreating] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<string | null>(null);

  const loadTags = useCallback(() => {
    setLoading(true);
    api
      .get<{ tags: ProjectTag[] }>(`/api/projects/${projectId}/tags`)
      .then((r) => setTags(r.tags))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newCondition.trim()) return;
    setCreating(true);
    try {
      const { tag } = await api.post<{ tag: ProjectTag }>(
        `/api/projects/${projectId}/tags`,
        {
          name: newName.trim(),
          condition: newCondition.trim(),
          color: newColor,
        }
      );
      setTags((prev) => [...prev, tag]);
      setNewName("");
      setNewCondition("");
      setNewColor(TAG_COLORS[5]);
      setShowNew(false);
    } catch {}
    setCreating(false);
  };

  const handleUpdate = async (
    tagId: string,
    updates: Partial<ProjectTag>
  ) => {
    const { tag } = await api.patch<{ tag: ProjectTag }>(
      `/api/projects/${projectId}/tags/${tagId}`,
      updates
    );
    setTags((prev) => prev.map((t) => (t.id === tagId ? tag : t)));
  };

  const handleDelete = async (tagId: string) => {
    await api.del(`/api/projects/${projectId}/tags/${tagId}`);
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  };

  const handleReprocess = async () => {
    setReprocessing(true);
    setReprocessResult(null);
    try {
      const { processed } = await api.post<{
        ok: boolean;
        processed: number;
      }>(`/api/projects/${projectId}/reprocess-tags`);
      setReprocessResult(`Reprocessed ${processed} emails`);
    } catch (err: any) {
      setReprocessResult(err.message || "Failed");
    }
    setReprocessing(false);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">Tags</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={handleReprocess}
            disabled={reprocessing || tags.length === 0}
          >
            {reprocessing ? (
              <CircleNotch size={14} className="animate-spin" />
            ) : (
              <ArrowsClockwise size={14} />
            )}
            {reprocessing ? "Reprocessing..." : "Reprocess all"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowNew(true)}
          >
            <Plus size={14} />
            New tag
          </Button>
        </div>
      </div>
      {reprocessResult && (
        <p className="text-xs text-muted-foreground mb-3">{reprocessResult}</p>
      )}
      <Card>
        <CardContent className="p-3">
          {/* New tag form */}
          {showNew && (
            <form
              onSubmit={handleCreate}
              className="border border-border rounded-lg p-3 mb-3 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Tag name"
                  className="flex-1 h-8 text-sm"
                />
                <div className="flex items-center gap-1">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className={`w-5 h-5 rounded-full border-2 transition-colors ${newColor === c ? "border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <Input
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                placeholder="Condition (e.g. 'newsletters about tech')"
                className="h-8 text-sm"
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNew(false);
                    setNewName("");
                    setNewCondition("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    creating || !newName.trim() || !newCondition.trim()
                  }
                >
                  {creating ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          )}

          {/* Tag list */}
          {loading ? (
            <div className="space-y-2 p-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <div className="text-center py-8">
              <Tag
                size={32}
                weight="duotone"
                className="mx-auto mb-2 text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">No tags yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tags auto-classify incoming emails using AI.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {tags.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// --- Danger Zone Section ---

function DangerZoneSection({ projectId }: { projectId: string }) {
  const { session, user } = useAuth();
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!session) return;
    // Check if user is owner
    api
      .get<{ members: Member[] }>(`/api/projects/${projectId}/members`)
      .then((d) => {
        const me = d.members.find((m) => m.user_id === user?.id);
        setIsOwner(me?.role === "owner");
      })
      .catch(() => {});
    // Get project name for confirmation
    api
      .get<{ projects: { id: string; name: string }[] }>("/api/projects")
      .then((d) => {
        const p = d.projects.find((p) => p.id === projectId);
        if (p) setProjectName(p.name);
      })
      .catch(() => {});
  }, [projectId, session]);

  if (!isOwner) return null;

  const handleDelete = async () => {
    if (confirmName !== projectName) return;
    setDeleting(true);
    setError("");
    try {
      await api.del(`/api/projects/${projectId}`);
      window.location.reload();
    } catch (err: any) {
      setError(err.message || "Failed to delete workspace");
      setDeleting(false);
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-destructive mb-4">
        Danger Zone
      </h2>
      <Card className="border-destructive/30">
        <CardContent className="p-5">
          {!showConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Delete this workspace
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Permanently remove this workspace and all its data.
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowConfirm(true)}
              >
                <Trash size={14} />
                Delete
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10">
                <Warning
                  size={18}
                  weight="duotone"
                  className="text-destructive shrink-0 mt-0.5"
                />
                <div className="text-sm text-destructive">
                  This action cannot be undone. All emails, tags, and member
                  associations will become inaccessible.
                </div>
              </div>
              <div>
                <label className="text-sm text-foreground block mb-1.5">
                  Type <span className="font-semibold">{projectName}</span> to
                  confirm
                </label>
                <Input
                  autoFocus
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={projectName}
                  className="h-9"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmName("");
                    setError("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={confirmName !== projectName || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? (
                    <>
                      <CircleNotch size={14} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    "Delete workspace"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// --- Main Component ---

export function WorkspaceSettings() {
  const projectId = useProjectId();

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        <StatsSection />
        <MembersSection projectId={projectId} />
        <TagsSection projectId={projectId} />
        <DangerZoneSection projectId={projectId} />
      </div>
    </div>
  );
}
