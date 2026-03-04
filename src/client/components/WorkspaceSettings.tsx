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
  Funnel,
  ListBullets,
} from "@phosphor-icons/react";
import { TAG_COLORS } from "../lib/presets.js";
import type { EmailExtractor } from "../store/types.js";

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

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Tags</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-applied labels that appear on each email. Multiple tags can match one email.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 shrink-0"
          onClick={() => setShowNew(true)}
        >
          <Plus size={14} />
          New tag
        </Button>
      </div>
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

// --- Templates ---

interface CategoryTemplate {
  name: string;
  label: string;
  description: string;
  enum_values: string[];
  enum_colors: string[];
}

interface ExtractorTemplate {
  name: string;
  label: string;
  description: string;
  value_type: string;
  enum_values: string[];
  enum_colors: string[];
}

const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  {
    name: "email_type",
    label: "Email Type",
    description: "Classify the email into one of the provided categories based on its content and purpose.",
    enum_values: ["welcome", "promotional", "newsletter", "cart_abandon", "winback", "transactional", "announcement", "survey", "loyalty", "seasonal", "other"],
    enum_colors: ["#22c55e", "#ef4444", "#3b82f6", "#f97316", "#eab308", "#06b6d4", "#8b5cf6", "#ec4899", "#f59e0b", "#14b8a6", "#94a3b8"],
  },
  {
    name: "mail_type",
    label: "Mail Type",
    description: "Classify the email as transactional or marketing.",
    enum_values: ["transactional", "marketing"],
    enum_colors: ["#06b6d4", "#ef4444"],
  },
  {
    name: "funnel_stage",
    label: "Funnel Stage",
    description: "Classify which stage of the customer funnel this email targets.",
    enum_values: ["awareness", "consideration", "conversion", "retention", "winback"],
    enum_colors: ["#3b82f6", "#eab308", "#22c55e", "#8b5cf6", "#ef4444"],
  },
  {
    name: "audience",
    label: "Audience",
    description: "Classify the intended audience segment for this email.",
    enum_values: ["new_subscriber", "active_customer", "lapsed_customer", "vip", "general"],
    enum_colors: ["#22c55e", "#3b82f6", "#f97316", "#8b5cf6", "#94a3b8"],
  },
];

const EXTRACTOR_TEMPLATES: ExtractorTemplate[] = [
  {
    name: "offer",
    label: "Offer",
    description: "Brief description of the offer/promotion. null if none.",
    value_type: "text",
    enum_values: [],
    enum_colors: [],
  },
  {
    name: "discount_pct",
    label: "Discount %",
    description: "Discount percentage (0-100). null if none.",
    value_type: "number",
    enum_values: [],
    enum_colors: [],
  },
  {
    name: "discount_codes",
    label: "Discount Codes",
    description: "Promo/discount codes mentioned in the email.",
    value_type: "text_array",
    enum_values: [],
    enum_colors: [],
  },
  {
    name: "products_mentioned",
    label: "Products",
    description: "Specific product names mentioned.",
    value_type: "text_array",
    enum_values: [],
    enum_colors: [],
  },
  {
    name: "urgency",
    label: "Urgency",
    description: "Urgency level of the email.",
    value_type: "enum",
    enum_values: ["none", "soft", "hard"],
    enum_colors: ["#94a3b8", "#eab308", "#ef4444"],
  },
  {
    name: "cta",
    label: "CTA",
    description: "Primary call-to-action text. null if none.",
    value_type: "text",
    enum_values: [],
    enum_colors: [],
  },
  {
    name: "tone",
    label: "Tone",
    description: "Overall tone of the email.",
    value_type: "enum",
    enum_values: ["formal", "casual", "urgent", "friendly", "luxury"],
    enum_colors: ["#3b82f6", "#22c55e", "#ef4444", "#f97316", "#8b5cf6"],
  },
  {
    name: "has_unsubscribe",
    label: "Has Unsubscribe",
    description: "Whether the email contains an unsubscribe link.",
    value_type: "boolean",
    enum_values: [],
    enum_colors: [],
  },
];

// --- Extractors Section ---

const VALUE_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "text_array", label: "Text Array" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "enum", label: "Enum" },
];

function EnumColorDot({
  color,
  onChange,
}: {
  color: string;
  onChange?: (color: string) => void;
}) {
  if (!onChange) {
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <label className="relative inline-block w-5 h-5 shrink-0 cursor-pointer">
      <span
        className="absolute inset-0 m-auto w-3 h-3 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </label>
  );
}

function ExtractorRow({
  extractor,
  onUpdate,
  onDelete,
}: {
  extractor: EmailExtractor;
  onUpdate: (id: string, updates: Partial<EmailExtractor>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(extractor.label);
  const [description, setDescription] = useState(extractor.description);
  const [enumValues, setEnumValues] = useState(extractor.enum_values.join(", "));
  const [enumColors, setEnumColors] = useState<string[]>(extractor.enum_colors ?? []);

  const isCategory = extractor.kind === "category";
  const hasEnum = extractor.value_type === "enum" || isCategory;

  const handleSave = async () => {
    const updates: Partial<EmailExtractor> = { label, description };
    if (hasEnum) {
      const vals = enumValues
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      updates.enum_values = vals;
      updates.enum_colors = enumColors.slice(0, vals.length);
    }
    await onUpdate(extractor.id, updates);
    setEditing(false);
  };

  // Keep colors array in sync with values during editing
  const parsedValues = enumValues
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (editing && hasEnum && parsedValues.length !== enumColors.length) {
    const next = [...enumColors];
    while (next.length < parsedValues.length) {
      next.push(TAG_COLORS[next.length % TAG_COLORS.length]);
    }
    if (next.length > parsedValues.length) next.length = parsedValues.length;
    if (next.join() !== enumColors.join()) setEnumColors(next);
  }

  return (
    <div className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
      {editing ? (
        <div className="space-y-2">
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="h-8 text-sm"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="AI instruction / description"
            className="h-8 text-sm"
          />
          {hasEnum && (
            <>
              <Input
                value={enumValues}
                onChange={(e) => setEnumValues(e.target.value)}
                placeholder="Comma-separated values"
                className="h-8 text-sm"
              />
              {parsedValues.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {parsedValues.map((v, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-muted"
                    >
                      <EnumColorDot
                        color={enumColors[i] ?? TAG_COLORS[i % TAG_COLORS.length]}
                        onChange={(c) => {
                          const next = [...enumColors];
                          next[i] = c;
                          setEnumColors(next);
                        }}
                      />
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setLabel(extractor.label);
                setDescription(extractor.description);
                setEnumValues(extractor.enum_values.join(", "));
                setEnumColors(extractor.enum_colors ?? []);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {extractor.label}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {extractor.value_type}
              </span>
            </div>
            {hasEnum && extractor.enum_values.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {extractor.enum_values.map((v, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: (extractor.enum_colors?.[i] ?? TAG_COLORS[i % TAG_COLORS.length]) + "1a",
                      color: extractor.enum_colors?.[i] ?? TAG_COLORS[i % TAG_COLORS.length],
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: extractor.enum_colors?.[i] ?? TAG_COLORS[i % TAG_COLORS.length] }}
                    />
                    {v}
                  </span>
                ))}
              </div>
            )}
            {extractor.description && !hasEnum && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {extractor.description}
              </p>
            )}
          </div>
          <Switch
            checked={extractor.enabled}
            onCheckedChange={(enabled) => onUpdate(extractor.id, { enabled })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => onDelete(extractor.id)}
          >
            <Trash size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

function CategoriesSection({ projectId }: { projectId: string }) {
  const [categories, setCategories] = useState<EmailExtractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMode, setNewMode] = useState<null | "pick" | "form">(null);
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newEnumValues, setNewEnumValues] = useState("");
  const [newEnumColors, setNewEnumColors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const closeNewForm = () => {
    setNewMode(null);
    setNewName("");
    setNewLabel("");
    setNewDescription("");
    setNewEnumValues("");
    setNewEnumColors([]);
  };

  const applyTemplate = (t: CategoryTemplate) => {
    setNewName(t.name);
    setNewLabel(t.label);
    setNewDescription(t.description);
    setNewEnumValues(t.enum_values.join(", "));
    setNewEnumColors(t.enum_colors);
    setNewMode("form");
  };

  const loadCategories = useCallback(() => {
    setLoading(true);
    api
      .get<{ extractors: EmailExtractor[] }>(
        `/api/projects/${projectId}/extractors`
      )
      .then((r) =>
        setCategories(r.extractors.filter((e) => e.kind === "category"))
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newLabel.trim() || !newEnumValues.trim()) return;
    setCreating(true);
    try {
      const vals = newEnumValues
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      // Ensure colors array matches values length
      const colors = vals.map((_, i) => newEnumColors[i] ?? TAG_COLORS[i % TAG_COLORS.length]);
      const { extractor } = await api.post<{ extractor: EmailExtractor }>(
        `/api/projects/${projectId}/extractors`,
        {
          kind: "category",
          name: newName.trim().toLowerCase().replace(/\s+/g, "_"),
          label: newLabel.trim(),
          description: newDescription.trim(),
          value_type: "enum",
          enum_values: vals,
          enum_colors: colors,
        }
      );
      setCategories((prev) => [...prev, extractor]);
      closeNewForm();
    } catch {}
    setCreating(false);
  };

  const handleUpdate = async (
    id: string,
    updates: Partial<EmailExtractor>
  ) => {
    const { extractor } = await api.patch<{ extractor: EmailExtractor }>(
      `/api/projects/${projectId}/extractors/${id}`,
      updates
    );
    setCategories((prev) => prev.map((c) => (c.id === id ? extractor : c)));
  };

  const handleDelete = async (id: string) => {
    await api.del(`/api/projects/${projectId}/extractors/${id}`);
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Categories</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each email gets exactly one value per category. Shown as colored chips on emails.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7"
          onClick={() => setNewMode("pick")}
        >
          <Plus size={14} />
          New category
        </Button>
      </div>
      <Card>
        <CardContent className="p-3">
          {newMode === "pick" && (
            <div className="border border-border rounded-lg p-3 mb-3 space-y-3">
              <p className="text-xs text-muted-foreground">Pick a template or start blank:</p>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_TEMPLATES.filter(
                  (t) => !categories.some((c) => c.name === t.name)
                ).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className="text-left p-2 rounded-lg border border-border hover:bg-muted transition-colors"
                    onClick={() => applyTemplate(t)}
                  >
                    <div className="text-sm font-medium text-foreground">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {t.enum_values.join(", ")}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  className="text-left p-2 rounded-lg border border-dashed border-border hover:bg-muted transition-colors"
                  onClick={() => setNewMode("form")}
                >
                  <div className="text-sm font-medium text-foreground">Custom</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Start from scratch</div>
                </button>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeNewForm}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {newMode === "form" && (
            <form
              onSubmit={handleCreate}
              className="border border-border rounded-lg p-3 mb-3 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name (slug, e.g. email_type)"
                  className="flex-1 h-8 text-sm font-mono"
                />
              </div>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Display label (e.g. Email Type)"
                className="h-8 text-sm"
              />
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="AI instruction (e.g. 'Classify the email type')"
                className="h-8 text-sm"
              />
              <Input
                value={newEnumValues}
                onChange={(e) => setNewEnumValues(e.target.value)}
                placeholder="Comma-separated values (e.g. promotional, newsletter, transactional)"
                className="h-8 text-sm"
              />
              {(() => {
                const vals = newEnumValues.split(",").map((v) => v.trim()).filter(Boolean);
                return vals.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {vals.map((v, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-muted"
                      >
                        <EnumColorDot
                          color={newEnumColors[i] ?? TAG_COLORS[i % TAG_COLORS.length]}
                          onChange={(c) => {
                            const next = [...newEnumColors];
                            while (next.length <= i) next.push(TAG_COLORS[next.length % TAG_COLORS.length]);
                            next[i] = c;
                            setNewEnumColors(next);
                          }}
                        />
                        {v}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeNewForm}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    creating ||
                    !newName.trim() ||
                    !newLabel.trim() ||
                    !newEnumValues.trim()
                  }
                >
                  {creating ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="space-y-2 p-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-8">
              <ListBullets
                size={32}
                weight="duotone"
                className="mx-auto mb-2 text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">
                No categories yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Categories classify each email into one value per field.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {categories.map((cat) => (
                <ExtractorRow
                  key={cat.id}
                  extractor={cat}
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

function ExtractorsSection({ projectId }: { projectId: string }) {
  const [extractors, setExtractors] = useState<EmailExtractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMode, setNewMode] = useState<null | "pick" | "form">(null);
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newValueType, setNewValueType] = useState("text");
  const [newEnumValues, setNewEnumValues] = useState("");
  const [newEnumColors, setNewEnumColors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const closeNewForm = () => {
    setNewMode(null);
    setNewName("");
    setNewLabel("");
    setNewDescription("");
    setNewValueType("text");
    setNewEnumValues("");
    setNewEnumColors([]);
  };

  const applyTemplate = (t: ExtractorTemplate) => {
    setNewName(t.name);
    setNewLabel(t.label);
    setNewDescription(t.description);
    setNewValueType(t.value_type);
    setNewEnumValues(t.enum_values.join(", "));
    setNewEnumColors(t.enum_colors);
    setNewMode("form");
  };

  const loadExtractors = useCallback(() => {
    setLoading(true);
    api
      .get<{ extractors: EmailExtractor[] }>(
        `/api/projects/${projectId}/extractors`
      )
      .then((r) =>
        setExtractors(r.extractors.filter((e) => e.kind !== "category"))
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadExtractors();
  }, [loadExtractors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newLabel.trim()) return;
    setCreating(true);
    try {
      const vals =
        newValueType === "enum"
          ? newEnumValues.split(",").map((v) => v.trim()).filter(Boolean)
          : [];
      const colors = vals.map((_, i) => newEnumColors[i] ?? TAG_COLORS[i % TAG_COLORS.length]);
      const { extractor } = await api.post<{ extractor: EmailExtractor }>(
        `/api/projects/${projectId}/extractors`,
        {
          name: newName.trim().toLowerCase().replace(/\s+/g, "_"),
          label: newLabel.trim(),
          description: newDescription.trim(),
          value_type: newValueType,
          enum_values: vals,
          enum_colors: colors,
        }
      );
      setExtractors((prev) => [...prev, extractor]);
      closeNewForm();
    } catch {}
    setCreating(false);
  };

  const handleUpdate = async (
    extractorId: string,
    updates: Partial<EmailExtractor>
  ) => {
    const { extractor } = await api.patch<{ extractor: EmailExtractor }>(
      `/api/projects/${projectId}/extractors/${extractorId}`,
      updates
    );
    setExtractors((prev) =>
      prev.map((ex) => (ex.id === extractorId ? extractor : ex))
    );
  };

  const handleDelete = async (extractorId: string) => {
    await api.del(`/api/projects/${projectId}/extractors/${extractorId}`);
    setExtractors((prev) => prev.filter((ex) => ex.id !== extractorId));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Extractors</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Data fields pulled from each email (offers, discounts, products, etc).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7"
          onClick={() => setNewMode("pick")}
        >
          <Plus size={14} />
          New extractor
        </Button>
      </div>
      <Card>
        <CardContent className="p-3">
          {newMode === "pick" && (
            <div className="border border-border rounded-lg p-3 mb-3 space-y-3">
              <p className="text-xs text-muted-foreground">Pick a template or start blank:</p>
              <div className="grid grid-cols-2 gap-2">
                {EXTRACTOR_TEMPLATES.filter(
                  (t) => !extractors.some((e) => e.name === t.name)
                ).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className="text-left p-2 rounded-lg border border-border hover:bg-muted transition-colors"
                    onClick={() => applyTemplate(t)}
                  >
                    <div className="text-sm font-medium text-foreground">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {t.value_type}{t.enum_values.length > 0 ? `: ${t.enum_values.join(", ")}` : ""}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  className="text-left p-2 rounded-lg border border-dashed border-border hover:bg-muted transition-colors"
                  onClick={() => setNewMode("form")}
                >
                  <div className="text-sm font-medium text-foreground">Custom</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Start from scratch</div>
                </button>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeNewForm}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {newMode === "form" && (
            <form
              onSubmit={handleCreate}
              className="border border-border rounded-lg p-3 mb-3 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name (slug, e.g. discount_pct)"
                  className="flex-1 h-8 text-sm font-mono"
                />
                <Select value={newValueType} onValueChange={setNewValueType}>
                  <SelectTrigger className="w-32 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALUE_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Display label"
                className="h-8 text-sm"
              />
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="AI instruction (e.g. 'Extract the discount percentage 0-100')"
                className="h-8 text-sm"
              />
              {newValueType === "enum" && (
                <Input
                  value={newEnumValues}
                  onChange={(e) => setNewEnumValues(e.target.value)}
                  placeholder="Comma-separated enum values (e.g. none, soft, hard)"
                  className="h-8 text-sm"
                />
              )}
              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeNewForm}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating || !newName.trim() || !newLabel.trim()}
                >
                  {creating ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : extractors.length === 0 ? (
            <div className="text-center py-8">
              <Funnel
                size={32}
                weight="duotone"
                className="mx-auto mb-2 text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">
                No extractors configured
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Extractors define what data to extract from incoming emails.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {extractors.map((ex) => (
                <ExtractorRow
                  key={ex.id}
                  extractor={ex}
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

// --- Reprocess Section ---

interface ReprocessStatus {
  status: "idle" | "running" | "done" | "error";
  tags_done?: number;
  tags_total?: number;
  extract_done?: number;
  extract_total?: number;
  error?: string;
}

function ReprocessSection({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<ReprocessStatus>({ status: "idle" });
  const [starting, setStarting] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const res = await api.get<ReprocessStatus>(
        `/api/projects/${projectId}/reprocess`
      );
      setStatus(res);
      return res.status;
    } catch {
      return "idle";
    }
  }, [projectId]);

  // Check if already running on mount
  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  // Poll while running
  useEffect(() => {
    if (status.status !== "running") return;
    const id = setInterval(async () => {
      const s = await pollStatus();
      if (s !== "running") clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
  }, [status.status, pollStatus]);

  const handleReprocess = async () => {
    setStarting(true);
    try {
      await api.post(`/api/projects/${projectId}/reprocess`);
      setStatus({ status: "running", tags_done: 0, tags_total: 0, extract_done: 0, extract_total: 0 });
    } catch {
      // ignore
    }
    setStarting(false);
  };

  const running = status.status === "running";
  const total = (status.tags_total ?? 0) + (status.extract_total ?? 0);
  const done = (status.tags_done ?? 0) + (status.extract_done ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Reprocess emails</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Re-run tags, categories, and extractors on all existing emails.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 shrink-0"
          onClick={handleReprocess}
          disabled={running || starting}
        >
          {running || starting ? (
            <CircleNotch size={14} className="animate-spin" />
          ) : (
            <ArrowsClockwise size={14} />
          )}
          {running ? "Running..." : starting ? "Starting..." : "Reprocess all"}
        </Button>
      </div>

      {running && (
        <div className="mt-3 space-y-1.5">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {total > 0
              ? `${done} / ${total} steps (${pct}%) — you can leave this page`
              : "Starting..."}
          </p>
        </div>
      )}

      {status.status === "done" && (
        <p className="text-xs text-muted-foreground mt-2">
          Done — {status.tags_done} emails tagged, {status.extract_done} extracted.
        </p>
      )}

      {status.status === "error" && (
        <p className="text-xs text-destructive mt-2">
          Error: {status.error}
        </p>
      )}
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
        <CategoriesSection projectId={projectId} />
        <ExtractorsSection projectId={projectId} />
        <ReprocessSection projectId={projectId} />
        <DangerZoneSection projectId={projectId} />
      </div>
    </div>
  );
}
