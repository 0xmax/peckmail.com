import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Monitor, Terminal, DownloadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Card, CardContent } from "@/components/ui/card.js";

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const MCP_URL = "https://peckmail.com/mcp";

export function DataView() {
  const { session } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  useEffect(() => {
    api
      .get<{ keys: ApiKey[] }>("/api/keys")
      .then((r) => setApiKeys(r.keys))
      .catch(() => {});
  }, []);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await api.post<{
        key: string;
        id: string;
        name: string;
        created_at: string;
      }>("/api/keys", { name: newKeyName.trim() });
      setCreatedKey(res.key);
      setApiKeys((prev) => [
        { id: res.id, name: res.name, created_at: res.created_at, last_used_at: null },
        ...prev,
      ]);
      setNewKeyName("");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    await api.del(`/api/keys/${id}`);
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleDownloadConfig = () => {
    if (!createdKey) return;
    const config = {
      mcpServers: {
        peckmail: {
          url: MCP_URL,
          headers: { Authorization: `Bearer ${createdKey}` },
        },
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "claude_code_config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-8">
        <h1 className="text-xl font-semibold text-foreground">Data & API</h1>

        {/* MCP Server */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">
            MCP Server
          </h2>
          <Card>
            <CardContent className="p-5 space-y-5">
              <p className="text-xs text-muted-foreground">
                Connect Claude to your Peckmail workspace so it can read and
                manage your emails directly.
              </p>

              {/* MCP URL */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Server URL
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted border border-border rounded-lg px-3 py-2 font-mono text-foreground select-all">
                    {MCP_URL}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(MCP_URL, "mcp-url")}
                    className="shrink-0"
                  >
                    {copiedField === "mcp-url" ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>

              {/* Claude Desktop */}
              <div className="bg-muted rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                    <Monitor size={12} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    Claude Desktop
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add a remote MCP server in Claude Desktop with the URL above.
                  OAuth sign-in handles authentication automatically.
                </p>
              </div>

              {/* Claude Code */}
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                    <Terminal size={12} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    Claude Code
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Create an API key, then use the one-liner below or download the
                  config file.
                </p>

                {/* Created key display */}
                {createdKey && (
                  <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-green-800 dark:text-green-200">
                      Key created! Copy it now — you won't see it again.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-2 py-1.5 font-mono text-green-900 dark:text-green-100 break-all select-all">
                        {createdKey}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copy(createdKey, "key")}
                        className="shrink-0 bg-green-600 hover:bg-green-700 text-white border-transparent"
                      >
                        {copiedField === "key" ? "Copied!" : "Copy key"}
                      </Button>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-green-800 dark:text-green-200 block mb-1">
                        Run in terminal:
                      </label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-white dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-2 py-1.5 font-mono text-green-900 dark:text-green-100 break-all select-all">
                          claude mcp add peckmail --url {MCP_URL} --header
                          &quot;Authorization: Bearer {createdKey}&quot;
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copy(
                              `claude mcp add peckmail --url ${MCP_URL} --header "Authorization: Bearer ${createdKey}"`,
                              "cli"
                            )
                          }
                          className="shrink-0 bg-green-600 hover:bg-green-700 text-white border-transparent"
                        >
                          {copiedField === "cli" ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={handleDownloadConfig}
                        className="text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100"
                      >
                        Download config file
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setCreatedKey(null)}
                        className="text-green-600 dark:text-green-400"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}

                {/* Create new key */}
                {!createdKey && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="Key name (e.g. My Laptop)"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleCreateKey}
                      disabled={creatingKey || !newKeyName.trim()}
                      className="shrink-0"
                    >
                      {creatingKey ? "Creating..." : "Create key"}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* API Keys */}
        {apiKeys.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-4">
              API Keys
            </h2>
            <Card>
              <CardContent className="p-5">
                <div className="space-y-2">
                  {apiKeys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between bg-muted rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {k.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Created {new Date(k.created_at).toLocaleDateString()}
                          {k.last_used_at &&
                            ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => handleDeleteKey(k.id)}
                        className="shrink-0 text-destructive ml-3"
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* Downloads & Exports */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">
            Downloads & Exports
          </h2>
          <Card>
            <CardContent className="p-6 text-center">
              <DownloadSimple
                size={32}
                weight="duotone"
                className="mx-auto mb-2 text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">Coming soon</p>
              <p className="text-xs text-muted-foreground mt-1">
                Export your newsletter data as CSV, JSON, or PDF.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
