import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";

interface Revision {
  hash: string;
  message: string;
  date: string;
  author: string;
}

interface Change {
  path: string;
  status: string;
}

export function Revisions({ projectId }: { projectId: string }) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);

  const loadRevisions = useCallback(async () => {
    try {
      const data = await api.get<{ revisions: Revision[] }>(
        `/api/projects/${projectId}/revisions`
      );
      setRevisions(data.revisions);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRevisions();
    // Refresh every 60s to catch new auto-commits
    const interval = setInterval(loadRevisions, 60_000);
    return () => clearInterval(interval);
  }, [loadRevisions]);

  const toggleExpand = async (hash: string) => {
    if (expanded === hash) {
      setExpanded(null);
      return;
    }
    setExpanded(hash);
    try {
      const data = await api.get<{ changes: Change[] }>(
        `/api/projects/${projectId}/revisions/${hash}`
      );
      setChanges(data.changes);
    } catch {
      setChanges([]);
    }
  };

  const formatDate = (iso: string) => {
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
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-border">
        <span className="text-sm font-medium text-text">History</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center text-text-muted text-sm py-8">
            Loading...
          </div>
        ) : revisions.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📜</div>
            <p className="text-text-muted text-sm">No history yet</p>
            <p className="text-text-muted text-xs mt-1">
              Changes are saved automatically
            </p>
          </div>
        ) : (
          <div className="py-2">
            {revisions.map((rev) => (
              <div key={rev.hash}>
                <button
                  onClick={() => toggleExpand(rev.hash)}
                  className="w-full text-left px-3 py-2.5 hover:bg-surface-alt transition-colors"
                >
                  <p className="text-sm text-text leading-snug">
                    {rev.message}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {formatDate(rev.date)}
                  </p>
                </button>
                {expanded === rev.hash && (
                  <div className="px-3 pb-2">
                    {changes.length === 0 ? (
                      <p className="text-xs text-text-muted">No details</p>
                    ) : (
                      <div className="space-y-1">
                        {changes.map((ch, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-text-muted"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                ch.status === "added"
                                  ? "bg-success"
                                  : ch.status === "deleted"
                                    ? "bg-danger"
                                    : "bg-accent"
                              }`}
                            />
                            <span>{ch.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
