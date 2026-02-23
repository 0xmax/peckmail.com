import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Monitor, Terminal } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const MCP_URL = "https://peckmail.com/mcp";

export function ConnectPanel({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // MCP state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Email state
  const [email, setEmail] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);

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
        peckmail: {
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
        <h3 className="text-sm font-semibold text-foreground">Connect</h3>
      </div>
      <div className="p-4 space-y-5 overflow-y-auto text-xs">
        {/* ── MCP ──────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">MCP Server</h4>

          {/* MCP URL */}
          <div>
            <label className="font-medium text-muted-foreground block mb-1">Server URL</label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-muted border border-border rounded-lg px-2.5 py-1.5 font-mono text-foreground select-all">
                {MCP_URL}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(MCP_URL, "mcp-url")}
              >
                {copiedField === "mcp-url" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          {/* Claude Desktop */}
          <div className="bg-muted rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                <Monitor size={12} className="text-primary" />
              </div>
              <span className="font-medium text-foreground">Claude Desktop</span>
            </div>
            <p className="text-muted-foreground">
              Add a remote MCP server in Claude Desktop with the URL above. OAuth sign-in handles authentication automatically.
            </p>
          </div>

          {/* Claude Code */}
          <div className="bg-muted rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                <Terminal size={12} className="text-primary" />
              </div>
              <span className="font-medium text-foreground">Claude Code</span>
            </div>
            <p className="text-muted-foreground">
              Create an API key, then use the one-liner below or download the config file.
            </p>

            {/* Created key display */}
            {createdKey && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3 space-y-3">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Key created! Copy it now — you won't see it again.
                </p>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 bg-white dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-2 py-1.5 font-mono text-green-900 dark:text-green-100 break-all select-all">
                    {createdKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(createdKey, "key")}
                    className="shrink-0 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white border-transparent"
                  >
                    {copiedField === "key" ? "Copied!" : "Copy key"}
                  </Button>
                </div>

                {/* CLI one-liner */}
                <div>
                  <label className="font-medium text-green-800 dark:text-green-200 block mb-1">Run in terminal:</label>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 bg-white dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-2 py-1.5 font-mono text-green-900 dark:text-green-100 break-all select-all">
                      claude mcp add peckmail --url {MCP_URL} --header &quot;Authorization: Bearer {createdKey}&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copy(`claude mcp add peckmail --url ${MCP_URL} --header "Authorization: Bearer ${createdKey}"`, "cli")}
                      className="shrink-0 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white border-transparent"
                    >
                      {copiedField === "cli" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleDownloadConfig}
                    className="font-medium text-green-700 hover:text-green-900 dark:text-green-300 dark:hover:text-green-100 transition-colors underline"
                  >
                    Download config file instead
                  </button>
                  <button
                    onClick={() => setCreatedKey(null)}
                    className="text-green-600 hover:text-green-800 dark:text-green-300 dark:hover:text-green-100 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Create new key */}
            {!createdKey && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="text"
                  placeholder="Key name (e.g. My Laptop)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleCreateKey}
                  disabled={creatingKey || !newKeyName.trim()}
                >
                  {creatingKey ? "..." : "Create key"}
                </Button>
              </div>
            )}
          </div>

          {/* Existing keys */}
          {apiKeys.length > 0 && (
            <div className="space-y-1">
              <label className="font-medium text-muted-foreground block mb-1">Existing keys</label>
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between bg-muted rounded-lg px-2.5 py-1.5">
                  <span className="text-foreground truncate">{k.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">
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
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</h4>
          <p className="text-muted-foreground">
            Forward documents and instructions to this workspace.
          </p>

          {emailLoading ? (
            <div className="h-8 bg-muted rounded-lg animate-pulse" />
          ) : email ? (
            <div>
              <label className="font-medium text-muted-foreground block mb-1">Workspace email</label>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 bg-muted border border-border rounded-lg px-2.5 py-1.5 font-mono text-foreground break-all select-all">
                  {email}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(email, "email")}
                >
                  {copiedField === "email" ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Could not load email address.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
