import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { api } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import type { UserPreferences } from "../store/types.js";
import { Monitor, Terminal, Play, Stop, CurrencyDollar, Envelope, SignOut, ArrowLeft, XLogo } from "@phosphor-icons/react";
import { UserAvatar } from "./UserAvatar.js";

interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Warm, calm narrator" },
  { id: "29vD33N1CtxCmqQRPOHJ", name: "Drew", desc: "Well-rounded, confident" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Soft, young narrator" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "Well-rounded, calm" },
  { id: "GBv7mTt0atIp3Br8iCZE", name: "Thomas", desc: "Calm, collected" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "Warm British narrator" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", desc: "Articulate, authoritative" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "Warm, friendly" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "Deep, authoritative British" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "Warm, British narrator" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", desc: "Trustworthy American" },
  { id: "t0jbNlBVZ17f02VDIeMI", name: "Austin", desc: "Warm, grounded narrator" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", desc: "Deep, authoritative" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", desc: "Confident British" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "Seductive, calm" },
];

type TtsModel = "v2" | "v3";

interface V2Settings {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}

const DEFAULT_V2: V2Settings = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1.0,
};

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
  const { user, preferences, updatePreferences, credits, refreshCredits, signOut, handle } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [voiceId, setVoiceId] = useState(preferences.tts?.voiceId || "pqHfZKP75CvOlQylNhV4");
  const [model, setModel] = useState<TtsModel>(preferences.tts?.model || "v3");
  const [v2Settings, setV2Settings] = useState<V2Settings>(preferences.tts?.v2 || DEFAULT_V2);
  const [saved, setSaved] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const MCP_URL = "https://perchpad.co/mcp";

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(MCP_URL);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  const handleCopyCliCommand = (key: string) => {
    const cmd = `claude mcp add perchpad --url ${MCP_URL} --header "Authorization: Bearer ${key}"`;
    navigator.clipboard.writeText(cmd);
    setCliCopied(true);
    setTimeout(() => setCliCopied(false), 2000);
  };

  const handleDownloadConfig = () => {
    if (!createdKey) return;
    const config = {
      mcpServers: {
        perchpad: {
          url: "https://perchpad.co/mcp",
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

  // Cleanup preview audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  const previewVoice = useCallback(
    async (vid: string) => {
      if (previewingVoice === vid && previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
        setPreviewingVoice(null);
        return;
      }

      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }

      setPreviewingVoice(vid);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const audio = new Audio();
        audio.src = `/api/tts/preview/${vid}?token=${encodeURIComponent(token)}`;
        audio.addEventListener("ended", () => {
          setPreviewingVoice(null);
          previewAudioRef.current = null;
        });
        previewAudioRef.current = audio;
        await audio.play();
      } catch {
        setPreviewingVoice(null);
        previewAudioRef.current = null;
      }
    },
    [previewingVoice]
  );

  // Auto-save preferences when voice/model/settings change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const prefs: UserPreferences = { tts: { voiceId, model, v2: v2Settings } };
      await updatePreferences(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [voiceId, model, v2Settings, updatePreferences]);

  const handleResetDefaults = () => {
    setVoiceId("pqHfZKP75CvOlQylNhV4"); // Bill
    setModel("v2");
    setV2Settings(DEFAULT_V2);
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
          <img src="/assets/logo.png" alt="Perchpad" className="h-6 w-auto" />
          <span style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-medium text-text -tracking-[0.01em]">
            Perchpad
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
                href="https://x.com/perchpad"
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
              Connect Claude to your Perchpad projects so it can read, write, and manage your files directly.
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
                        claude mcp add perchpad --url {MCP_URL} --header &quot;Authorization: Bearer {createdKey}&quot;
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

        {/* Default Voice section */}
        <section>
          <h2 className="text-base font-semibold text-text mb-4">Default Voice</h2>
          <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
            {/* Voice grid */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-2">Voice</label>
              <div className="grid grid-cols-3 gap-2">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`text-left text-sm px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                      voiceId === v.id
                        ? "bg-accent text-white"
                        : "bg-surface-alt text-text-muted hover:text-text"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className={`text-xs truncate ${voiceId === v.id ? "text-white/70" : "text-text-muted"}`}>
                        {v.desc}
                      </div>
                    </div>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        previewVoice(v.id);
                      }}
                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                        voiceId === v.id ? "hover:bg-white/20" : "hover:bg-border"
                      }`}
                      title={previewingVoice === v.id ? "Stop preview" : `Preview ${v.name}`}
                    >
                      {previewingVoice === v.id ? (
                        <Stop size={10} weight="fill" />
                      ) : (
                        <Play size={10} weight="fill" />
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Model selector */}
            <div>
              <label className="text-xs font-medium text-text-muted block mb-2">Model</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setModel("v3")}
                  className={`flex-1 text-sm py-2 px-3 rounded-lg transition-colors ${
                    model === "v3"
                      ? "bg-accent text-white"
                      : "bg-surface-alt text-text-muted hover:text-text"
                  }`}
                >
                  v3 + AI Tags
                </button>
                <button
                  onClick={() => setModel("v2")}
                  className={`flex-1 text-sm py-2 px-3 rounded-lg transition-colors ${
                    model === "v2"
                      ? "bg-accent text-white"
                      : "bg-surface-alt text-text-muted hover:text-text"
                  }`}
                >
                  v2 Classic
                </button>
              </div>
            </div>

            {/* v2 settings */}
            {model === "v2" && (
              <div className="space-y-3 pt-1">
                <SliderSetting
                  label="Stability"
                  value={v2Settings.stability}
                  onChange={(v) => setV2Settings((s) => ({ ...s, stability: v }))}
                />
                <SliderSetting
                  label="Similarity"
                  value={v2Settings.similarityBoost}
                  onChange={(v) => setV2Settings((s) => ({ ...s, similarityBoost: v }))}
                />
                <SliderSetting
                  label="Style"
                  value={v2Settings.style}
                  onChange={(v) => setV2Settings((s) => ({ ...s, style: v }))}
                />
                <SliderSetting
                  label="Speed"
                  value={v2Settings.speed}
                  min={0.5}
                  max={2}
                  step={0.1}
                  onChange={(v) => setV2Settings((s) => ({ ...s, speed: v }))}
                />
              </div>
            )}

            {model === "v3" && (
              <p className="text-xs text-text-muted">
                Uses Claude to add expressive audio tags before synthesis.
              </p>
            )}
          </div>
        </section>

        {/* Reset / auto-save indicator */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetDefaults}
            className="px-4 py-2 text-sm text-text-muted hover:text-text border border-border rounded-xl hover:bg-surface-alt transition-colors"
          >
            Reset to defaults
          </button>
          {saved && (
            <span className="text-sm text-success">Saved!</span>
          )}
        </div>

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

function SliderSetting({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-text-muted mb-1">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-border rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
}
