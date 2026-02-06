import { useEffect, useState } from "react";
import { MembersPanel } from "./MembersPanel.js";
import { GitPanel } from "./GitPanel.js";
import { EmailPanel } from "./EmailPanel.js";
import { InviteForm } from "./InviteModal.js";

type Tab = "members" | "git" | "email" | "invite";

const TABS: { key: Tab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "git", label: "Git" },
  { key: "email", label: "Email" },
  { key: "invite", label: "Invite" },
];

export function SettingsModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("members");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-surface rounded-2xl w-full max-w-2xl border border-border shadow-xl flex flex-col"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-text">Settings</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 pb-3 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === tab.key
                  ? "bg-surface-alt text-accent"
                  : "text-text-muted hover:text-text hover:bg-surface-alt"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "members" && (
            <MembersPanel projectId={projectId} />
          )}
          {activeTab === "git" && <GitPanel projectId={projectId} />}
          {activeTab === "email" && <EmailPanel projectId={projectId} />}
          {activeTab === "invite" && <InviteForm projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
