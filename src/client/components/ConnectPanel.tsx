import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Monitor, Terminal, EnvelopeSimple } from "@phosphor-icons/react";

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const MCP_URL = "https://perchpad.co/mcp";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "project";
}

export function ConnectPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { defaultApiKey, session } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // MCP state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Email state
  const [email, setEmail] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);

  const host = window.location.host;
  const origin = window.location.origin;
  const keyDisplay = defaultApiKey || "pp_YOUR_KEY";
  const slug = slugify(projectName || "project");
  const gitPath = `/git/${projectId}/${slug}`;
  const cloneCmd = `git clone https://x-token:${keyDisplay}@${host}${gitPath}`;

  useEffect(() => {
    api.get<{ keys: ApiKey[] }>("/api/keys").then((r) => setApiKeys(r.keys)).catch(() => {});
    fetch(`/api/projects/${projectId}/email`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setEmail(data.email ?? null))
      .catch(() => setEmail(null))
      .finally(() => setEmailLoading(false));
  }, [projectId, session?.access_token]);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await api.post<{ key: string; id: string; name: string; created_at: string }>(
        "/api/keys",
        { name: newKeyName.trim() }
      );
      setCreatedKey(res.key);
      setApiKeys((prev) => [{ id: res.id, name: res.name, created_at: res.created_at, last_used_at: null }, ...prev]);
      setNewKeyName("");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDownloadConfig = () => {
    if (!createdKey) return;
    const config = {
      mcpServers: {
        perchpad: {
          url: MCP_URL,
          headers: {
            Authorization: `Bearer ${createdKey}`,
          },
        },
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "claude_code_config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text">Connect</h3>
      </div>
      <div className="p-4 space-y-5 overflow-y-auto text-xs">
        {/* ── Git ──────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Git</h4>
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

          {/* Repository URL */}
          <div>
            <label className="font-medium text-text-muted block mb-1">Repository URL</label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text break-all select-all">
                {origin}{gitPath}
              </code>
              <button
                onClick={() => copy(`${origin}${gitPath}`, "url")}
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
              Create an API key below to fill in the clone command above.
            </p>
          )}
        </section>

        <div className="border-t border-border" />

        {/* ── MCP ──────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">MCP Server</h4>

          {/* MCP URL */}
          <div>
            <label className="font-medium text-text-muted block mb-1">Server URL</label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text select-all">
                {MCP_URL}
              </code>
              <button
                onClick={() => copy(MCP_URL, "mcp-url")}
                className="shrink-0 px-2.5 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg hover:text-text hover:border-text-muted transition-colors"
              >
                {copiedField === "mcp-url" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Claude Desktop */}
          <div className="bg-surface-alt rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
                <Monitor size={12} className="text-accent" />
              </div>
              <span className="font-medium text-text">Claude Desktop</span>
            </div>
            <p className="text-text-muted">
              Add a remote MCP server in Claude Desktop with the URL above. OAuth sign-in handles authentication automatically.
            </p>
          </div>

          {/* Claude Code */}
          <div className="bg-surface-alt rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
                <Terminal size={12} className="text-accent" />
              </div>
              <span className="font-medium text-text">Claude Code</span>
            </div>
            <p className="text-text-muted">
              Create an API key, then use the one-liner below or download the config file.
            </p>

            {/* Created key display */}
            {createdKey && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                <p className="font-medium text-green-800">
                  Key created! Copy it now — you won't see it again.
                </p>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 bg-white border border-green-200 rounded px-2 py-1.5 font-mono text-green-900 break-all select-all">
                    {createdKey}
                  </code>
                  <button
                    onClick={() => copy(createdKey, "key")}
                    className="shrink-0 px-2.5 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    {copiedField === "key" ? "Copied!" : "Copy key"}
                  </button>
                </div>

                {/* CLI one-liner */}
                <div>
                  <label className="font-medium text-green-800 block mb-1">Run in terminal:</label>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 bg-white border border-green-200 rounded px-2 py-1.5 font-mono text-green-900 break-all select-all">
                      claude mcp add perchpad --url {MCP_URL} --header &quot;Authorization: Bearer {createdKey}&quot;
                    </code>
                    <button
                      onClick={() => copy(`claude mcp add perchpad --url ${MCP_URL} --header "Authorization: Bearer ${createdKey}"`, "cli")}
                      className="shrink-0 px-2.5 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      {copiedField === "cli" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleDownloadConfig}
                    className="font-medium text-green-700 hover:text-green-900 transition-colors underline"
                  >
                    Download config file instead
                  </button>
                  <button
                    onClick={() => setCreatedKey(null)}
                    className="text-green-600 hover:text-green-800 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Create new key */}
            {!createdKey && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Key name (e.g. My Laptop)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                  className="flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5 text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={handleCreateKey}
                  disabled={creatingKey || !newKeyName.trim()}
                  className="shrink-0 px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {creatingKey ? "..." : "Create key"}
                </button>
              </div>
            )}
          </div>

          {/* Existing keys */}
          {apiKeys.length > 0 && (
            <div className="space-y-1">
              <label className="font-medium text-text-muted block mb-1">Existing keys</label>
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between bg-surface-alt rounded-lg px-2.5 py-1.5">
                  <span className="text-text truncate">{k.name}</span>
                  <span className="text-text-muted shrink-0 ml-2">
                    {new Date(k.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-border" />

        {/* ── Email ────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">Email</h4>
          <p className="text-text-muted">
            Forward documents and instructions to this workspace.
          </p>

          {emailLoading ? (
            <div className="h-8 bg-surface-alt rounded-lg animate-pulse" />
          ) : email ? (
            <div>
              <label className="font-medium text-text-muted block mb-1">Workspace email</label>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 bg-surface-alt border border-border rounded-lg px-2.5 py-1.5 font-mono text-text break-all select-all">
                  {email}
                </code>
                <button
                  onClick={() => copy(email, "email")}
                  className="shrink-0 px-2.5 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg hover:text-text hover:border-text-muted transition-colors"
                >
                  {copiedField === "email" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-text-muted">
              Could not load email address.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
