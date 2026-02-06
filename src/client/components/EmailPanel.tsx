import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.js";
import { useIncomingEmails, useProjectId } from "../store/StoreContext.js";
import { api } from "../lib/api.js";

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
        <h3 className="text-sm font-semibold text-text">Email</h3>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
        <p className="text-text-muted">
          Send emails to this address and the AI assistant will process them.
          Add an <code className="bg-surface-alt px-1 py-0.5 rounded text-text">AGENTS.md</code> file for custom instructions.
        </p>

        {loading ? (
          <p className="text-text-muted">Loading...</p>
        ) : email ? (
          <div>
            <label className="font-medium text-text-muted block mb-1">
              Workspace email
            </label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text break-all select-all">
                {email}
              </code>
              <button
                onClick={copy}
                className="shrink-0 px-2.5 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg hover:text-text hover:border-text-muted transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-text-muted">
            Could not load email address.
          </p>
        )}

        {/* Send test email button */}
        {email && (
          <button
            onClick={sendTestEmail}
            disabled={sendingTest}
            className="w-full px-3 py-2 bg-surface-alt border border-border text-text rounded-lg hover:border-text-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {sendingTest ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              "Send test email"
            )}
          </button>
        )}

        {/* Recent emails */}
        <div className="border-t border-border pt-3">
          <label className="font-medium text-text-muted block mb-2">
            Recent emails
          </label>
          {emails.length === 0 ? (
            <p className="text-text-muted italic">No emails yet</p>
          ) : (
            <div className="space-y-1.5">
              {emails.map((e) => (
                <div
                  key={e.id}
                  className="bg-surface-alt rounded-lg px-2.5 py-2 flex items-start gap-2"
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
                    <p className="text-text truncate">{e.subject || "(no subject)"}</p>
                    <p className="text-text-muted truncate">{e.from_address}</p>
                    <p className="text-text-muted">{formatDate(e.created_at)}</p>
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
