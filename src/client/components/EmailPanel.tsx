import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useIncomingEmails, useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Button } from "@/components/ui/button.js";

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

export function EmailPanel({ projectId }: { projectId: string }) {
  const { session } = useAuth();
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

  const copy = () => {
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
      // Ignore — error will show up in the inbox list
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Email</h3>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
        <p className="text-muted-foreground">
          Send emails to this address and the AI assistant will process them.
          Add an <code className="bg-muted px-1 py-0.5 rounded text-foreground">AGENTS.md</code> file for custom instructions.
        </p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-1/3 rounded-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : email ? (
          <div>
            <label className="font-medium text-muted-foreground block mb-1">
              Workspace email
            </label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-muted border border-border rounded-lg px-2.5 py-1.5 font-mono text-foreground break-all select-all">
                {email}
              </code>
              <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Could not load email address.
          </p>
        )}

        {/* Send test email button */}
        {email && (
          <Button
            variant="outline"
            className="w-full"
            onClick={sendTestEmail}
            disabled={sendingTest}
          >
            {sendingTest ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              "Send test email"
            )}
          </Button>
        )}

        {/* Recent emails */}
        <div className="border-t border-border pt-3">
          <label className="font-medium text-muted-foreground block mb-2">
            Recent emails
          </label>
          {emails.length === 0 ? (
            <p className="text-muted-foreground italic">No emails yet</p>
          ) : (
            <div className="space-y-1.5">
              {emails.map((e) => (
                <div
                  key={e.id}
                  className="bg-muted rounded-lg px-2.5 py-2 flex items-start gap-2"
                >
                  {/* Status dot */}
                  <div className="mt-1 shrink-0" title={
                    e.status === "failed" ? `Error: ${e.error}` :
                    e.status === "processed" ? "Processed" :
                    e.status === "processing" ? "Processing..." :
                    "Received"
                  }>
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
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate">{e.subject || "(no subject)"}</p>
                    <p className="text-muted-foreground truncate">{e.from_address}</p>
                    <p className="text-muted-foreground">{formatDate(e.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
