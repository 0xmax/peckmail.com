import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Monitor, Terminal, CurrencyDollar } from "@phosphor-icons/react";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Card, CardContent } from "./ui/card.js";

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreditTransaction {
  id: string;
  amount: number;
  balance_after: number;
  type: string;
  service: string | null;
  project_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export function AccountSettings() {
  const { user, credits, refreshCredits } = useAuth();

  // API Keys / Connect state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [cliCopied, setCliCopied] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  useEffect(() => {
    api.get<{ keys: ApiKey[] }>("/api/keys").then((r) => setApiKeys(r.keys)).catch(() => {});
    refreshCredits();
  }, [refreshCredits]);

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

  const handleDeleteKey = async (id: string) => {
    await api.del(`/api/keys/${id}`);
    setApiKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

  const MCP_URL = "https://peckmail.com/mcp";

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(MCP_URL);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  const handleCopyCliCommand = (key: string) => {
    const cmd = `claude mcp add peckmail --url ${MCP_URL} --header "Authorization: Bearer ${key}"`;
    navigator.clipboard.writeText(cmd);
    setCliCopied(true);
    setTimeout(() => setCliCopied(false), 2000);
  };

  const handleDownloadConfig = () => {
    if (!createdKey) return;
    const config = {
      mcpServers: {
        peckmail: {
          url: "https://peckmail.com/mcp",
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
    <div className="max-w-2xl mx-auto p-8 space-y-8">
        {/* Account section */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">Account</h2>
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
                <div className="text-sm text-foreground">{user?.email}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Display name</label>
                <div className="text-sm text-foreground">
                  {user?.user_metadata?.display_name || user?.user_metadata?.full_name || "Not set"}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Credits section */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">Credits</h2>
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">
                    {credits ? credits.available.toLocaleString() : "\u2014"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    available credits
                    {credits && credits.held > 0 && (
                      <span className="ml-1">({credits.held.toLocaleString()} held)</span>
                    )}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CurrencyDollar size={20} className="text-primary" />
                </div>
              </div>

              {credits && credits.available < 500 && (
                <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Your credits are running low. Contact us to add more.
                  </p>
                </div>
              )}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!showTransactions && transactions.length === 0) {
                      setLoadingTx(true);
                      try {
                        const r = await api.get<{ transactions: CreditTransaction[] }>("/api/credits/transactions?limit=20");
                        setTransactions(r.transactions);
                      } catch { /* ignore */ }
                      setLoadingTx(false);
                    }
                    setShowTransactions(!showTransactions);
                  }}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className={`transition-transform ${showTransactions ? "rotate-90" : ""}`}>&rsaquo;</span>
                  Usage history
                </Button>
                {showTransactions && (
                  <div className="mt-2 space-y-1">
                    {loadingTx ? (
                      <div className="text-xs text-muted-foreground py-2">Loading...</div>
                    ) : transactions.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">No transactions yet</div>
                    ) : (
                      transactions.map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm text-foreground">
                              <span className={`font-medium ${tx.amount > 0 ? "text-green-600" : "text-foreground"}`}>
                                {tx.amount > 0 ? "+" : ""}{tx.amount.toLocaleString()}
                              </span>
                              {tx.service && (
                                <span className="ml-1.5 text-xs text-muted-foreground">{tx.service}</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {tx.type} · {new Date(tx.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums shrink-0 ml-3">
                            {tx.balance_after.toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Connect to Claude section */}
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">Connect to Claude</h2>
          <Card>
            <CardContent className="p-5 space-y-5">
              <p className="text-xs text-muted-foreground">
                Connect Claude to your Peckmail workspace so it can read and manage your emails directly.
              </p>

              {/* MCP URL */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">MCP Server URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted border border-border rounded-lg px-3 py-2 font-mono text-foreground select-all">
                    {MCP_URL}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleCopyUrl} className="shrink-0">
                    {urlCopied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>

              {/* Claude Desktop */}
              <div className="bg-muted rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                    <Monitor size={12} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">Claude Desktop</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add a remote MCP server in Claude Desktop with the URL above. OAuth sign-in handles authentication automatically — no API key needed.
                </p>
              </div>

              {/* Claude Code */}
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                    <Terminal size={12} className="text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">Claude Code</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Create an API key, then use the one-liner below or download the config file.
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
                      <Button variant="outline" size="sm" onClick={handleCopyKey} className="shrink-0 bg-green-600 hover:bg-green-700 text-white border-transparent">
                        {keyCopied ? "Copied!" : "Copy key"}
                      </Button>
                    </div>

                    {/* CLI one-liner */}
                    <div>
                      <label className="text-xs font-medium text-green-800 dark:text-green-200 block mb-1">Run in terminal:</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-white dark:bg-green-900 border border-green-200 dark:border-green-700 rounded px-2 py-1.5 font-mono text-green-900 dark:text-green-100 break-all select-all">
                          claude mcp add peckmail --url {MCP_URL} --header &quot;Authorization: Bearer {createdKey}&quot;
                        </code>
                        <Button variant="outline" size="sm" onClick={() => handleCopyCliCommand(createdKey)} className="shrink-0 bg-green-600 hover:bg-green-700 text-white border-transparent">
                          {cliCopied ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <Button variant="link" size="sm" onClick={handleDownloadConfig} className="text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100">
                        Download config file instead
                      </Button>
                      <Button variant="link" size="sm" onClick={() => { setCreatedKey(null); setKeyCopied(false); }} className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200">
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

              {/* Existing keys */}
              {apiKeys.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">Your API keys</label>
                  <div className="space-y-2">
                    {apiKeys.map((k) => (
                      <div key={k.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{k.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Created {new Date(k.created_at).toLocaleDateString()}
                            {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                          </div>
                        </div>
                        <Button variant="link" size="sm" onClick={() => handleDeleteKey(k.id)} className="shrink-0 text-destructive ml-3">
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

    </div>
  );
}
