import { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { Monitor, Terminal, CurrencyDollar, Envelope, SignOut, ArrowLeft, XLogo } from "@phosphor-icons/react";
import { UserAvatar } from "./UserAvatar.js";

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

export function AccountSettings({ onBack, onOpenProject }: { onBack: () => void; onOpenProject?: (id: string) => void }) {
  const { user, credits, refreshCredits, signOut, handle } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // API Keys / Connect state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [cliCopied, setCliCopied] = useState(false);
  const [creatingStarter, setCreatingStarter] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

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
    <div className="min-h-screen bg-bg">
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between relative">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft size={14} weight="bold" className="inline" /> Back
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
          <img src="/assets/logo.png" alt="Peckmail" className="h-6 w-auto" />
          <span style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-medium text-text -tracking-[0.01em]">
            Peckmail
          </span>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity"
          >
            <UserAvatar
              src={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
              name={user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
              size={32}
            />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-surface rounded-xl border border-border shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-medium text-text truncate">
                  {user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email}
                </div>
                {handle && (
                  <div className="text-xs text-text-muted truncate mt-0.5">@{handle}</div>
                )}
              </div>
              <button
                onClick={() => { setMenuOpen(false); onBack(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
              >
                <ArrowLeft size={16} className="text-text-muted" />
                All workspaces
              </button>
              <a
                href="/contact"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
              >
                <Envelope size={16} className="text-text-muted" />
                Contact
              </a>
              <a
                href="https://x.com/peckmail"
                target="_blank"
                rel="noopener"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors"
              >
                <XLogo size={16} className="text-text-muted" />
                Follow on X
              </a>
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-surface-alt transition-colors border-t border-border"
              >
                <SignOut size={16} className="text-text-muted" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-8 space-y-8">
        {/* Account section */}
        <section>
          <h2 className="text-base font-semibold text-text mb-4">Account</h2>
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">Email</label>
              <div className="text-sm text-text">{user?.email}</div>
            </div>
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">Display name</label>
              <div className="text-sm text-text">
                {user?.user_metadata?.display_name || user?.user_metadata?.full_name || "Not set"}
              </div>
            </div>
          </div>
        </section>

        {/* Credits section */}
        <section>
          <h2 className="text-base font-semibold text-text mb-4">Credits</h2>
          <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-text tabular-nums">
                  {credits ? credits.available.toLocaleString() : "—"}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  available credits
                  {credits && credits.held > 0 && (
                    <span className="ml-1">({credits.held.toLocaleString()} held)</span>
                  )}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <CurrencyDollar size={20} className="text-accent" />
              </div>
            </div>

            {credits && credits.available < 500 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-800">
                  Your credits are running low. Contact us to add more.
                </p>
              </div>
            )}

            <div>
              <button
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
                className="text-xs font-medium text-text-muted hover:text-text transition-colors flex items-center gap-1"
              >
                <span className={`transition-transform ${showTransactions ? "rotate-90" : ""}`}>&rsaquo;</span>
                Usage history
              </button>
              {showTransactions && (
                <div className="mt-2 space-y-1">
                  {loadingTx ? (
                    <div className="text-xs text-text-muted py-2">Loading...</div>
                  ) : transactions.length === 0 ? (
                    <div className="text-xs text-text-muted py-2">No transactions yet</div>
                  ) : (
                    transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between bg-surface-alt rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm text-text">
                            <span className={`font-medium ${tx.amount > 0 ? "text-green-600" : "text-text"}`}>
                              {tx.amount > 0 ? "+" : ""}{tx.amount.toLocaleString()}
                            </span>
                            {tx.service && (
                              <span className="ml-1.5 text-xs text-text-muted">{tx.service}</span>
                            )}
                          </div>
                          <div className="text-xs text-text-muted">
                            {tx.type} · {new Date(tx.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-xs text-text-muted tabular-nums shrink-0 ml-3">
                          {tx.balance_after.toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Connect to Claude section */}
        <section>
          <h2 className="text-base font-semibold text-text mb-4">Connect to Claude</h2>
          <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
            <p className="text-xs text-text-muted">
              Connect Claude to your Peckmail projects so it can read, write, and manage your files directly.
            </p>

            {/* MCP URL */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1.5">MCP Server URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm bg-surface-alt border border-border rounded-lg px-3 py-2 font-mono text-text select-all">
                  {MCP_URL}
                </code>
                <button
                  onClick={handleCopyUrl}
                  className="shrink-0 px-3 py-2 bg-surface-alt border border-border text-text-muted rounded-lg text-xs hover:text-text hover:border-text-muted transition-colors"
                >
                  {urlCopied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Claude Desktop */}
            <div className="bg-surface-alt rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
                  <Monitor size={12} className="text-accent" />
                </div>
                <span className="text-sm font-medium text-text">Claude Desktop</span>
              </div>
              <p className="text-xs text-text-muted">
                Add a remote MCP server in Claude Desktop with the URL above. OAuth sign-in handles authentication automatically — no API key needed.
              </p>
            </div>

            {/* Claude Code */}
            <div className="bg-surface-alt rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
                  <Terminal size={12} className="text-accent" />
                </div>
                <span className="text-sm font-medium text-text">Claude Code</span>
              </div>
              <p className="text-xs text-text-muted">
                Create an API key, then use the one-liner below or download the config file.
              </p>

              {/* Created key display */}
              {createdKey && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                  <p className="text-xs font-medium text-green-800">
                    Key created! Copy it now — you won't see it again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white border border-green-200 rounded px-2 py-1.5 font-mono text-green-900 break-all select-all">
                      {createdKey}
                    </code>
                    <button
                      onClick={handleCopyKey}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 transition-colors"
                    >
                      {keyCopied ? "Copied!" : "Copy key"}
                    </button>
                  </div>

                  {/* CLI one-liner */}
                  <div>
                    <label className="text-xs font-medium text-green-800 block mb-1">Run in terminal:</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white border border-green-200 rounded px-2 py-1.5 font-mono text-green-900 break-all select-all">
                        claude mcp add peckmail --url {MCP_URL} --header &quot;Authorization: Bearer {createdKey}&quot;
                      </code>
                      <button
                        onClick={() => handleCopyCliCommand(createdKey)}
                        className="shrink-0 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 transition-colors"
                      >
                        {cliCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleDownloadConfig}
                      className="text-xs font-medium text-green-700 hover:text-green-900 transition-colors underline"
                    >
                      Download config file instead
                    </button>
                    <button
                      onClick={() => { setCreatedKey(null); setKeyCopied(false); }}
                      className="text-xs text-green-600 hover:text-green-800 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Create new key */}
              {!createdKey && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Key name (e.g. My Laptop)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                    className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleCreateKey}
                    disabled={creatingKey || !newKeyName.trim()}
                    className="shrink-0 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {creatingKey ? "Creating..." : "Create key"}
                  </button>
                </div>
              )}
            </div>

            {/* Existing keys */}
            {apiKeys.length > 0 && (
              <div>
                <label className="text-xs font-medium text-text-muted block mb-2">Your API keys</label>
                <div className="space-y-2">
                  {apiKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between bg-surface-alt rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text truncate">{k.name}</div>
                        <div className="text-xs text-text-muted">
                          Created {new Date(k.created_at).toLocaleDateString()}
                          {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteKey(k.id)}
                        className="shrink-0 text-xs text-red-500 hover:text-red-700 transition-colors ml-3"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Starter project */}
        <section className="pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-text-muted">Starter project</h3>
              <p className="text-xs text-text-muted/70 mt-0.5">
                Create a new workspace with sample files, recipes, and guides.
              </p>
            </div>
            <button
              onClick={async () => {
                setCreatingStarter(true);
                try {
                  const res = await api.post<{ project: { id: string } }>("/api/projects", { name: "Starter Project" });
                  if (onOpenProject) onOpenProject(res.project.id);
                } finally {
                  setCreatingStarter(false);
                }
              }}
              disabled={creatingStarter}
              className="shrink-0 px-3 py-1.5 bg-surface-alt border border-border text-text-muted rounded-lg text-xs hover:text-text hover:border-text-muted transition-colors disabled:opacity-50"
            >
              {creatingStarter ? "Creating..." : "Create"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
