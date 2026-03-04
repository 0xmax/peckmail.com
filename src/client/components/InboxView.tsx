import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useIncomingEmails, useProjectId, useHasMoreEmails, useLoadingMoreEmails, useLoadMoreEmails } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import {
  Tray,
  Copy,
  Check,
  ArrowLeft,
  CircleNotch,
  WarningCircle,
  EnvelopeSimple,
  MagnifyingGlass,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import type { IncomingEmail } from "../store/types.js";
import { EmailIframe } from "./EmailIframe.js";

interface EmailDetail extends IncomingEmail {
  body_text: string | null;
  body_html: string | null;
}

// --- Helpers ---

function extractSenderName(address: string): string {
  const local = address.split("@")[0] || address;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const emailDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (today.getTime() - emailDay.getTime()) / 86400000
  );

  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return "Yesterday";
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Components ---

function EmailListItem({
  email,
  isSelected,
  onSelect,
}: {
  email: IncomingEmail;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isUnread = email.status === "received";
  const senderName = extractSenderName(email.from_address);
  const initial = senderName[0]?.toUpperCase() || "?";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 flex items-start gap-3 transition-colors border-b border-border/50 ${
        isSelected
          ? "bg-accent"
          : isUnread
            ? "bg-primary/[0.04] hover:bg-primary/[0.07]"
            : "hover:bg-accent/50"
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs ${
          isUnread
            ? "bg-primary/15 text-primary font-bold"
            : "bg-muted text-muted-foreground font-medium"
        }`}
      >
        {initial}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Row 1: sender + status + date */}
        <div className="flex items-center gap-2">
          <span
            className={`text-[13px] truncate ${
              isUnread
                ? "font-semibold text-foreground"
                : "font-normal text-foreground/80"
            }`}
          >
            {senderName}
          </span>
          {email.status === "processing" && (
            <CircleNotch
              size={12}
              className="text-amber-500 animate-spin shrink-0"
            />
          )}
          {email.status === "failed" && (
            <WarningCircle
              size={12}
              className="text-red-500 shrink-0"
              weight="fill"
            />
          )}
          <span
            className={`text-xs shrink-0 ml-auto tabular-nums ${
              isUnread
                ? "font-semibold text-foreground"
                : "font-normal text-muted-foreground"
            }`}
          >
            {formatDate(email.created_at)}
          </span>
        </div>

        {/* Row 2: subject */}
        <p
          className={`text-[13px] truncate mt-0.5 ${
            isUnread
              ? "font-semibold text-foreground"
              : "font-normal text-muted-foreground"
          }`}
        >
          {email.subject || "(no subject)"}
        </p>

        {/* Row 3: snippet from summary */}
        {email.summary && (
          <p className="text-xs text-muted-foreground/80 truncate mt-0.5 leading-relaxed font-normal">
            {email.summary}
          </p>
        )}

        {/* Tags */}
        {email.tags && email.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {email.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: tag.color + "18",
                  color: tag.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function EmailDetailPanel({
  email,
  onBack,
  onDelete,
  deleting,
}: {
  email: EmailDetail | null;
  onBack: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  if (!email) return null;

  const senderName = extractSenderName(email.from_address);
  const initial = senderName[0]?.toUpperCase() || "?";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Detail header - mobile back button (stays pinned) */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border md:hidden shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <span className="text-sm font-medium truncate flex-1">Back</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? <CircleNotch size={16} className="animate-spin" /> : <Trash size={16} />}
        </Button>
      </div>

      {/* Scrollable email content: header + body together */}
      <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
        {/* Email header */}
        <div className="px-6 py-5 border-b border-border">
          {/* Subject + delete */}
          <div className="flex items-start gap-3">
            <h2 className="text-xl font-semibold text-foreground leading-tight tracking-[-0.01em] flex-1">
              {email.subject || "(no subject)"}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 hidden md:inline-flex"
              onClick={onDelete}
              disabled={deleting}
              title="Delete email"
            >
              {deleting ? <CircleNotch size={16} className="animate-spin" /> : <Trash size={16} />}
            </Button>
          </div>

          {/* Tags */}
          {email.tags && email.tags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
              {email.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: tag.color + "18",
                    color: tag.color,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {/* Sender row */}
          <div className="flex items-center gap-3 mt-4">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary uppercase">
                {initial}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-sm text-foreground">
                  {senderName}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  &lt;{email.from_address}&gt;
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatFullDate(email.created_at)}
              </p>
            </div>
            {email.status === "processing" && (
              <CircleNotch
                size={16}
                className="text-amber-500 animate-spin shrink-0"
              />
            )}
            {email.status === "failed" && (
              <WarningCircle
                size={16}
                className="text-red-500 shrink-0"
                weight="fill"
              />
            )}
          </div>

          {/* AI Summary */}
          {email.summary && (
            <div className="mt-4 px-3 py-2.5 bg-primary/[0.04] rounded-lg border border-primary/10">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkle size={12} weight="fill" className="text-primary" />
                <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">
                  Summary
                </span>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {email.summary}
              </p>
            </div>
          )}

          {/* Error */}
          {email.status === "failed" && email.error && (
            <div className="mt-3 text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {email.error}
            </div>
          )}
        </div>

        {/* Email body */}
        <div className="px-6 py-4">
          {email.body_html ? (
            <EmailIframe html={email.body_html} />
          ) : email.body_text ? (
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {email.body_text}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No email content available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main ---

export function InboxView() {
  const { session } = useAuth();
  const projectId = useProjectId();
  const emails = useIncomingEmails();
  const hasMoreEmails = useHasMoreEmails();
  const loadingMoreEmails = useLoadingMoreEmails();
  const loadMoreEmails = useLoadMoreEmails();
  const [projectEmail, setProjectEmail] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("email");
  });
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [search, setSearch] = useState("");

  // Fetch project email address
  useEffect(() => {
    if (!session?.access_token) return;
    setEmailLoading(true);
    fetch(`/api/projects/${projectId}/email`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setProjectEmail(data.email ?? null))
      .catch(() => setProjectEmail(null))
      .finally(() => setEmailLoading(false));
  }, [projectId, session?.access_token]);

  // Fetch selected email detail
  const loadEmailDetail = useCallback(
    async (emailId: string) => {
      setDetailLoading(true);
      try {
        const data = await api.get<{ email: EmailDetail }>(
          `/api/projects/${projectId}/emails/${emailId}`
        );
        setSelectedEmail(data.email);
      } catch {
        setSelectedEmail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [projectId]
  );

  // Load email from URL param on mount
  useEffect(() => {
    if (selectedId && !selectedEmail && !detailLoading) {
      loadEmailDetail(selectedId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateEmailParam = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("email", id);
    } else {
      url.searchParams.delete("email");
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    updateEmailParam(id);
    loadEmailDetail(id);
  };

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!selectedId) return;
    setDeleting(true);
    try {
      await api.del(`/api/projects/${projectId}/emails/${selectedId}`);
      setSelectedId(null);
      setSelectedEmail(null);
      updateEmailParam(null);
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  };

  const copyEmail = () => {
    if (!projectEmail) return;
    navigator.clipboard.writeText(projectEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      await api.post(`/api/projects/${projectId}/emails/test`);
    } catch {
      // Error will show up in inbox list
    } finally {
      setSendingTest(false);
    }
  };

  const filteredEmails = useMemo(() => {
    let list =
      filter === "unread"
        ? emails.filter((e) => e.status === "received")
        : emails;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.subject?.toLowerCase().includes(q) ||
          e.from_address?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [emails, filter, search]);

  const unreadCount = emails.filter((e) => e.status === "received").length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar with email address + actions */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <h1 className="text-sm font-semibold text-foreground shrink-0">
          Inbox
        </h1>
        <div className="flex-1 min-w-0">
          {emailLoading ? (
            <Skeleton className="h-5 w-48" />
          ) : projectEmail ? (
            <button
              onClick={copyEmail}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <code className="font-mono truncate">{projectEmail}</code>
              {copied ? (
                <Check size={12} className="text-green-500 shrink-0" />
              ) : (
                <Copy size={12} className="shrink-0" />
              )}
            </button>
          ) : null}
        </div>
        {projectEmail && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 shrink-0"
            onClick={sendTestEmail}
            disabled={sendingTest}
          >
            {sendingTest ? "Sending..." : "Send test"}
          </Button>
        )}
      </div>

      {/* Main content: list + detail split */}
      <div className="flex-1 flex min-h-0">
        {/* Email list panel */}
        <div
          className={`w-full md:w-80 lg:w-96 border-r border-border flex flex-col min-h-0 shrink-0 ${
            selectedId ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Search + filter */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search emails..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            <Tabs
              value={filter}
              onValueChange={(v) => setFilter(v as "all" | "unread")}
            >
              <TabsList className="h-7">
                <TabsTrigger value="all" className="text-xs px-3 h-6">
                  All mail
                </TabsTrigger>
                <TabsTrigger value="unread" className="text-xs px-3 h-6">
                  Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Email list */}
          <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain">
            {filteredEmails.length === 0 ? (
              <div className="text-center py-16 px-4">
                <Tray
                  size={40}
                  weight="duotone"
                  className="mx-auto mb-3 text-muted-foreground"
                />
                <p className="text-muted-foreground text-sm">
                  {filter === "unread" ? "No unread emails" : "No emails yet"}
                </p>
                <p className="text-muted-foreground text-xs mt-1">
                  Forward a newsletter to get started.
                </p>
              </div>
            ) : (
              <>
                {filteredEmails.map((e) => (
                  <EmailListItem
                    key={e.id}
                    email={e}
                    isSelected={selectedId === e.id}
                    onSelect={() => handleSelect(e.id)}
                  />
                ))}
                {hasMoreEmails && !search && filter === "all" && (
                  <div className="px-3 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={loadMoreEmails}
                      disabled={loadingMoreEmails}
                    >
                      {loadingMoreEmails ? (
                        <>
                          <CircleNotch size={14} className="animate-spin mr-1.5" />
                          Loading...
                        </>
                      ) : (
                        "Load more"
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div
          className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${
            selectedId ? "flex" : "hidden md:flex"
          }`}
        >
          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <CircleNotch
                size={24}
                className="text-muted-foreground animate-spin"
              />
            </div>
          ) : selectedEmail ? (
            <EmailDetailPanel
              email={selectedEmail}
              onBack={() => {
                setSelectedId(null);
                setSelectedEmail(null);
                updateEmailParam(null);
              }}
              onDelete={handleDelete}
              deleting={deleting}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <EnvelopeSimple
                  size={48}
                  weight="duotone"
                  className="mx-auto mb-3"
                />
                <p className="text-sm">Select an email to read</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
