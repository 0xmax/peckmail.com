import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useIncomingEmails, useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import {
  Tray,
  Copy,
  Check,
  ArrowLeft,
  CircleNotch,
  WarningCircle,
  CheckCircle,
  EnvelopeSimple,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import type { IncomingEmail } from "../store/types.js";
import { EmailIframe } from "./EmailIframe.js";

interface EmailDetail extends IncomingEmail {
  body_text: string | null;
  body_html: string | null;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
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

function StatusDot({ status, error }: { status: string; error: string | null }) {
  if (status === "received") {
    return <span className="block w-2.5 h-2.5 rounded-full bg-blue-500" />;
  }
  if (status === "processing") {
    return <CircleNotch size={12} className="text-amber-500 animate-spin" />;
  }
  if (status === "failed") {
    return <WarningCircle size={12} className="text-red-500" weight="fill" />;
  }
  return <CheckCircle size={12} className="text-green-500" weight="fill" />;
}

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

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-b border-border hover:bg-accent/50 ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <div className="mt-1.5 shrink-0">
        <StatusDot status={email.status} error={email.error} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-sm truncate ${
              isUnread ? "font-semibold text-foreground" : "text-foreground"
            }`}
          >
            {email.from_address?.split("@")[0] || "Unknown"}
          </span>
          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
            {formatDate(email.created_at)}
          </span>
        </div>
        <p
          className={`text-sm truncate ${
            isUnread ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {email.subject || "(no subject)"}
        </p>
      </div>
    </button>
  );
}

function EmailDetailPanel({
  email,
  onBack,
}: {
  email: EmailDetail | null;
  onBack: () => void;
}) {
  if (!email) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Detail header - mobile back button */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border md:hidden">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        <span className="text-sm font-medium truncate">Back</span>
      </div>

      {/* Email header */}
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {email.subject || "(no subject)"}
        </h2>
        {email.summary && (
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
            {email.summary}
          </p>
        )}
        <div className="flex items-center gap-2 text-sm">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {(email.from_address || "?")[0]}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground truncate">
              {email.from_address}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFullDate(email.created_at)}
            </p>
          </div>
          <div className="shrink-0">
            <StatusDot status={email.status} error={email.error} />
          </div>
        </div>
        {email.status === "failed" && email.error && (
          <div className="mt-2 text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
            {email.error}
          </div>
        )}
      </div>

      {/* Email body */}
      <div className="flex-1 overflow-auto min-h-0">
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

export function InboxView() {
  const { session } = useAuth();
  const projectId = useProjectId();
  const emails = useIncomingEmails();
  const [projectEmail, setProjectEmail] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const handleSelect = (id: string) => {
    setSelectedId(id);
    loadEmailDetail(id);
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
    let list = filter === "unread"
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
        <h1 className="text-sm font-semibold text-foreground shrink-0">Inbox</h1>
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
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
          <ScrollArea className="flex-1">
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
              filteredEmails.map((e) => (
                <EmailListItem
                  key={e.id}
                  email={e}
                  isSelected={selectedId === e.id}
                  onSelect={() => handleSelect(e.id)}
                />
              ))
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        <div
          className={`flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden ${
            selectedId ? "flex" : "hidden md:flex"
          }`}
        >
          {detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <CircleNotch size={24} className="text-muted-foreground animate-spin" />
            </div>
          ) : selectedEmail ? (
            <EmailDetailPanel
              email={selectedEmail}
              onBack={() => {
                setSelectedId(null);
                setSelectedEmail(null);
              }}
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
