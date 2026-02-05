import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { supabase } from "../lib/supabase.js";
import type { UserPreferences } from "../store/types.js";

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

export function AccountSettings({ onBack }: { onBack: () => void }) {
  const { user, preferences, updatePreferences } = useAuth();
  const [voiceId, setVoiceId] = useState(preferences.tts?.voiceId || VOICES[0].id);
  const [model, setModel] = useState<TtsModel>(preferences.tts?.model || "v3");
  const [v2Settings, setV2Settings] = useState<V2Settings>(preferences.tts?.v2 || DEFAULT_V2);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const prefs: UserPreferences = {
        tts: { voiceId, model, v2: v2Settings },
      };
      await updatePreferences(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            &larr; Back
          </button>
          <div className="w-px h-5 bg-border" />
          <h1 className="text-lg font-semibold text-text">Settings</h1>
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
                        <svg width="10" height="10" viewBox="0 0 8 8" fill="currentColor">
                          <rect x="1" y="1" width="6" height="6" rx="1" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M2 1v6l5-3z" />
                        </svg>
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

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save preferences"}
          </button>
          {saved && (
            <span className="text-sm text-success">Saved!</span>
          )}
        </div>
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
