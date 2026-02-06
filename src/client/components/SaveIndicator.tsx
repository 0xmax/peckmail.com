import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { Check } from "@phosphor-icons/react";

interface GitStatus {
  hasChanges: boolean;
  files: string[];
}

export function SaveIndicator({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<GitStatus>({ hasChanges: false, files: [] });
  const [showCommit, setShowCommit] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll for status
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const data = await api.get<GitStatus>(`/api/projects/${projectId}/status`);
        if (mounted) setStatus(data);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [projectId]);

  // Close popover on outside click
  useEffect(() => {
    if (!showCommit) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCommit(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCommit]);

  // Focus input when popover opens
  useEffect(() => {
    if (showCommit) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showCommit]);

  const handleSaveNow = useCallback(async () => {
    setShowCommit(true);
    // Generate a suggested message
    const defaultMsg = status.files.length === 1
      ? `Updated ${status.files[0]}`
      : `Updated ${status.files.length} files`;
    setCommitMsg(defaultMsg);
  }, [status]);

  const handleCommit = useCallback(async () => {
    setSaving(true);
    try {
      const result = await api.post<{ hash: string; message: string }>(`/api/projects/${projectId}/commit`, {
        message: commitMsg.trim() || undefined,
      });
      setCommitMsg("");
      setShowCommit(false);
      setStatus({ hasChanges: false, files: [] });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [projectId, commitMsg]);

  if (!status.hasChanges && !justSaved) return null;

  return (
    <div className="relative flex items-center">
      {justSaved ? (
        <span className="text-xs text-success flex items-center gap-1">
          <Check size={12} weight="bold" />
          Saved
        </span>
      ) : (
        <button
          onClick={handleSaveNow}
          className="text-xs text-text-muted hover:text-text flex items-center gap-1 transition-colors px-2 py-1 rounded-md hover:bg-surface-alt"
          title={`${status.files.length} unsaved file${status.files.length !== 1 ? "s" : ""}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          Unsaved
        </button>
      )}

      {showCommit && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg p-3 z-50"
        >
          <div className="text-xs text-text-muted mb-2">
            {status.files.length} changed file{status.files.length !== 1 ? "s" : ""}
          </div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) handleCommit();
                if (e.key === "Escape") setShowCommit(false);
              }}
              placeholder="Describe your changes..."
              className="flex-1 text-sm px-2 py-1.5 bg-surface-alt border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleCommit}
              disabled={saving}
              className="px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 shrink-0"
            >
              {saving ? "..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
