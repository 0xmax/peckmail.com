import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useIncomingEmails, useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import { Tray, Copy, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";

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
  return d.toLocaleDateString();
}

export function InboxView() {
  const { session } = useAuth();
  const projectId = useProjectId();
  const emails = useIncomingEmails();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/email`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setEmail(data.email ?? null))
      .catch(() => setEmail(null))
      .finally(() => setLoading(false));
  }, [projectId, session?.access_token]);

  const copyEmail = () => {
    if (!email) return;
    navigator.clipboard.writeText(email);
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

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Inbox</h1>
          {email && (
            <Button variant="outline" size="sm" onClick={sendTestEmail} disabled={sendingTest}>
              {sendingTest ? "Sending..." : "Send test email"}
            </Button>
          )}
        </div>

        {/* Project email address */}
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : email ? (
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <code className="flex-1 text-sm font-mono text-foreground select-all truncate">
              {email}
            </code>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={copyEmail}>
              {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
            </Button>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Forward newsletters to this address. The AI assistant will process incoming emails automatically.
        </p>

        {/* Email list */}
        {emails.length === 0 ? (
          <div className="text-center py-12">
            <Tray size={40} weight="duotone" className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No emails yet</p>
            <p className="text-muted-foreground text-xs mt-1">
              Forward a newsletter to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {emails.map((e) => (
              <div
                key={e.id}
                className="bg-card border border-border rounded-lg px-4 py-3 flex items-start gap-3"
              >
                <div
                  className="mt-1.5 shrink-0"
                  title={
                    e.status === "failed"
                      ? `Error: ${e.error}`
                      : e.status === "processed"
                        ? "Processed"
                        : e.status === "processing"
                          ? "Processing..."
                          : "Received"
                  }
                >
                  {e.status === "received" ? (
                    <span className="block w-2 h-2 rounded-full bg-blue-400" />
                  ) : e.status === "processing" ? (
                    <span className="block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  ) : e.status === "failed" ? (
                    <span className="block w-2 h-2 rounded-full bg-red-400" />
                  ) : (
                    <span className="block w-2 h-2 rounded-full bg-green-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {e.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {e.from_address}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                  {formatDate(e.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
