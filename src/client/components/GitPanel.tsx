import { useState } from "react";
import { useAuth } from "../context/AuthContext.js";

export function GitPanel({ projectId }: { projectId: string }) {
  const { defaultApiKey } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const host = window.location.host;
  const origin = window.location.origin;
  const keyDisplay = defaultApiKey || "pp_YOUR_KEY";
  const cloneCmd = `git clone https://${keyDisplay}@${host}/git/${projectId}`;

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text">Git</h3>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto text-xs">
        <p className="text-text-muted">
          Clone this project with Git to work locally.
        </p>

        {/* Clone command */}
        <div>
          <label className="font-medium text-text-muted block mb-1">Clone</label>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text break-all select-all">
              {cloneCmd}
            </code>
            <button
              onClick={() => copy(cloneCmd, "clone")}
              className="shrink-0 px-2.5 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg hover:text-text hover:border-text-muted transition-colors"
            >
              {copiedField === "clone" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Plain URL */}
        <div>
          <label className="font-medium text-text-muted block mb-1">Repository URL</label>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text break-all select-all">
              {origin}/git/{projectId}
            </code>
            <button
              onClick={() => copy(`${origin}/git/${projectId}`, "url")}
              className="shrink-0 px-2.5 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg hover:text-text hover:border-text-muted transition-colors"
            >
              {copiedField === "url" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Push & pull info */}
        <div className="bg-surface-alt rounded-lg p-3 space-y-1.5">
          <p className="font-medium text-text">Push &amp; pull</p>
          <p className="text-text-muted">
            Changes you push will appear in the browser immediately. Edits made in the browser are auto-committed every 60 seconds, so pull to get the latest.
          </p>
        </div>

        {!defaultApiKey && (
          <p className="text-text-muted">
            Create an API key in Account Settings to fill in the clone command above.
          </p>
        )}
      </div>
    </div>
  );
}
